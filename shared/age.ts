// Shared: canon-age parsing and DeviantArt risk level for a character.
// DeviantArt bans sexual/suggestive content of characters who are minors in canon OR look like minors,
// whatever age the artist states ("aged up" does not count).

export type AgeInfo = {
  ageText: string; // as written by the source, e.g. "16-23 (physically), 27 (chronologically)"
  ageSource: 'anilist' | 'manual' | '';
  ageUrl: string; // AniList character page
  youngScore: number | null; // % of the character's Danbooru posts tagged `loli`
  ageCheckedAt: string;
};

export type RiskLevel = 'minor' | 'young' | 'ok' | 'unknown';
export type Risk = { level: RiskLevel; reasons: string[] };

/** Calibrated on Danbooru: child characters ≥ 10 % (Kanna 36, Illya 22, Anya 12), adult/teen designs ≤ 1 %. */
export const YOUNG_RED = 10;
export const YOUNG_ORANGE = 3;

const WORD_AGES: [RegExp, number][] = [
  [/\b(child|kid|toddler|infant|baby|elementary)\b/i, 8],
  [/\b(pre-?teen|tween)\b/i, 11],
  [/\b(teen|teenager|teenage|middle school|high school(er)?)\b/i, 15],
];

/** Lowest age mentioned in a free-text age ("16-23 (physically), 27" → 16 ; "Early 20s" → 20 ; "1000+" → 1000). */
export function minAge(text: string): number | null {
  if (!text.trim()) return null;
  // "17 (Part 1), 20 (Season 2)" → ignore the part/season numbers.
  const clean = text.replace(/\b(part|season|chapter|arc|episode|ep|vol|volume|book|movie|game)\.?\s*#?\d+/gi, ' ');
  const nums = [...clean.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((n) => n > 0 && n < 100000);
  const words = WORD_AGES.filter(([re]) => re.test(text)).map(([, n]) => n);
  const all = [...nums, ...words];
  return all.length ? Math.min(...all) : null;
}

export function ageRisk(a: Partial<AgeInfo>): Risk {
  const reasons: string[] = [];
  let level: RiskLevel = 'ok';
  const min = minAge(a.ageText ?? '');
  if (min !== null && min < 18) {
    level = 'minor';
    reasons.push(`Canon age ${a.ageText} — under 18${a.ageSource === 'anilist' ? ' (AniList)' : ''}`);
  }
  const y = a.youngScore;
  if (y != null && y >= YOUNG_RED) {
    level = 'minor';
    reasons.push(`Drawn as a child: ${y.toFixed(1)} % of Danbooru posts tagged “loli”`);
  } else if (y != null && y >= YOUNG_ORANGE) {
    if (level === 'ok') level = 'young';
    reasons.push(`Often drawn young: ${y.toFixed(1)} % of Danbooru posts tagged “loli”`);
  }
  if (min === null && y == null) return { level: 'unknown', reasons: ['No age data (not checked or not found)'] };
  if (min === null && level === 'ok') return { level: 'unknown', reasons: ['Canon age unknown — check it yourself', ...reasons] };
  return { level, reasons };
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  minor: 'Minor in canon or drawn as a child',
  young: 'Often drawn young',
  ok: 'Adult',
  unknown: 'Age unknown',
};
