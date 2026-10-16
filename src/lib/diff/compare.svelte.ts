/**
 * Compare two documents: open tabs, a tab's saved version on disk, the clipboard, or another file.
 * Tab sides stay live: edits made in the compare view go straight back into the tab (undoable, dirty).
 */
import { api, errorMessage } from '$lib/ipc/api';
import { ws, tabTitle, type Tab } from '$lib/state/workspace.svelte';
import { ui, type QuickPickItem } from '$lib/ui.svelte';
import { t } from '$lib/i18n/index.svelte';
import { detectLanguage } from '$lib/editor/languages';
import type { DirectionMode } from '$lib/editor/rtl/directionPlugin';
import { filterItems } from '$lib/commands/pickers';
import { normalizeEol } from './summary';

export type SideKind = 'tab' | 'disk' | 'clipboard' | 'file';
export type SideKey = 'left' | 'right';

export interface Side {
  kind: SideKind;
  label: string;
  /** Path or other secondary text. */
  detail: string;
  /** For tab sides: the tab whose text this is. */
  docId?: string;
  /** The text when the view was built. Tab sides re-read the live tab on every rebuild. */
  text: string;
  lang: string;
  direction: DirectionMode;
  readonly: boolean;
}

/** What the open compare view lets commands drive. */
export interface CompareController {
  next(): void;
  prev(): void;
  /** Copy the change at the cursor to the other side. */
  copy(to: SideKey): void;
  focus(): void;
}

const PREFS_KEY = 'daf.compare';

function loadPrefs(): { mode: 'split' | 'unified'; collapse: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { mode: p.mode === 'unified' ? 'unified' : 'split', collapse: p.collapse !== false };
  } catch {
    return { mode: 'split', collapse: true };
  }
}

class Compare {
  left = $state<Side | null>(null);
  right = $state<Side | null>(null);
  mode = $state<'split' | 'unified'>(loadPrefs().mode);
  collapse = $state(loadPrefs().collapse);
  /** Bumped whenever the view must be rebuilt from the sides. */
  revision = $state(0);
  /** The tab that was active when the comparison opened; switching away closes it. */
  homeId: string | null = null;
  controller: CompareController | null = null;

  get open(): boolean {
    return !!this.left && !!this.right;
  }

