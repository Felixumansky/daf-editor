/**
 * Key chords like "Mod+Shift+P". `Mod` is Ctrl on Windows/Linux and Cmd on macOS.
 * Letters and digits are read from `KeyboardEvent.code` (the physical key), so shortcuts keep
 * working while the Hebrew keyboard layout is active (Ctrl+S, not Ctrl+ד).
 */

const MOD_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'] as const;

const CODE_NAMES: Record<string, string> = {
  Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Slash: '/',
  Comma: ',', Period: '.', Semicolon: ';', Quote: "'", Backquote: '`',
  NumpadAdd: 'NumAdd', NumpadSubtract: 'NumSub', NumpadMultiply: 'NumMul', NumpadDivide: 'NumDiv',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown',
};

/** Canonical spelling of every multi-letter key name ("pagedown" → "PageDown", "f3" → "F3"). */
const KEY_NAMES = new Map<string, string>([
  ...Object.values(CODE_NAMES).map((n) => [n.toLowerCase(), n] as [string, string]),
  ...Array.from({ length: 24 }, (_, i) => [`f${i + 1}`, `F${i + 1}`] as [string, string]),
  ...Array.from({ length: 10 }, (_, i) => [`num${i}`, `Num${i}`] as [string, string]),
  ['esc', 'Escape'], ['del', 'Delete'], ['pgup', 'PageUp'], ['pgdn', 'PageDown'],
]);

export interface KeyLike {
  code: string;
  key: string;
  /** Virtual-key code; the fallback when `code` is missing (synthetic input, remote desktop). */
  keyCode?: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Windows virtual-key codes → key names. Also layout-independent for letters and digits. */
const VK_NAMES: Record<number, string> = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 27: 'Escape', 32: 'Space', 33: 'PageUp', 34: 'PageDown',
  35: 'End', 36: 'Home', 37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down', 45: 'Insert', 46: 'Delete',
  107: 'NumAdd', 109: 'NumSub', 106: 'NumMul', 111: 'NumDiv', 187: '=', 189: '-', 188: ',', 190: '.',
  191: '/', 186: ';', 219: '[', 221: ']', 220: '\\', 222: "'", 192: '`',
};

function keyName(e: KeyLike): string | null {
  let m = /^Key([A-Z])$/.exec(e.code);
  if (m) return m[1];
  m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (m) return e.code.startsWith('Numpad') ? `Num${m[1]}` : m[1];
  if (/^F\d{1,2}$/.test(e.code)) return e.code;
  if (CODE_NAMES[e.code]) return CODE_NAMES[e.code];
  if (/^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(e.code)) return null;
  const vk = e.keyCode ?? 0;
  if (vk >= 65 && vk <= 90) return String.fromCharCode(vk);
  if (vk >= 48 && vk <= 57) return String.fromCharCode(vk);
  if (vk >= 96 && vk <= 105) return `Num${vk - 96}`;
  if (vk >= 112 && vk <= 135) return `F${vk - 111}`;
  return VK_NAMES[vk] ?? null;
}

/** The chord a keyboard event represents, or null for a lone modifier. */
export function eventToChord(e: KeyLike, isMac: boolean): string | null {
  const key = keyName(e);
  if (!key) return null;
  const mods: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('Mod');
  if (isMac && e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

/** Canonical form of a written chord: "shift+ctrl+p" → "Mod+Shift+P" (on non-Mac). */
export function normalizeChord(chord: string, isMac: boolean): string {
  const parts = chord.split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() ?? '';
  const mods = new Set<string>();
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'mod' || l === 'cmd' || l === 'meta') mods.add('Mod');
    else if (l === 'ctrl' || l === 'control') mods.add(isMac ? 'Ctrl' : 'Mod');
    else if (l === 'alt' || l === 'option') mods.add('Alt');
    else if (l === 'shift') mods.add('Shift');
  }
  const k = key.length === 1 ? key.toUpperCase() : (KEY_NAMES.get(key.toLowerCase()) ?? key);
  return [...MOD_ORDER.filter((m) => mods.has(m)), k].join('+');
}

