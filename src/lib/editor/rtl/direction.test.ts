import { describe, expect, it } from 'vitest';
import { firstStrongDir, lineDirections } from './direction';

describe('firstStrongDir', () => {
  it.each([
    ['שלום world', 'rtl'],
    ['hello עולם', 'ltr'],
    ['מחיר 100 ש״ח', 'rtl'],
    ['1. שלום', 'rtl'],
    ['  - item', 'ltr'],
    ['שָׁלוֹם', 'rtl'],
    ['‏abc', 'rtl'],
    ['‎שלום', 'ltr'],
    ['مرحبا', 'rtl'],
  ] as const)('%s → %s', (line, dir) => {
    expect(firstStrongDir(line)).toBe(dir);
  });

  it('returns null for neutral lines', () => {
    expect(firstStrongDir('')).toBeNull();
    expect(firstStrongDir('123 - 456')).toBeNull();
  });
});

describe('lineDirections', () => {
  it('neutral lines inherit the previous direction', () => {
    expect(lineDirections(['שלום', '', '123', 'hello', ''])).toEqual(['rtl', 'rtl', 'rtl', 'ltr', 'ltr']);
  });

  it('uses the given starting direction', () => {
    expect(lineDirections(['', 'abc'], 'rtl')).toEqual(['rtl', 'ltr']);
  });
});
