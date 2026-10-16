import { describe, expect, it } from 'vitest';
import { fixLayout, wrongLayoutRunStart } from './layout';
import { cleanPasted } from './clean';
import { gematria, selectionStats } from './hebrewStats';
import { CalcError, evaluate, formatResult, looksLikeMath } from './calc';
import { hebrewFoldRegex, literalReplacement, unquote } from './hebrewSearch';

describe('fixLayout', () => {
  it('converts Latin gibberish to Hebrew and back', () => {
    expect(fixLayout('akuo')).toBe('שלום');
    expect(fixLayout('דשהק')).toBe('save');
  });

  it('keeps digits and spaces', () => {
    expect(fixLayout('akuo 123')).toBe('שלום 123');
  });

  it('finds the wrong-layout run before the cursor', () => {
    const line = 'שלום akuo nv';
    expect(line.slice(wrongLayoutRunStart(line, line.length))).toBe('akuo nv');
    expect(wrongLayoutRunStart('   ', 3)).toBe(3);
    expect(wrongLayoutRunStart('akuo', 4)).toBe(0);
  });
});

describe('cleanPasted', () => {
  it('drops direction marks and zero-width characters', () => {
    expect(cleanPasted('‏שלום‎ world‫!‬')).toEqual({ text: 'שלום world!', removed: 4 });
  });

  it('turns non-breaking spaces into spaces and keeps ZWJ', () => {
    expect(cleanPasted('a b‍c')).toEqual({ text: 'a b‍c', removed: 1 });
  });

  it('leaves clean text alone', () => {
    expect(cleanPasted('hello')).toEqual({ text: 'hello', removed: 0 });
  });
});

describe('selection stats', () => {
  it('computes gematria', () => {
    expect(gematria('שלום')).toBe(376);
    expect(gematria('שָׁלוֹם')).toBe(376);
    expect(gematria('abc')).toBe(0);
  });

  it('counts words, including Hebrew acronyms', () => {
    expect(selectionStats('צה"ל הוא צבא').words).toBe(3);
    expect(selectionStats('hello, world').words).toBe(2);
  });

  it('sums numbers', () => {
    expect(selectionStats('10 20 30').numbers).toEqual({ count: 3, sum: 60, avg: 20 });
    expect(selectionStats('0.1\n0.2').numbers?.sum).toBe(0.3);
    expect(selectionStats('only 5').numbers).toBeNull();
    expect(selectionStats('v2 and x3').numbers).toBeNull();
  });
});

describe('calc', () => {
  it('respects precedence and parentheses', () => {
    expect(evaluate('12*3+4')).toBe(40);
    expect(evaluate('(1+2)*3')).toBe(9);
    expect(evaluate('2^3^2')).toBe(512);
    expect(evaluate('-2^2')).toBe(-4);
    expect(evaluate('10 % 4')).toBe(2);
    expect(evaluate('6 × 7 ÷ 2')).toBe(21);
    expect(evaluate('1,234 + 1')).toBe(1235);
  });

  it('rejects bad input', () => {
    expect(() => evaluate('1/0')).toThrow(CalcError);
    expect(() => evaluate('1+')).toThrow(CalcError);
    expect(() => evaluate('(1')).toThrow(CalcError);
    expect(() => evaluate('alert(1)')).toThrow(CalcError);
  });

  it('formats without float noise', () => {
    expect(formatResult(0.1 + 0.2)).toBe('0.3');
    expect(formatResult(-0)).toBe('0');
  });

  it('tells math from prose', () => {
    expect(looksLikeMath('12*3+4')).toBe(true);
    expect(looksLikeMath('hello')).toBe(false);
  });
});

describe('hebrew search', () => {
  const find = (q: string, text: string) => new RegExp(hebrewFoldRegex(unquote(q)), 'gmu').test(text);

  it('ignores niqqud and final letters', () => {
    expect(find('שלום', 'אמר שָׁלוֹם לכולם')).toBe(true);
    expect(find('שלומ', 'שלום')).toBe(true);
    expect(find('שָׁלוֹם', 'שלום')).toBe(true);
    expect(find('שלום', 'שלוש')).toBe(false);
  });

  it('accepts either geresh form', () => {
    expect(find('צה"ל', 'צה״ל')).toBe(true);
  });

  it('escapes regex characters', () => {
    expect(find('a.b (שם)', 'a.b (שם)')).toBe(true);
    expect(find('a.b', 'axb')).toBe(false);
  });

  it('keeps $ literal in replacements', () => {
    expect('x'.replace(/x/, literalReplacement('$1 $$'))).toBe('$1 $$');
  });
});
