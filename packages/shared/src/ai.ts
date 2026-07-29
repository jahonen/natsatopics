import { GoogleAuth } from 'google-auth-library';
import { loadContentGuide } from './contentGuide';
import { NewsItem, DraftOption, Pillar, SocialPlatform, PLATFORM_CHAR_LIMITS } from './types';

/**
 * Defaults used if the caller doesn't pass an explicit model config. Callers
 * in `functions/` fetch the live values from Parameter Manager
 * (`AI_MODEL_NAME` / `AI_MODEL_LOCATION`, see `functions/src/params.ts`) so
 * the model can be swapped without a code deploy as providers retire models.
 */
const DEFAULT_MODEL = 'mistral-medium-3';
const DEFAULT_LOCATION = 'europe-west4';

export interface AiModelConfig {
  model?: string;
  location?: string;
}

let cachedAuth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!cachedAuth) {
    cachedAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  return cachedAuth;
}

interface MistralChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/**
 * Calls a Mistral AI model hosted on Vertex AI Model Garden
 * (publishers/mistralai) via its OpenAI-compatible chat completion
 * (`rawPredict`) endpoint, requesting strict JSON output. Vertex AI's own
 * `generateContent` API is Gemini-only, hence the different request/response
 * shape from the previous `@google-cloud/vertexai`-based implementation.
 */
async function generateJson<T>(projectId: string, prompt: string, config?: AiModelConfig): Promise<T> {
  const model = config?.model ?? DEFAULT_MODEL;
  const location = config?.location ?? DEFAULT_LOCATION;

  const auth = getAuth();
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain a Google Cloud access token for Vertex AI');

  const res = await fetch(
    `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/mistralai/models/${model}:rawPredict`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
        temperature: 0.6,
        response_format: { type: 'json_object' },
        stream: false,
      }),
    }
  );

  const data = (await res.json()) as MistralChatResponse;
  if (!res.ok) {
    throw new Error(`Vertex AI (${model}) request failed: ${data?.error?.message ?? `HTTP ${res.status}`}`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`Vertex AI (${model}) returned no content`);
  return JSON.parse(text) as T;
}

/**
 * Explicit Finnish-language quality bar for every prompt that produces text
 * which gets published as-is. LLMs left to their own devices tend to
 * produce grammatically "off" Finnish that a native reader immediately
 * spots — split compound words, wrong case endings, missing/extra commas,
 * and stiff, translated-sounding phrasing. This is injected into every
 * copy-generating prompt so the output should pass the scrutiny of a
 * Finnish lukio (upper-secondary) mother-tongue teacher, not just be
 * "understandable".
 */
const FINNISH_QUALITY_INSTRUCTIONS = `KIELELLINEN LAATUVAATIMUS (tärkeä):
Tekstin pitää olla sellaista suomea, että äidinkielen ja kirjallisuuden lukio-opettaja hyväksyisi sen sellaisenaan — ei tekoälymäistä, kankeaa tai suomennokselta kuulostavaa kieltä. Varmista erityisesti:
- JOKAINEN virke on kieliopillisesti täydellinen: siinä on selvä subjekti ja finiittiverbi (predikaatti). Älä käytä irrallisia lausekkeita tai nominaalirakenteita virkkeen asemesta (esim. "Toimenpide vastineena jännitteisiin." EI kelpaa — kirjoita täydellinen virke, kuten "Toimenpide on vastaus jännitteisiin.").
- Sijamuodot ja taipumukset ovat kieliopillisesti täsmälleen oikein, myös hankalissa rakenteissa. Esimerkiksi "on"-verbin jälkeen ajanilmauksessa käytetään nominatiivia, ei partitiivia: "Nyt on hyvä aika…", EI "Nyt on hyvää aikaa…". Tarkista jokainen sijamuoto erikseen, äläkä luota ensimmäiseen mieleen tulevaan muotoon.
- Yhdyssanat kirjoitetaan YHTEEN, kuten suomen kielioppi vaatii (esim. "kertausharjoitus", ei "kertaus harjoitus"; "maanpuolustustahto", ei "maanpuolustus tahto").
- Pilkut ja välimerkit noudattavat suomen kielen sääntöjä (esim. pilkku ennen "mutta", "vaan", sivulauseen edellä kun se ei ole "että"-lause objektina).
- Lauserakenne on luonnollista, sujuvaa yleiskieltä — ei suoraan englannista käännetyn kuuloista rakennetta (esim. vältä passiivin liikakäyttöä ja kankeita substantiivirakenteita, jos aktiivi ja verbi kuulostaisivat luonnollisemmalta).
- Ei toistoa: samaa sanaa tai rakennetta ei käytetä turhaan peräkkäisissä virkkeissä.
- Isot ja pienet alkukirjaimet oikein (erisnimet, virkkeen alku).
Kirjoita teksti ensin mielessäsi, lue se sitten kokonaan uudelleen läpi virke virkkeeltä ikään kuin tarkistaisit oppilaan aineen kielioppia, korjaa jokainen löytämäsi kielioppi-, sijamuoto-, oikeinkirjoitus- ja välimerkkivirhe, ja palauta vasta tämän jälkeen lopullinen, korjattu versio.`;

