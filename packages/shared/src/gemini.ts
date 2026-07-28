import { VertexAI } from '@google-cloud/vertexai';
import { loadContentGuide } from './contentGuide';
import { NewsItem, DraftOption, Pillar, SocialPlatform, PLATFORM_CHAR_LIMITS } from './types';

const LOCATION = process.env.VERTEX_LOCATION ?? 'europe-north1';
const MODEL = process.env.VERTEX_MODEL ?? 'gemini-1.5-pro';

function getModel(projectId: string) {
  const vertexAi = new VertexAI({ project: projectId, location: LOCATION });
  return vertexAi.getGenerativeModel({ model: MODEL });
}

async function generateJson<T>(projectId: string, prompt: string): Promise<T> {
  const model = getModel(projectId);
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7,
    },
  });
  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');
  return JSON.parse(text) as T;
}

export interface RelevanceClassification {
  relevant: boolean;
  redFlagged: boolean;
  redFlagReasons: string[];
  pillar: Pillar | null;
  reasoning: string;
}

/**
 * Vaihe 2 & osittain vaihe 3: asks Gemini to judge, using the full content
 * guide as context, whether a scraped news item clears the red-flag list in
 * luku 8.3 and, if so, which sisältöpilari (luku 6) it best fits.
 */
export async function classifyNewsItem(projectId: string, news: NewsItem): Promise<RelevanceClassification> {
  const guide = loadContentGuide();
  const prompt = `Olet Natsastore-brändin sisällöntuotannon avustaja. Sinulle annetaan täydellinen sisällöntuotannon kulttuuriopas ja yksi uutinen. Arvioi opasta noudattaen:

1) Täyttyykö jokin luvun 8.3 "Punaiset liput" kohta? Jos kyllä, redFlagged=true ja listaa syyt suomeksi.
2) Jos ei punaista lippua, onko uutinen ylipäätään relevantti Natsastore-brändille (luku 6 pilarit: geopolitiikka ja turvallisuus TAI reservi- ja valmiuskulttuuri)? Nostalgia ja strateginen historia -pilarit EIVÄT synny uutissyötteestä, ne tulevat erillisestä pankista, älä siis valitse niitä tässä.
3) Jos relevantti, valitse pilari: "geopolitics" tai "reserve".

Palauta TARKALLEEN JSON-muodossa: {"relevant": boolean, "redFlagged": boolean, "redFlagReasons": string[], "pillar": "geopolitics"|"reserve"|null, "reasoning": string}

SISÄLTÖOPAS:
"""
${guide}
"""

UUTINEN:
Otsikko: ${news.title}
Tiivistelmä: ${news.summary}
Feed-kategoria: ${news.feedCategory}
URL: ${news.url}
Julkaistu: ${news.publishedAt}
`;

  return generateJson<RelevanceClassification>(projectId, prompt);
}

export interface DraftGenerationResult {
  options: DraftOption[];
}

/**
 * Vaihe 4 — Luonnostelu. Generates exactly three draft options for a given
 * news item and pillar, following luku 11's julkaisumallit and the tone,
 * vocabulary and register rules in luvut 5 and 7.
 */
export async function generateDrafts(
  projectId: string,
  news: NewsItem,
  pillar: Pillar
): Promise<DraftGenerationResult> {
  const guide = loadContentGuide();
  const prompt = `Olet Natsastore-brändin copywriter. Kirjoita TÄSMÄLLEEN kolme (3) vaihtoehtoista some-postausluonnosta annetusta uutisesta, pilarista "${pillar}", noudattaen tarkasti liitettyä sisällöntuotannon kulttuuriopasta: rekisteri (luku 5.1), sanasto (luku 5.2, 1-2 termiä per postaus, ei selittäen), kielletty kieli (luku 5.3), sävy (luku 7), julkaisumallit (luku 11: käytä malleja A, B tai D tämän uutispohjaisen pilarin kanssa; älä käytä mallia C paitsi jos uutinen koskee aselajien vertailua), ja luvun 10 vaihe 4 -sääntöjä (2-5 lyhyttä virkettä, yksi kysymys yleisölle, enintään yksi emoji, ei tuotelinkkiä).

Palauta TARKALLEEN JSON: {"options": [{"id": string, "text": string, "template": "A"|"B"|"C"|"D"}, ...]} — tasan 3 alkiota.

SISÄLTÖOPAS:
"""
${guide}
"""

UUTINEN:
Otsikko: ${news.title}
Tiivistelmä: ${news.summary}
URL: ${news.url}
`;

  return generateJson<DraftGenerationResult>(projectId, prompt);
}

/**
 * Nostalgia- ja historiapilarit (luku 6) eivät synny uutissyötteestä vaan
 * omasta aihepankista (packages/shared/contentBank.ts). Tämä generoi kolme
 * vaihtoehtoista postausta yhdestä pankin valmiiksi kirjoitetusta aiheesta
 * tai kysymyksestä, samoja rekisteri-, sanasto- ja sävysääntöjä noudattaen.
 */
export async function generateBankDrafts(
  projectId: string,
  bankPrompt: string,
  pillar: Pillar
): Promise<DraftGenerationResult> {
  const guide = loadContentGuide();
  const prompt = `Olet Natsastore-brändin copywriter. Kirjoita TÄSMÄLLEEN kolme (3) vaihtoehtoista some-postausluonnosta annetusta aihepankin ideasta, pilarista "${pillar}", noudattaen tarkasti liitettyä sisällöntuotannon kulttuuriopasta: rekisteri (luku 5.1), sanasto (luku 5.2, 1-2 termiä per postaus, ei selittäen), kielletty kieli (luku 5.3), sävy (luku 7), julkaisumallit (luku 11: pilarin "nostalgia" kanssa käytä ensisijaisesti mallia B, pilarin "history" kanssa vapaamuotoisempaa evergreen-otetta), ja luvun 10 vaihe 4 -sääntöjä (2-5 lyhyttä virkettä, yksi kysymys yleisölle, enintään yksi emoji, ei tuotelinkkiä).

Palauta TARKALLEEN JSON: {"options": [{"id": string, "text": string, "template": "A"|"B"|"C"|"D"}, ...]} — tasan 3 alkiota.

SISÄLTÖOPAS:
"""
${guide}
"""

AIHEPANKIN IDEA:
${bankPrompt}
`;

  return generateJson<DraftGenerationResult>(projectId, prompt);
}

/**
 * Vaihe 7 (julkaisupipeline): if the editor-approved final text does not fit
 * a platform's character limit, ask Gemini to shorten it while preserving
 * meaning, tone and the single audience question, per the same guide rules.
 */
export async function adaptForPlatform(
  projectId: string,
  finalText: string,
  platform: SocialPlatform
): Promise<string> {
  const limit = PLATFORM_CHAR_LIMITS[platform];
  const guide = loadContentGuide();
  const prompt = `Muokkaa seuraava Natsastore-some-postaus mahtumaan alustan "${platform}" merkkirajaan (${limit} merkkiä), säilyttäen sisältö, sävy (luku 7) ja sanasto (luku 5) sisältöoppaan mukaisina. Älä lisää tuotelinkkiä. Palauta TARKALLEEN JSON: {"text": string}.

SISÄLTÖOPAS (tiivistetty relevantit luvut):
"""
${guide}
"""

ALKUPERÄINEN TEKSTI:
"""
${finalText}
"""
`;

  const result = await generateJson<{ text: string }>(projectId, prompt);
  return result.text;
}
