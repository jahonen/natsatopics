import { NewsItem, RedFlagCheck } from './types';

/**
 * Fast, deterministic pre-filter for the punaiset liput (red flags) listed
 * in luku 8.3 of the content guide. This is a coarse net based on feed
 * category and obvious keywords; it is intentionally cheap and run before
 * any AI call. Nuanced judgment (e.g. "is this really domestic politics?")
 * is left to the Gemini classification step in gemini.ts, which is given
 * the full content guide as context.
 */
const DOMESTIC_POLITICS_CATEGORIES = ['politiikka', 'kotimaan politiikka'];

const KEYWORD_FLAGS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /kansallissosialis|natsi|nazi|kolmas valtakunta|iii\.\s*valtakunta/i, reason: 'Toinen maailmansota / kansallissosialismi' },
  { pattern: /terrori-?isku|joukkosurma|joukkoampu/i, reason: 'Terrori-isku tai joukkosurma' },
  { pattern: /itsemurha|mielenterveyskriisi|päihdeongelma/i, reason: 'Itsemurha, mielenterveyskriisi tai päihdeongelma' },
  { pattern: /eduskunta|hallitusohjelma|ministeri|puoluejohtaja|luottamusäänestys/i, reason: 'Kotimaan puoluepolitiikka' },
];

export function quickRedFlagCheck(news: NewsItem): RedFlagCheck {
  const reasons: string[] = [];

  if (DOMESTIC_POLITICS_CATEGORIES.includes(news.feedCategory.toLowerCase())) {
    reasons.push('Uutispalvelun luokka on kotimaan politiikka');
  }

  const haystack = `${news.title} ${news.summary}`;
  for (const { pattern, reason } of KEYWORD_FLAGS) {
    if (pattern.test(haystack)) {
      reasons.push(reason);
    }
  }

  return { flagged: reasons.length > 0, reasons };
}
