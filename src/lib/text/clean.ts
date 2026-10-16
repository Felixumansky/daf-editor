/**
 * Clean text pasted from Word, browsers and chat apps: drop the invisible direction marks and
 * zero-width characters they add, and turn non-breaking spaces into plain ones.
 * ZWJ/ZWNJ (U+200C/U+200D) are kept: emoji sequences and some scripts need them.
 */
const CLEAN = /[​‎‏؜‪-‮⁦-⁩﻿­  ]/g;
const NBSP = new Set([' ', ' ']);

export interface CleanEdit {
  from: number;
  to: number;
  insert: string;
}

/** One edit per character to drop or replace, as offsets into `s`. */
export function cleanEdits(s: string): CleanEdit[] {
  const out: CleanEdit[] = [];
  for (const m of s.matchAll(CLEAN)) out.push({ from: m.index, to: m.index + 1, insert: NBSP.has(m[0]) ? ' ' : '' });
  return out;
}

export function cleanPasted(s: string): { text: string; removed: number } {
  const edits = cleanEdits(s);
  let text = '';
  let at = 0;
  for (const e of edits) {
    text += s.slice(at, e.from) + e.insert;
    at = e.to;
  }
  return { text: text + s.slice(at), removed: edits.length };
}

/** Subtitle files use direction marks on purpose (to keep punctuation on the right side). */
export function keepsDirectionMarks(path: string | null): boolean {
  return !!path && /\.(srt|vtt|ass|ssa|sub|sbv)$/i.test(path);
}
