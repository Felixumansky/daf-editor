/** Numbers about a selection: word count, sum of the numbers in it, gematria. */

const GEMATRIA: Record<string, number> = {
  א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9,
  י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90,
  ק: 100, ר: 200, ש: 300, ת: 400,
};

/** Standard gematria (final letters count like regular ones): "שלום" → 376. */
export function gematria(s: string): number {
  let n = 0;
  for (const c of s) n += GEMATRIA[c] ?? 0;
  return n;
}

/** A word; Hebrew acronyms like צה"ל and geresh forms like ג׳ count as one. */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['׳"״][\p{L}\p{M}]+)*/gu;
const NUMBER = /(?<![\p{L}\p{N}.])-?\d+(?:\.\d+)?(?![\p{L}\d])/gu;

export interface SelectionStats {
  words: number;
  /** Present when the selection holds at least two numbers. */
  numbers: { count: number; sum: number; avg: number } | null;
  /** Present when the selection holds Hebrew letters. */
  gematria: number | null;
}

export function selectionStats(text: string): SelectionStats {
  const words = text.match(WORD)?.length ?? 0;
  const nums = (text.match(NUMBER) ?? []).map(Number);
  let numbers: SelectionStats['numbers'] = null;
  if (nums.length >= 2) {
    const sum = round(nums.reduce((a, b) => a + b, 0));
    numbers = { count: nums.length, sum, avg: round(sum / nums.length) };
  }
  const g = gematria(text);
  return { words, numbers, gematria: g > 0 ? g : null };
}

/** Hide floating-point noise (0.1 + 0.2). */
function round(n: number): number {
  return Math.round(n * 1e10) / 1e10;
}
