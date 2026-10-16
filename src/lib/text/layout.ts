/** Fix text that was typed with the wrong keyboard layout active (Israeli SI-1452 ↔ US). */
import { hebrewKeysToLatin, latinKeysToHebrew } from '$lib/palette/hebrew';

const HEBREW_LETTER = /[א-ת]/;
const LATIN_LETTER = /[a-z]/i;

/** Convert in whichever direction the text's letters suggest: mostly Hebrew → Latin, otherwise → Hebrew. */
export function fixLayout(s: string): string {
  let he = 0;
  let lat = 0;
  for (const c of s) {
    if (HEBREW_LETTER.test(c)) he++;
    else if (LATIN_LETTER.test(c)) lat++;
  }
  return he > lat ? hebrewKeysToLatin(s) : latinKeysToHebrew(s);
}

/**
 * Start of the wrong-layout run that ends at `pos` in `line` (an offset into the line).
 * The run is the text typed in one script before the cursor: it stops at the first letter
 * of the other script, so in "שלום akuo nv" only "akuo nv" is picked.
 */
export function wrongLayoutRunStart(line: string, pos: number): number {
  let i = pos;
  while (i > 0 && /\s/.test(line[i - 1])) i--;
  if (i === 0) return pos;
  const script = HEBREW_LETTER.test(line[i - 1]) ? HEBREW_LETTER : LATIN_LETTER;
  const other = script === HEBREW_LETTER ? LATIN_LETTER : HEBREW_LETTER;
  let start = i;
  while (start > 0 && !other.test(line[start - 1])) start--;
  while (start < i && /\s/.test(line[start])) start++;
  return start;
}
