/** Per-line text direction from content (Unicode bidi rules P2/P3: the first strong character wins). */

export type Dir = 'ltr' | 'rtl';

const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
/** A letter, or an explicit LRM/RLM/ALM mark. */
const STRONG = /[\p{L}‎‏؜]/u;

/** Direction of the first strong character, or null for lines with none (empty, digits, punctuation). */
export function firstStrongDir(line: string): Dir | null {
  const m = STRONG.exec(line);
  if (!m) return null;
  const c = m[0];
  if (c === '‎') return 'ltr';
  if (c === '‏' || c === '؜') return 'rtl';
  return RTL_LETTER.test(c) ? 'rtl' : 'ltr';
}

/**
 * Direction for each line. Lines without a strong character inherit the previous line's direction,
 * so an empty line after Hebrew keeps the caret on the right and typing continues naturally.
 */
export function lineDirections(lines: readonly string[], before: Dir = 'ltr'): Dir[] {
  const out: Dir[] = [];
  let prev = before;
  for (const line of lines) {
    const d = firstStrongDir(line) ?? prev;
    out.push(d);
    prev = d;
  }
  return out;
}
