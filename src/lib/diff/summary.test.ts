import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import { Chunk } from '@codemirror/merge';
import { chunkIndexAt, chunkStats, normalizeEol, summarize } from './summary';

const doc = (s: string) => Text.of(s.split('\n'));
const build = (a: string, b: string) => {
  const da = doc(a);
  const db = doc(b);
  return { da, db, chunks: Chunk.build(da, db) };
};

describe('summarize', () => {
  it('reports identical documents', () => {
    const { da, db, chunks } = build('a\nb\nc', 'a\nb\nc');
    expect(summarize(chunks, da, db)).toEqual({ changes: 0, removed: 0, added: 0, identical: true, precise: true });
  });

  it('counts an added line', () => {
    const { da, db, chunks } = build('a\nb\nc', 'a\nb\nnew\nc');
    const s = summarize(chunks, da, db);
    expect(s.changes).toBe(1);
    expect(s.added).toBe(1);
    expect(s.removed).toBe(0);
  });

  it('counts removed lines', () => {
    const { da, db, chunks } = build('a\nb\nc\nd', 'a\nd');
    const s = summarize(chunks, da, db);
    expect(s).toMatchObject({ changes: 1, removed: 2, added: 0 });
  });

  it('counts a changed line on both sides', () => {
    const { da, db, chunks } = build('one\ntwo\nthree', 'one\nTWO\nthree');
    expect(chunks).toHaveLength(1);
    expect(chunkStats(chunks[0], da, db)).toEqual({ removed: 1, added: 1 });
  });

  it('handles Hebrew text and separate chunks', () => {
    const { da, db, chunks } = build('שלום\nעולם\nטוב\nמאוד\nסוף', 'שלום\nעולמות\nטוב\nמאוד\nסוף!');
    const s = summarize(chunks, da, db);
    expect(s).toMatchObject({ changes: 2, removed: 2, added: 2, identical: false });
  });

  it('counts a change on the last line without a trailing newline', () => {
    const { da, db, chunks } = build('a\nb', 'a\nc');
    expect(summarize(chunks, da, db)).toMatchObject({ changes: 1, removed: 1, added: 1 });
  });
});

describe('chunkIndexAt', () => {
  it('finds the chunk at or after a position', () => {
    const { chunks } = build('1\n2\n3\n4\n5\n6\n7\n8', '1\nX\n3\n4\n5\n6\nY\n8');
    expect(chunks).toHaveLength(2);
    expect(chunkIndexAt(chunks, 0, 'b')).toBe(0);
    expect(chunkIndexAt(chunks, chunks[1].fromB, 'b')).toBe(1);
    expect(chunkIndexAt([], 0, 'a')).toBe(-1);
  });
});

describe('normalizeEol', () => {
  it('turns CRLF and lone CR into LF', () => {
    expect(normalizeEol('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });

  it('makes CRLF text compare equal to the same LF text', () => {
    const { da, db, chunks } = build(normalizeEol('x\r\ny'), 'x\ny');
    expect(summarize(chunks, da, db).identical).toBe(true);
  });
});
