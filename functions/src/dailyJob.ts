import { randomUUID } from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import {
  DraftDocument,
  NewsItem,
  Pillar,
  classifyNewsItem,
  generateDrafts,
  generateBankDrafts,
  isoWeekId,
  getWeeklyCounts,
  recordPillarUse,
  pickUnderrepresentedPillar,
  pickBankItem,
  markBankItemUsed,
  quickRedFlagCheck,
} from '@natsatopics/shared';
import { fetchYleNews } from './yleScraper';
import { sendMagicLinkEmail } from './email';
import { getAiModelConfig } from './params';

const TOKEN_TTL_HOURS = 48;

function todayHelsinkiDateString(): string {
  return new Intl.DateTimeFormat('fi-FI', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .split('.')
    .reverse()
    .join('-');
}

/**
 * Vaiheet 1-5 of luku 10: scrape, red-flag filter, pillar-check, draft, and
 * queue for human review by emailing a magic link. Runs once per day via
 * Cloud Scheduler (see index.ts for the schedule).
 */
export async function runDailyPipeline(projectId: string): Promise<{ draftId: string | null; reason?: string }> {
  const db = getFirestore();
  const date = todayHelsinkiDateString();
  const isoWeek = isoWeekId(new Date());

  // Vaihe 3 — Pilarin määritys (luku 6): katsotaan ensin viikon jakaumaa
  // kaikkien neljän pilarin kesken. Nostalgia ja history eivät synny
  // uutissyötteestä (luku 6), joten jos ne ovat alipainottuneita, päivän
  // aihe otetaan aihepankista sen sijaan, että pakotettaisiin uutinen
  // väärään pilariin.
  const weekly = await getWeeklyCounts(db, isoWeek);
  const targetPillar = pickUnderrepresentedPillar(weekly.counts);
  const aiModelConfig = await getAiModelConfig();

  let chosenNews: NewsItem | undefined;
  let finalPillar: Pillar;
  let options;
  let bankItemId: string | undefined;

  if (targetPillar === 'nostalgia' || targetPillar === 'history') {
    const bankItem = await pickBankItem(db, targetPillar);
    if (!bankItem) {
      return { draftId: null, reason: `Aihepankki pilarille "${targetPillar}" on tyhjä — täydennä packages/shared tai Firestore-kokoelmaa "contentBank"` };
    }
    finalPillar = targetPillar;
    bankItemId = bankItem.id;
    const generated = await generateBankDrafts(projectId, bankItem.prompt, finalPillar, aiModelConfig);
    options = generated.options;
  } else {
    // Vaihe 1 — Syötteen rajaus
    const news = await fetchYleNews();
    if (news.length === 0) {
      return { draftId: null, reason: 'Ei uutisia YLE-syötteistä annetulla aikaikkunalla' };
    }

    // Vaihe 2 — Punaisten lippujen tarkistus (nopea esisuodatus)
    const candidates = news.filter((item) => !quickRedFlagCheck(item).flagged);
    if (candidates.length === 0) {
      return { draftId: null, reason: 'Kaikki uutiset suodattuivat pois punaisten lippujen esitarkistuksessa' };
    }

    // Käydään ehdokkaita läpi, kunnes tekoäly hyväksyy yhden relevanttina ja
    // ei-punalipullisena, ja antaa sille uutisvetoisen pilarin. Tämä voi
    // kutsua mallia kymmeniä kertoja per ajo (yksi per ehdokas, ennen kuin
    // yksi hyväksytään), ja joka kutsu sisältää koko ~18 kt:n sisältöoppaan
    // — siksi luokittelussa käytetään erikseen kevyempää mallia kuin
    // varsinaisessa tekstintuotannossa (jonka kielellinen laatu on
    // tärkeämpi ja jota kutsutaan vain 1-2 kertaa per ajo), jotta Vertex AI:n
    // per-minuutti-token-kvootti mistral-medium-3:lle (31 500) ei ylity
    // pelkästä luokittelusilmukasta.
    const classificationModelConfig = { model: 'mistral-small-2503', location: aiModelConfig.location };
    let chosenPillar: Pillar | null = null;
    for (const item of candidates) {
      const classification = await classifyNewsItem(projectId, item, classificationModelConfig);
      if (classification.redFlagged || !classification.relevant || !classification.pillar) continue;
      chosenNews = item;
      chosenPillar = classification.pillar;
      break;
    }

    if (!chosenNews || !chosenPillar) {
      return { draftId: null, reason: 'Ei relevanttia, ei-punalipullista uutista tälle päivälle' };
    }

    finalPillar = chosenPillar;

    // Vaihe 4 — Luonnostelu
    const generated = await generateDrafts(projectId, chosenNews, finalPillar, aiModelConfig);
    options = generated.options;
  }

  const draftId = randomUUID();
  const magicToken = randomUUID();
  const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const editorEmailPlaceholder = ''; // resolved from Secret Manager at send time, not stored in Firestore

  const draft: DraftDocument = {
    id: draftId,
    date,
    createdAt: new Date().toISOString(),
    ...(chosenNews ? { sourceNews: chosenNews } : {}),
    pillar: finalPillar,
    options,
    status: 'pending_review',
    magicToken,
    tokenExpiresAt,
    editorEmail: editorEmailPlaceholder,
  };

  await db.collection('drafts').doc(draftId).set(draft);
  if (bankItemId) {
    await markBankItemUsed(db, bankItemId, date);
  }
  await recordPillarUse(db, isoWeek, finalPillar);
  await sendMagicLinkEmail(draft);

  return { draftId };
}
