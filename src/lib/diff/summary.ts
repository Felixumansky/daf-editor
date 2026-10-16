/** Pure helpers for the compare view: line counts per change and for the whole comparison. */
import type { Text } from '@codemirror/state';
import type { Chunk } from '@codemirror/merge';

export interface ChunkStats {
  removed: number;
  added: number;
}

export interface DiffSummary extends ChunkStats {
  changes: number;
  identical: boolean;
  /** False when the diff gave up early (very large or very different documents). */
  precise: boolean;
}

/** Whole lines a chunk covers in one document (0 when it covers none). */
function linesIn(doc: Text, from: number, to: number): number {
  if (from >= to) return 0;
  const end = Math.min(doc.length, Math.max(from, to - 1));
  return doc.lineAt(end).number - doc.lineAt(from).number + 1;
}

export function chunkStats(chunk: Chunk, a: Text, b: Text): ChunkStats {
  return { removed: linesIn(a, chunk.fromA, chunk.toA), added: linesIn(b, chunk.fromB, chunk.toB) };
}

export function summarize(chunks: readonly Chunk[], a: Text, b: Text): DiffSummary {
  let removed = 0;
  let added = 0;
  let precise = true;
  for (const c of chunks) {
    const s = chunkStats(c, a, b);
    removed += s.removed;
    added += s.added;
    if (!c.precise) precise = false;
  }
  return { changes: chunks.length, removed, added, identical: chunks.length === 0, precise };
}

/** Index of the chunk at (or nearest after) a position in one document; -1 when there are none. */
export function chunkIndexAt(chunks: readonly Chunk[], pos: number, side: 'a' | 'b'): number {
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const to = side === 'a' ? Math.max(c.fromA, c.toA) : Math.max(c.fromB, c.toB);
    if (pos <= to) return i;
  }
  return chunks.length - 1;
}

/** Text from outside the editor (clipboard, other files) may use CRLF; the editor works in LF. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
