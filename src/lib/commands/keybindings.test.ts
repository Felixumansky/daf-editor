import { describe, expect, it } from 'vitest';
import { eventToChord, formatChord, normalizeChord, presetBindings, type KeyLike } from './keybindings';

const ev = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  code, key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
});

describe('eventToChord', () => {
  it('uses the physical key, so the Hebrew layout still triggers Ctrl+S', () => {
    expect(eventToChord({ ...ev('KeyS', { ctrlKey: true }), key: 'ד' }, false)).toBe('Mod+S');
  });

  it('orders modifiers canonically', () => {
    expect(eventToChord(ev('KeyP', { shiftKey: true, ctrlKey: true }), false)).toBe('Mod+Shift+P');
    expect(eventToChord(ev('KeyR', { altKey: true, ctrlKey: true }), false)).toBe('Mod+Alt+R');
  });

  it('maps Cmd to Mod on macOS and keeps Ctrl separate', () => {
    expect(eventToChord(ev('KeyS', { metaKey: true }), true)).toBe('Mod+S');
    expect(eventToChord(ev('KeyS', { ctrlKey: true }), true)).toBe('Ctrl+S');
  });

  it('falls back to keyCode when code is missing (synthetic input)', () => {
    expect(eventToChord({ ...ev('', { ctrlKey: true, shiftKey: true }), key: 'P', keyCode: 80 }, false)).toBe('Mod+Shift+P');
    expect(eventToChord({ ...ev(''), keyCode: 114 }, false)).toBe('F3');
  });

  it('ignores lone modifiers', () => {
    expect(eventToChord(ev('ShiftLeft', { shiftKey: true }), false)).toBeNull();
  });
});

describe('normalizeChord', () => {
  it('accepts any order and case', () => {
    expect(normalizeChord('shift+ctrl+p', false)).toBe('Mod+Shift+P');
    expect(normalizeChord('Mod+=', false)).toBe('Mod+=');
    expect(normalizeChord('ctrl+pagedown', false)).toBe('Mod+PageDown');
  });
});

describe('presets', () => {
  it('Notepad++ duplicates with Ctrl+D; VS Code adds the next occurrence', () => {
    const npp = presetBindings('notepad++', false);
    const vsc = presetBindings('vscode', false);
    expect(npp.get('edit.duplicateLine')).toContain('Mod+D');
    expect(vsc.get('edit.addNextOccurrence')).toContain('Mod+D');
  });

  it('the palette is Ctrl+Shift+P and F1 in both', () => {
    for (const p of ['notepad++', 'vscode'] as const) {
      expect(presetBindings(p, false).get('view.palette')).toEqual(['Mod+Shift+P', 'F1']);
    }
  });

  it('formats for display', () => {
    expect(formatChord('Mod+Shift+P', false)).toBe('Ctrl+Shift+P');
    expect(formatChord('Mod+Shift+P', true)).toBe('⌘+Shift+P');
  });
});
