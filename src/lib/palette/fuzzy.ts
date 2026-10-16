import { hasHebrew, hebrewKeysToLatin, latinKeysToHebrew, normalize } from './hebrew';

/** No match. */
export const NO_MATCH = -Infinity;

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  return /[\s\-_./:>·(]/.test(prev) || (/[a-z]/.test(prev) && /[A-Z]/.test(text[i]));
}

/**
 * Score how well `query` matches `target` as an in-order subsequence.
 * Rewards substring hits, word starts and consecutive runs; penalizes gaps.
 * Both strings should already be normalized (see `normalize`).
 */
export function score(query: string, target: string, original: string = target): number {
  if (!query) return 0;
  let total = 0;
  const idx = target.indexOf(query);
  if (idx >= 0) {
    total += 20 + (isWordStart(original, idx) ? 10 : 0) + (idx === 0 ? 5 : 0);
  }
  let ti = 0;
  let prevMatch = -2;
  for (const qc of query) {
    if (qc === ' ') continue;
    const found = target.indexOf(qc, ti);
    if (found < 0) return NO_MATCH;
    total += 1;
    if (found === prevMatch + 1) total += 3;
    if (isWordStart(original, found)) total += 4;
    total -= Math.min(found - ti, 10) * 0.15;
    prevMatch = found;
    ti = found + 1;
  }
  // Shorter targets win ties.
  return total - target.length * 0.01;
}

/** Query variants: as typed, and as if typed with the other keyboard layout. */
export function queryVariants(raw: string): { text: string; penalty: number }[] {
  const q = raw.trim();
  const out = [{ text: normalize(q), penalty: 0 }];
  const swapped = hasHebrew(q) ? hebrewKeysToLatin(q) : latinKeysToHebrew(q);
  if (swapped !== q) out.push({ text: normalize(swapped), penalty: 3 });
  return out;
}

/** Best score of a query against several candidate strings (titles in both languages, keywords). */
export function bestScore(raw: string, candidates: string[]): number {
  const variants = queryVariants(raw);
  let best = NO_MATCH;
  for (const c of candidates) {
    if (!c) continue;
    const norm = normalize(c);
    for (const v of variants) {
      const s = score(v.text, norm, c) - v.penalty;
      if (s > best) best = s;
    }
  }
  return best;
}