export interface RelevanceClassification {
  relevant: boolean;
  redFlagged: boolean;
  redFlagReasons: string[];
  pillar: Pillar | null;
  reasoning: string;
}

/**
 * Vaihe 2 & osittain vaihe 3: asks the model to judge, using the full content
 * guide as context, whether a scraped news item clears the red-flag list in
 * luku 8.3 and, if so, which sisältöpilari (luku 6) it best fits.
 */
export async function classifyNewsItem(
  projectId: string,
  news: NewsItem,
  config?: AiModelConfig
): Promise<RelevanceClassification> {
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

  return generateJson<RelevanceClassification>(projectId, prompt, config);
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
  pillar: Pillar,
  config?: AiModelConfig
): Promise<DraftGenerationResult> {
  const guide = loadContentGuide();
  const prompt = `Olet Natsastore-brändin copywriter. Kirjoita TÄSMÄLLEEN kolme (3) vaihtoehtoista some-postausluonnosta annetusta uutisesta, pilarista "${pillar}", noudattaen tarkasti liitettyä sisällöntuotannon kulttuuriopasta: rekisteri (luku 5.1), sanasto (luku 5.2, 1-2 termiä per postaus, ei selittäen), kielletty kieli (luku 5.3), sävy (luku 7), julkaisumallit (luku 11: käytä malleja A, B tai D tämän uutispohjaisen pilarin kanssa; älä käytä mallia C paitsi jos uutinen koskee aselajien vertailua), ja luvun 10 vaihe 4 -sääntöjä (2-5 lyhyttä virkettä, yksi kysymys yleisölle, enintään yksi emoji, ei tuotelinkkiä).

Palauta TARKALLEEN JSON: {"options": [{"id": string, "text": string, "template": "A"|"B"|"C"|"D"}, ...]} — tasan 3 alkiota.

${FINNISH_QUALITY_INSTRUCTIONS}

SISÄLTÖOPAS:
"""
${guide}
"""

UUTINEN:
Otsikko: ${news.title}
Tiivistelmä: ${news.summary}
URL: ${news.url}
`;

  return generateJson<DraftGenerationResult>(projectId, prompt, config);
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
  pillar: Pillar,
  config?: AiModelConfig
): Promise<DraftGenerationResult> {
  const guide = loadContentGuide();
  const prompt = `Olet Natsastore-brändin copywriter. Kirjoita TÄSMÄLLEEN kolme (3) vaihtoehtoista some-postausluonnosta annetusta aihepankin ideasta, pilarista "${pillar}", noudattaen tarkasti liitettyä sisällöntuotannon kulttuuriopasta: rekisteri (luku 5.1), sanasto (luku 5.2, 1-2 termiä per postaus, ei selittäen), kielletty kieli (luku 5.3), sävy (luku 7), julkaisumallit (luku 11: pilarin "nostalgia" kanssa käytä ensisijaisesti mallia B, pilarin "history" kanssa vapaamuotoisempaa evergreen-otetta), ja luvun 10 vaihe 4 -sääntöjä (2-5 lyhyttä virkettä, yksi kysymys yleisölle, enintään yksi emoji, ei tuotelinkkiä).

Palauta TARKALLEEN JSON: {"options": [{"id": string, "text": string, "template": "A"|"B"|"C"|"D"}, ...]} — tasan 3 alkiota.

${FINNISH_QUALITY_INSTRUCTIONS}

SISÄLTÖOPAS:
"""
${guide}
"""

AIHEPANKIN IDEA:
${bankPrompt}
`;

  return generateJson<DraftGenerationResult>(projectId, prompt, config);
}

/**
 * Vaihe 7 (julkaisupipeline): if the editor-approved final text does not fit
 * a platform's character limit, ask the model to shorten it while preserving
 * meaning, tone and the single audience question, per the same guide rules.
 */
export async function adaptForPlatform(
  projectId: string,
  finalText: string,
  platform: SocialPlatform,
  config?: AiModelConfig
): Promise<string> {
  const limit = PLATFORM_CHAR_LIMITS[platform];
  const guide = loadContentGuide();
  const prompt = `Muokkaa seuraava Natsastore-some-postaus mahtumaan alustan "${platform}" merkkirajaan (${limit} merkkiä), säilyttäen sisältö, sävy (luku 7) ja sanasto (luku 5) sisältöoppaan mukaisina. Älä lisää tuotelinkkiä. Palauta TARKALLEEN JSON: {"text": string}.

${FINNISH_QUALITY_INSTRUCTIONS}

SISÄLTÖOPAS (tiivistetty relevantit luvut):
"""
${guide}
"""

ALKUPERÄINEN TEKSTI:
"""
${finalText}
"""
`;

  const result = await generateJson<{ text: string }>(projectId, prompt, config);
  return result.text;
}
