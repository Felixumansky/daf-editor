/** Quick-pick flows: command palette, go to line, encoding, line endings, language, recent, tabs. */
import { CATEGORY_TITLES, registry } from './registry';
import { ws, tabTitle } from '$lib/state/workspace.svelte';
import { ui, type QuickPickItem } from '$lib/ui.svelte';
import { i18n, pick, t } from '$lib/i18n/index.svelte';
import { LANGUAGES } from '$lib/editor/languages';
import { bestScore } from '$lib/palette/fuzzy';
import type { Eol } from '$lib/ipc/api';

export function openPalette() {
  ui.openQuickPick({
    placeholder: t('palette.placeholder'),
    emptyText: t('palette.empty'),
    items: (q) =>
      registry.search(q, ws.commandMru).slice(0, 80).map((c) => ({
        id: c.id,
        label: `${pick(CATEGORY_TITLES[c.category])}: ${pick(c.title)}`,
        // Hebrew titles stay searchable, but are only shown when the UI is in Hebrew.
        detail: i18n.lang === 'he' ? c.title.en : undefined,
        hint: registry.keyLabel(c.id),
      })),
    onAccept: (item) => {
      if (!item) return;
      ws.commandMru = [item.id, ...ws.commandMru.filter((id) => id !== item.id)].slice(0, 50);
      registry.run(item.id);
    },
  });
}

export function gotoLine() {
  const max = ws.view?.state.doc.lines ?? 1;
  const parse = (q: string) => {
    const m = /^\s*(\d+)\s*(?:[:,]\s*(\d+))?\s*$/.exec(q);
    if (!m) return null;
    const line = Number(m[1]);
    return line >= 1 && line <= max ? { line, col: m[2] ? Number(m[2]) : 1 } : null;
  };
  ui.openQuickPick({
    placeholder: t('goto.placeholder', { max }),
    validate: (q) => (q.trim() && !parse(q) ? t('goto.invalid', { max }) : null),
    onAccept: (_, q) => {
      const p = parse(q);
      if (p) ws.goTo(p.line, p.col);
    },
  });
}

interface EncodingChoice {
  label: string;
  encoding: string;
  bom?: boolean;
  desc: string;
}

export const ENCODINGS: EncodingChoice[] = [
  { label: 'UTF-8', encoding: 'UTF-8', bom: false, desc: 'Unicode' },
  { label: 'UTF-8 with BOM', encoding: 'UTF-8', bom: true, desc: 'Unicode with byte-order mark' },
  { label: 'UTF-16 LE', encoding: 'UTF-16LE', bom: true, desc: 'Unicode, 16-bit little endian' },
  { label: 'UTF-16 BE', encoding: 'UTF-16BE', bom: true, desc: 'Unicode, 16-bit big endian' },
  { label: 'Windows-1255', encoding: 'windows-1255', desc: 'Hebrew (Windows)' },
  { label: 'ISO-8859-8-I', encoding: 'ISO-8859-8-I', desc: 'Hebrew, logical (ISO)' },
  { label: 'ISO-8859-8', encoding: 'ISO-8859-8', desc: 'Hebrew, visual (ISO, legacy)' },
  { label: 'Windows-1252', encoding: 'windows-1252', desc: 'Western European' },
  { label: 'Windows-1256', encoding: 'windows-1256', desc: 'Arabic' },
  { label: 'Windows-1251', encoding: 'windows-1251', desc: 'Cyrillic' },
  { label: 'KOI8-R', encoding: 'KOI8-R', desc: 'Russian' },
  { label: 'Windows-1250', encoding: 'windows-1250', desc: 'Central European' },
  { label: 'Windows-1253', encoding: 'windows-1253', desc: 'Greek' },
  { label: 'Windows-1254', encoding: 'windows-1254', desc: 'Turkish' },
  { label: 'Shift_JIS', encoding: 'Shift_JIS', desc: 'Japanese' },
  { label: 'GBK', encoding: 'GBK', desc: 'Chinese, simplified' },
  { label: 'Big5', encoding: 'Big5', desc: 'Chinese, traditional' },
  { label: 'EUC-KR', encoding: 'EUC-KR', desc: 'Korean' },
];

