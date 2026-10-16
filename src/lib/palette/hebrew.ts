/** Hebrew-aware text normalization for search and the command palette. */

const NIQQUD = /[֑-ׇֽֿׁׂׅׄ]/g;

const FINAL_TO_REGULAR: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

/** Remove niqqud and cantillation marks. */
export function stripNiqqud(s: string): string {
  return s.replace(NIQQUD, '');
}

/** Lowercase, strip niqqud, fold final letters (ם → מ), so "שָׁלוֹם" matches "שלומ". */
export function normalize(s: string): string {
  return stripNiqqud(s.toLowerCase()).replace(/[ךםןףץ]/g, (c) => FINAL_TO_REGULAR[c]);
}

/** Israeli standard keyboard (SI-1452): which Hebrew letter each Latin key produces. */
const LATIN_TO_HEBREW: Record<string, string> = {
  q: '/', w: "'", e: 'ק', r: 'ר', t: 'א', y: 'ט', u: 'ו', i: 'ן', o: 'ם', p: 'פ',
  a: 'ש', s: 'ד', d: 'ג', f: 'כ', g: 'ע', h: 'י', j: 'ח', k: 'ל', l: 'ך', ';': 'ף',
  z: 'ז', x: 'ס', c: 'ב', v: 'ה', b: 'נ', n: 'מ', m: 'צ', ',': 'ת', '.': 'ץ', '/': '.',
};

const HEBREW_TO_LATIN: Record<string, string> = Object.fromEntries(
  Object.entries(LATIN_TO_HEBREW)
    .filter(([, he]) => /[א-ת]/.test(he))
    .map(([en, he]) => [he, en]),
);

/** Text typed with the Hebrew layout active while meaning English: "דשהק" → "save". */
export function hebrewKeysToLatin(s: string): string {
  return [...s].map((c) => HEBREW_TO_LATIN[c] ?? c).join('');
}

/** Text typed with the English layout active while meaning Hebrew: "aunr" → "שומר". */
export function latinKeysToHebrew(s: string): string {
  return [...s.toLowerCase()].map((c) => LATIN_TO_HEBREW[c] ?? c).join('');
}

export function hasHebrew(s: string): boolean {
  return /[֐-׿]/.test(s);
}