/** Human-readable chord for menus and the palette. */
export function formatChord(chord: string, isMac: boolean): string {
  return chord
    .split('+')
    .map((p) => (p === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : p === 'Alt' && isMac ? '⌥' : p))
    .join('+');
}

export type Preset = 'notepad++' | 'vscode';

/** Command id → chords. Notepad++ is the default; the VS Code preset overrides a few. */
const COMMON: Record<string, string[]> = {
  'file.new': ['Mod+N'],
  'file.open': ['Mod+O'],
  'file.save': ['Mod+S'],
  'file.saveAll': ['Mod+Shift+S'],
  'file.close': ['Mod+W', 'Mod+F4'],
  'file.reopenClosed': ['Mod+Shift+T'],
  'search.find': ['Mod+F'],
  'search.replace': ['Mod+H'],
  'search.findNext': ['F3'],
  'search.findPrev': ['Shift+F3'],
  'search.gotoLine': ['Mod+G'],
  'view.palette': ['Mod+Shift+P', 'F1'],
  'view.zoomIn': ['Mod+=', 'Mod+NumAdd'],
  'view.zoomOut': ['Mod+-', 'Mod+NumSub'],
  'view.zoomReset': ['Mod+0', 'Mod+NumDiv'],
  'view.wordWrap': ['Alt+Z'],
  'view.dirRtl': ['Mod+Alt+R'],
  'view.dirLtr': ['Mod+Alt+L'],
  'view.nextTab': ['Mod+Tab', 'Mod+PageDown'],
  'view.prevTab': ['Mod+Shift+Tab', 'Mod+PageUp'],
  'view.tabs': ['Mod+E'],
  'file.openRecent': ['Mod+R'],
  'edit.upperCase': ['Mod+Shift+U'],
  'edit.lowerCase': ['Mod+U'],
  'edit.joinLines': ['Mod+J'],
  'edit.fixLayout': ['Mod+Alt+K'],
  'edit.evaluate': ['Mod+Alt+='],
  'edit.pasteRaw': ['Mod+Shift+V'],
  'view.markdownPreview': ['Mod+Alt+P'],
  'compare.withTab': ['Mod+Alt+C'],
  'compare.next': ['F7'],
  'compare.prev': ['Shift+F7'],
  'compare.copyToRight': ['Alt+Shift+Right'],
  'compare.copyToLeft': ['Alt+Shift+Left'],
};

const PRESETS: Record<Preset, Record<string, string[]>> = {
  'notepad++': {
    ...COMMON,
    'file.saveAs': ['Mod+Alt+S'],
    'edit.duplicateLine': ['Mod+D'],
    'edit.deleteLine': ['Mod+Shift+L'],
    'edit.moveLineUp': ['Mod+Shift+Up'],
    'edit.moveLineDown': ['Mod+Shift+Down'],
    'edit.toggleComment': ['Mod+Q', 'Mod+/'],
    'edit.toggleBlockComment': ['Mod+Shift+Q'],
    'edit.addNextOccurrence': ['Mod+Alt+D'],
    'edit.selectAllOccurrences': ['Mod+Alt+Shift+D'],
  },
  vscode: {
    ...COMMON,
    'file.saveAs': ['Mod+Shift+Alt+S'],
    'edit.duplicateLine': ['Shift+Alt+Down'],
    'edit.deleteLine': ['Mod+Shift+K'],
    'edit.moveLineUp': ['Alt+Up'],
    'edit.moveLineDown': ['Alt+Down'],
    'edit.toggleComment': ['Mod+/'],
    'edit.toggleBlockComment': ['Shift+Alt+A'],
    'edit.addNextOccurrence': ['Mod+D'],
    'edit.selectAllOccurrences': ['Mod+Shift+L'],
    'search.gotoLine': ['Mod+G'],
    'view.tabs': ['Mod+P'],
  },
};

export function presetBindings(preset: Preset, isMac: boolean): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, chords] of Object.entries(PRESETS[preset] ?? PRESETS['notepad++'])) {
    out.set(id, chords.map((c) => normalizeChord(c, isMac)));
  }
  return out;
}