function filterItems(items: QuickPickItem[], q: string, extra: (i: QuickPickItem) => string[] = () => []) {
  if (!q.trim()) return items;
  return items
    .map((i) => ({ i, s: bestScore(q, [i.label, i.detail ?? '', ...extra(i)]) }))
    .filter((x) => x.s > -Infinity)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);
}

/** `reopen`: decode the file differently. `convert`: write it differently on next save. */
export function pickEncoding(mode: 'reopen' | 'convert') {
  const tab = ws.active;
  if (!tab) return;
  if (mode === 'reopen' && tab.kind !== 'file') mode = 'convert';
  const items: QuickPickItem[] = ENCODINGS.filter((e) => mode === 'convert' || !e.bom).map((e, i) => ({
    id: String(i),
    label: e.label,
    detail: e.desc,
    hint: e.encoding.toLowerCase() === tab.encoding.toLowerCase() && (mode === 'reopen' || !!e.bom === tab.bom) ? '✓' : '',
  }));
  ui.openQuickPick({
    placeholder: t(mode === 'reopen' ? 'pick.encoding.reopen' : 'pick.encoding.convert'),
    items: (q) => filterItems(items, q),
    onAccept: (item) => {
      if (!item) return;
      const e = ENCODINGS.filter((x) => mode === 'convert' || !x.bom)[Number(item.id)];
      if (mode === 'reopen') void ws.reopenWithEncoding(e.encoding);
      else void ws.convert({ encoding: e.encoding, bom: !!e.bom });
    },
  });
}

export function pickEol() {
  const tab = ws.active;
  if (!tab) return;
  const items: { id: Eol; label: string; detail: string }[] = [
    { id: 'crlf', label: 'CRLF', detail: 'Windows' },
    { id: 'lf', label: 'LF', detail: 'Unix / macOS' },
    { id: 'cr', label: 'CR', detail: 'Classic Mac' },
  ];
  ui.openQuickPick({
    placeholder: t('pick.eol'),
    items: () => items.map((i) => ({ ...i, hint: i.id === tab.eol ? '✓' : '' })),
    onAccept: (item) => item && void ws.convert({ eol: item.id as Eol }),
  });
}

export function pickLanguage() {
  const tab = ws.active;
  if (!tab) return;
  const items: QuickPickItem[] = LANGUAGES.map((l) => ({
    id: l.id,
    label: l.label,
    detail: l.extensions.slice(0, 6).map((e) => `.${e}`).join(' '),
    hint: l.id === tab.lang ? '✓' : '',
  }));
  ui.openQuickPick({
    placeholder: t('pick.language'),
    items: (q) => filterItems(items, q, (i) => [i.id]),
    onAccept: (item) => item && ws.setLanguage(item.id),
  });
}

export function pickRecent() {
  const items: QuickPickItem[] = ws.recent.map((r) => ({
    id: r.path,
    label: r.path.split(/[\\/]/).pop() ?? r.path,
    detail: r.path,
  }));
  ui.openQuickPick({
    placeholder: t('pick.recent'),
    emptyText: t('pick.recent.empty'),
    items: (q) => filterItems(items, q),
    onAccept: (item) => item && void ws.openPaths([{ path: item.id }]),
  });
}

export function pickTab() {
  const items = (): QuickPickItem[] =>
    ws.tabs.map((tab) => ({ id: tab.docId, label: `${tab.dirty ? '● ' : ''}${tabTitle(tab)}`, detail: tab.path ?? '' }));
  ui.openQuickPick({
    placeholder: t('pick.tabs'),
    items: (q) => filterItems(items(), q),
    onAccept: (item) => item && void ws.activate(item.id),
  });
}