  private savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: this.mode, collapse: this.collapse }));
    } catch {
      /* private mode or blocked storage: not worth reporting */
    }
  }

  setMode(mode: 'split' | 'unified') {
    if (this.mode === mode) return;
    this.mode = mode;
    this.savePrefs();
    void this.rebuild();
  }

  toggleCollapse() {
    this.collapse = !this.collapse;
    this.savePrefs();
    void this.rebuild();
  }

  swap() {
    if (!this.open) return;
    [this.left, this.right] = [this.right, this.left];
    void this.rebuild();
  }

  /** Re-read tab sides (they may have been edited) and rebuild the view. */
  async rebuild() {
    for (const key of ['left', 'right'] as const) {
      const side = this[key];
      if (side?.kind === 'tab' && side.docId) {
        try {
          side.text = await ws.textOf(side.docId);
        } catch {
          return this.close();
        }
      }
    }
    this.revision++;
  }

  private show(left: Side, right: Side) {
    this.homeId = ws.activeId;
    this.left = left;
    this.right = right;
    ui.closeQuickPick();
    this.revision++;
  }

  close() {
    if (!this.open) return;
    this.left = null;
    this.right = null;
    this.controller = null;
    requestAnimationFrame(() => {
      ws.view?.requestMeasure();
      ws.view?.focus();
    });
  }

  // ───────────────────────────── sources ─────────────────────────────

  private async tabSide(tab: Tab): Promise<Side> {
    return {
      kind: 'tab',
      label: tabTitle(tab),
      detail: tab.path ?? '',
      docId: tab.docId,
      text: await ws.textOf(tab.docId),
      lang: tab.lang,
      direction: ws.directionMode(tab),
      readonly: tab.readonly,
    };
  }

  /** A read-only side shown next to `tab`: it borrows the tab's language and direction. */
  private fixedSide(kind: SideKind, label: string, detail: string, text: string, tab: Tab, lang = tab.lang): Side {
    return { kind, label, detail, text: normalizeEol(text), lang, direction: ws.directionMode(tab), readonly: true };
  }

  private activeComparable(): Tab | null {
    const tab = ws.active;
    if (!ws.canCompare(tab)) {
      ui.toast(t('compare.notComparable'), 'error');
      return null;
    }
    return tab;
  }

  private async run(build: () => Promise<[Side, Side] | null>) {
    try {
      const sides = await build();
      if (sides) this.show(...sides);
    } catch (e) {
      ui.toast(t('compare.failed', { message: errorMessage(e) }), 'error');
    }
  }

  /** Two tabs: `leftId` is the original, `rightId` the modified one (default: the active tab). */
  compareTabs(leftId: string, rightId: string | null = ws.activeId) {
    const a = ws.tabs.find((x) => x.docId === leftId);
    const b = ws.tabs.find((x) => x.docId === rightId);
    if (!ws.canCompare(a) || !ws.canCompare(b) || a === b) {
      ui.toast(t('compare.notComparable'), 'error');
      return Promise.resolve();
    }
    return this.run(async () => [await this.tabSide(a), await this.tabSide(b)]);
  }

  withSaved(id: string | null = ws.activeId) {
    const tab = ws.tabs.find((x) => x.docId === id);
    if (!ws.canCompare(tab) || tab.kind !== 'file') {
      ui.toast(t('compare.notComparable'), 'error');
      return Promise.resolve();
    }
    return this.run(async () => {
      const text = await api.filePeekDisk(tab.docId);
      const left = this.fixedSide('disk', t('compare.side.saved', { name: tabTitle(tab) }), tab.path ?? '', text, tab);
      return [left, await this.tabSide(tab)];
    });
  }

  withClipboard() {
    const tab = this.activeComparable();
    if (!tab) return Promise.resolve();
    return this.run(async () => {
      const text = await navigator.clipboard.readText();
      return [this.fixedSide('clipboard', t('compare.side.clipboard'), '', text, tab), await this.tabSide(tab)];
    });
  }

  withFile() {
    const tab = this.activeComparable();
    if (!tab) return Promise.resolve();
    return this.run(async () => {
      const picked = await api.filePickText();
      if (!picked) return null;
      const lang = detectLanguage(picked.name);
      const left = this.fixedSide('file', picked.name, picked.path, picked.text, tab, lang === 'plain' ? tab.lang : lang);
      return [left, await this.tabSide(tab)];
    });
  }

  // ───────────────────────────── pickers ─────────────────────────────

  /** "Compare with tab…": choose the other tab; the active tab is the modified side. */
  pickTab() {
    const active = this.activeComparable();
    if (!active) return;
    const items = this.tabItems([active.docId]);
    if (!items.length) {
      ui.toast(t('compare.noOtherTabs'));
      return;
    }
    ui.openQuickPick({
      placeholder: t('compare.pick.tab', { name: tabTitle(active) }),
      items: (q) => filterItems(items, q),
      onAccept: (item) => item && void this.compareTabs(item.id, active.docId),
    });
  }

  /** Change one side's source from the compare view's header. */
  pickSource(key: SideKey) {
    const other = key === 'left' ? this.right : this.left;
    const ref = ws.tabs.find((x) => x.docId === (other?.docId ?? this.homeId));
    if (!ref) return;
    const specials: QuickPickItem[] = [
      ...(ref.kind === 'file' ? [{ id: ':saved', label: t('compare.side.saved', { name: tabTitle(ref) }), detail: ref.path ?? '' }] : []),
      { id: ':clipboard', label: t('compare.side.clipboard') },
      { id: ':file', label: t('compare.source.file') },
    ];
    const items = [...this.tabItems(other?.docId ? [other.docId] : []), ...specials];
    ui.openQuickPick({
      placeholder: t(key === 'left' ? 'compare.pick.left' : 'compare.pick.right'),
      items: (q) => filterItems(items, q),
      onAccept: (item) => item && void this.replaceSide(key, item.id, ref),
    });
  }

  private async replaceSide(key: SideKey, id: string, ref: Tab) {
    const home = this.homeId;
    let side: Side | null = null;
    try {
      if (id === ':saved') {
        side = this.fixedSide('disk', t('compare.side.saved', { name: tabTitle(ref) }), ref.path ?? '', await api.filePeekDisk(ref.docId), ref);
      } else if (id === ':clipboard') {
        side = this.fixedSide('clipboard', t('compare.side.clipboard'), '', await navigator.clipboard.readText(), ref);
      } else if (id === ':file') {
        const picked = await api.filePickText();
        if (!picked) return;
        const lang = detectLanguage(picked.name);
        side = this.fixedSide('file', picked.name, picked.path, picked.text, ref, lang === 'plain' ? ref.lang : lang);
      } else {
        const tab = ws.tabs.find((x) => x.docId === id);
        if (!ws.canCompare(tab)) return;
        side = await this.tabSide(tab);
      }
    } catch (e) {
      ui.toast(t('compare.failed', { message: errorMessage(e) }), 'error');
      return;
    }
    if (!this.open || this.homeId !== home) return;
    this[key] = side;
    await this.rebuild();
  }

  private tabItems(exclude: string[]): QuickPickItem[] {
    return ws.tabs
      .filter((x) => !exclude.includes(x.docId) && ws.canCompare(x))
      .map((x) => ({ id: x.docId, label: `${x.dirty ? '● ' : ''}${tabTitle(x)}`, detail: x.path ?? '' }));
  }
}

export const compare = new Compare();
