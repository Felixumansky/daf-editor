import { describe, expect, it } from 'vitest';
import { NO_MATCH, bestScore, score } from './fuzzy';
import { hebrewKeysToLatin, latinKeysToHebrew, normalize } from './hebrew';

describe('hebrew normalization', () => {
  it('strips niqqud and folds final letters', () => {
    expect(normalize('שָׁלוֹם')).toBe('שלומ');
    expect(normalize('Save')).toBe('save');
  });

  it('maps keyboard layouts both ways', () => {
    expect(hebrewKeysToLatin('דשהק')).toBe('save');
    expect(latinKeysToHebrew('aunr')).toBe('שומר');
  });
});

describe('fuzzy score', () => {
  it('requires an in-order subsequence', () => {
    expect(score('sv', 'save')).toBeGreaterThan(NO_MATCH);
    expect(score('vs', 'save')).toBe(NO_MATCH);
  });

  it('prefers word starts and substrings', () => {
    expect(score('sa', 'save as')).toBeGreaterThan(score('sa', 'close all'));
  });

  const save = ['File: Save', 'קובץ: שמור', 'write'];
  const saveAll = ['File: Save All', 'קובץ: שמור הכל'];
  const wrap = ['View: Word Wrap', 'תצוגה: גלישת שורות'];

  it.each([['save'], ['שמור'], ['דשהק'], ['שומר'.replace('ו', '')]])('finds Save from %s', (q) => {
    expect(bestScore(q, save)).toBeGreaterThan(bestScore(q, wrap));
  });

  it('ranks the shorter exact title first', () => {
    expect(bestScore('save', save)).toBeGreaterThan(bestScore('save', saveAll));
  });
});
