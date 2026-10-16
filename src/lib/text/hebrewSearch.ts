/**
 * Turn a literal search into a regular expression that ignores niqqud and cantillation,
 * treats final letters like regular ones and accepts either form of geresh/gershayim:
 * "שלום" then finds "שָׁלוֹם" and "שלומ".
 */

/** Niqqud and cantillation marks (not maqaf, paseq or sof pasuq, which are punctuation). */
export const MARKS = '\\u0591-\\u05BD\\u05BF\\u05C1\\u05C2\\u05C4\\u05C5\\u05C7';
const MARK_RE = new RegExp(`[${MARKS}]`, 'u');

const LETTER_CLASS: Record<string, string> = {
  כ: '[כך]', ך: '[כך]', מ: '[מם]', ם: '[מם]', נ: '[נן]', ן: '[נן]',
  פ: '[פף]', ף: '[פף]', צ: '[צץ]', ץ: '[צץ]',
  "'": "['׳]", '׳': "['׳]", '"': '["״]', '״': '["״]',
};

function escapeRe(c: string): string {
  if (c === '\n') return '\\n';
  if (c === '\r') return '\\r';
  if (c === '\t') return '\\t';
  return /[.*+?^${}()|[\]\\/]/.test(c) ? '\\' + c : c;
}

/** `text` is the already-unquoted literal; the result is valid with the `u` flag. */
export function hebrewFoldRegex(text: string): string {
  let out = '';
  for (const c of text) {
    if (MARK_RE.test(c)) continue;
    if (/[א-ת]/.test(c)) out += `${LETTER_CLASS[c] ?? c}[${MARKS}]*`;
    else out += LETTER_CLASS[c] ?? escapeRe(c);
  }
  return out;
}

/** CodeMirror's literal-mode unquoting of \n, \r, \t and \\. */
export function unquote(text: string): string {
  return text.replace(/\\([nrt\\])/g, (_, ch) => (ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : '\\'));
}

/** A literal replacement for use with a regexp query: `$` must not expand to groups. */
export function literalReplacement(text: string): string {
  return text.replace(/\$/g, '$$$$');
}
