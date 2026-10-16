/**
 * The workspace: open tabs, the single EditorView, and everything that keeps work from being lost.
 *
 * - One EditorView; each tab owns an EditorState (created lazily on first activation). Switching
 *   tabs swaps states, so undo history is per tab.
 * - Unsaved text is mirrored to Rust-side buffer files (debounced, ≤ 2 s behind typing), and the tab
 *   list to session.json, so closing or killing Daf never loses work.
 */
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { EditorSelection, EditorState, Text, type Extension, type StateEffect } from '@codemirror/state';
import { getCurrentWindow } from '@tauri-apps/api/window';

import {
  api, errorMessage,
  type DocKind, type DocMeta, type Eol, type Fingerprint, type OpenRequest, type OpenResult,
  type RecentItem, type SaveResult, type SessionMeta, type Settings, type TabMeta,
} from '$lib/ipc/api';
import { comps, createEditorState, ext, type DocConfig } from '$lib/editor/setup';
import { detectLanguage, getLanguage } from '$lib/editor/languages';
import { directionExtension, type DirectionMode } from '$lib/editor/rtl/directionPlugin';
import { bidiControls } from '$lib/editor/rtl/bidiControls';
import { cmPhrasesHe } from '$lib/i18n/cmPhrases';
import { i18n, t } from '$lib/i18n/index.svelte';
import { ui } from '$lib/ui.svelte';

export interface Tab {
  docId: string;
  kind: 'file' | 'untitled';
  path: string | null;
  name: string;
  /** "new N" number for untitled tabs; negative for "Recovered N". */
  untitledNo: number;
  dirty: boolean;
  /** Encoding/EOL was changed and must be written even if the text is unchanged. */
  formatDirty: boolean;
  encoding: string;
  bom: boolean;
  eol: Eol;
  eolMixed: boolean;
  confidence: DocMeta['confidence'];
  docKind: DocKind;
  readonly: boolean;
  lossy: boolean;
  disk: Fingerprint | null;
  lang: string;
  dirOverride: 'rtl' | 'ltr' | null;
  pinned: boolean;
  /** Banners. */
  diskChanged: boolean;
  missing: boolean;
  guessNoticed: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  'ui.language': 'en',
  'ui.theme': 'auto',
  'editor.fontFamily': "Cascadia Mono, Consolas, 'DejaVu Sans Mono', 'Noto Sans Hebrew', monospace",
  'editor.fontSize': 14,
  'editor.zoom': 0,
  'editor.wordWrap': false,
  'editor.tabSize': 4,
  'editor.insertSpaces': true,
  'editor.lineNumbers': true,
  'editor.showWhitespace': false,
  'editor.rtl.autoDirection': true,
  'editor.rtl.codeComments': 'isolate',
  'editor.bidiControls': 'highlight',
  'files.defaultEncoding': 'utf-8',
  'files.encodingHint': 'il',
  'files.defaultEol': 'auto',
  'files.largeThresholdMB': 16,
  'files.hugeThresholdMB': 64,
  'files.reloadCleanOnExternalChange': true,
  'session.restore': true,
  'keymap.preset': 'notepad++',
  'ai.enabled': false,
  'startup.launchAtLogin': false,
  'startup.prompted': false,
};

const BIG_DOC = 2_000_000;
const MAX_CLOSED = 20;

function sameText(a: Text | null | undefined, b: Text | null | undefined): boolean {
  return !!a && !!b && a.length === b.length && a.eq(b);
}

function samePath(a: string | null, b: string | null, caseInsensitive: boolean): boolean {
  if (!a || !b) return false;
  return caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function tabTitle(tab: Tab): string {
  if (tab.kind === 'file') return tab.name || baseName(tab.path ?? '');
  return tab.untitledNo < 0 ? t('recovered', { n: -tab.untitledNo }) : t('untitled', { n: tab.untitledNo });
}

class Workspace {
  tabs = $state<Tab[]>([]);
  activeId = $state<string | null>(null);
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  cursor = $state({ line: 1, col: 1, selected: 0, cursors: 1 });
  recent = $state<RecentItem[]>([]);
  version = $state('');
  platform = $state('windows');
  ready = $state(false);
  /** Effective theme after resolving "auto". */
  theme = $state<'light' | 'dark'>('light');

  view: EditorView | null = null;
  commandMru: string[] = [];
  private locale = 'en-US';
  private states = new Map<string, EditorState>();
  /** The text as last loaded/saved; `null` = unknown (a restored dirty file). */
  private saved = new Map<string, Text | null>();
  /** Selection and scroll of tabs that are not active (or not loaded yet). */
  private viewMeta = new Map<string, { sel: TabMeta['sel']; scrollLine: number }>();
  private bufferTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; firstAt: number }>();
  private metaTimer: ReturnType<typeof setTimeout> | undefined;
  private untitledCounter = 0;
  private recoveredCounter = 0;
  private closedTabs: TabMeta[] = [];
  private activateToken = 0;
  private listener: Extension = EditorView.updateListener.of((u) => this.onViewUpdate(u));

  get active(): Tab | undefined {
    return this.tabs.find((t) => t.docId === this.activeId);
  }

  private tab(id: string | null | undefined): Tab | undefined {
    return id ? this.tabs.find((t) => t.docId === id) : undefined;
  }

  private get caseInsensitivePaths() {
    return this.platform === 'windows' || this.platform === 'macos';
  }

  // ───────────────────────────── startup ─────────────────────────────

  attachView(view: EditorView) {
    this.view = view;
  }

  private initStarted = false;

  async init() {
    // Hot reload during development can remount the app on the same workspace; start only once.
    if (this.initStarted) return;
    this.initStarted = true;
    const s = await api.appReady();
    this.version = s.version;
    this.platform = s.platform;
    this.locale = s.locale;
    this.recent = s.recent;
    this.applySettings(s.settings);

    const meta = s.session.meta;
    if (meta) {
      this.untitledCounter = meta.untitledCounter;
      this.closedTabs = meta.closedTabs ?? [];
      this.commandMru = meta.commandMru ?? [];
      // Never restore the same document or file twice (protects against a damaged session file).
      const seenIds = new Set<string>();
      const seenPaths = new Set<string>();
      const unique = meta.tabs.filter((tm) => {
        const pathKey = tm.path && (this.caseInsensitivePaths ? tm.path.toLowerCase() : tm.path);
        if (seenIds.has(tm.docId) || (pathKey && seenPaths.has(pathKey))) return false;
        seenIds.add(tm.docId);
        if (pathKey) seenPaths.add(pathKey);
        return true;
      });
      const results = await Promise.all(
        unique.map((tm) => api.docRestore(tm).then((r) => ({ tm, r }), () => null)),
      );
      for (const item of results) {
        if (!item) continue;
        const { tm, r } = item;
        if (r.missing && !tm.dirty) {
          ui.toast(t('toast.missing', { name: tm.title || baseName(tm.path ?? '') }));
          void api.fileClose(tm.docId);
          continue;
        }
        const tab = this.makeTab(r.meta, {
          untitledNo: tm.kind === 'untitled' ? this.untitledNoFromTitle(tm.title) : 0,
          lang: tm.lang ?? undefined,
        });
        tab.dirty = tm.dirty;
        tab.dirOverride = tm.dirOverride;
        tab.pinned = tm.pinned;
        tab.diskChanged = r.diskChanged;
        tab.missing = r.missing;
        if (tm.kind === 'untitled') tab.kind = 'untitled';
        this.viewMeta.set(tm.docId, { sel: tm.sel, scrollLine: tm.scrollLine });
        this.tabs.push(tab);
      }
      if (this.tabs.length) ui.toast(t('toast.restored', { n: this.tabs.length }));
    }

    if (s.session.orphans.length) {
      for (const docId of s.session.orphans) {
        const r = await api.docRestore(this.blankTabMeta(docId)).catch(() => null);
        if (!r) continue;
        const tab = this.makeTab(r.meta, { untitledNo: -++this.recoveredCounter });
        tab.kind = 'untitled';
        tab.dirty = true;
        this.tabs.push(tab);
      }
      ui.toast(t('toast.recovered', { n: s.session.orphans.length }));
    }

    let target = this.tab(meta?.activeDocId)?.docId ?? this.tabs[0]?.docId;
    if (s.pendingOpen.length) {
      const opened = await this.openPaths(s.pendingOpen, false);
      if (opened) target = opened;
    }
    if (!this.tabs.length) {
      target = (await this.newUntitled(false)).docId;
    }
    if (target) await this.activate(target);

    // Buffers of tabs that are clean (or gone) are no longer needed.
    void api.sessionPrune(this.tabs.filter((t) => t.dirty || t.kind === 'untitled').map((t) => t.docId));
    this.ready = true;
    this.scheduleMeta();
    if (!this.settings['startup.prompted']) setTimeout(() => void this.askLaunchAtLogin(), 800);
  }

  /** Asked once, on first run: start with the OS and come back to the same tabs. */
  private async askLaunchAtLogin() {
    const choice = await ui.confirm({
      title: t('dlg.startup.title'),
      body: t('dlg.startup.body'),
      buttons: [
        { id: 'yes', label: t('dlg.startup.yes'), primary: true },
        { id: 'no', label: t('dlg.startup.no') },
      ],
    });
    await this.updateSettings({ 'startup.launchAtLogin': choice === 'yes', 'startup.prompted': true });
  }

  /** Session titles are "new N" or "recovered N" (stored in English, shown translated). */
  private untitledNoFromTitle(title: string): number {
    const n = Number(/(\d+)\s*$/.exec(title)?.[1]);
    if (!Number.isFinite(n) || n <= 0) return ++this.untitledCounter;
    if (title.startsWith('recovered')) {
      this.recoveredCounter = Math.max(this.recoveredCounter, n);
      return -n;
    }
    return n;
  }

  private blankTabMeta(docId: string): TabMeta {
    return {
      docId, kind: 'untitled', path: null, title: '', dirty: true, encoding: 'UTF-8', bom: false,
      eol: this.platform === 'windows' ? 'crlf' : 'lf', lang: null, disk: null, sel: [], scrollLine: 0,
      wrap: null, dirOverride: null, pinned: false,
    };
  }

  private makeTab(meta: DocMeta, opts: { untitledNo?: number; lang?: string } = {}): Tab {
    return {
      docId: meta.docId,
      kind: meta.path ? 'file' : 'untitled',
      path: meta.path,
      name: meta.name,
      untitledNo: opts.untitledNo ?? 0,
      dirty: false,
      formatDirty: false,
      encoding: meta.encoding,
      bom: meta.bom,
      eol: meta.eol,
      eolMixed: meta.eolMixed,
      confidence: meta.confidence,
      docKind: meta.kind,
      readonly: meta.readonly,
      lossy: meta.lossy,
      disk: meta.disk,
      lang: opts.lang ?? detectLanguage(meta.path ?? meta.name),
      dirOverride: null,
      pinned: false,
      diskChanged: false,
      missing: false,
      guessNoticed: false,
    };
  }

  private applyMeta(tab: Tab, meta: DocMeta) {
    tab.path = meta.path;
    tab.name = meta.name;
    tab.encoding = meta.encoding;
    tab.bom = meta.bom;
    tab.eol = meta.eol;
    tab.eolMixed = meta.eolMixed;
    tab.confidence = meta.confidence;
    tab.docKind = meta.kind;
    tab.readonly = meta.readonly;
    tab.lossy = meta.lossy;
    tab.disk = meta.disk;
    if (meta.path) tab.kind = 'file';
  }

  // ───────────────────────────── settings ─────────────────────────────

  applySettings(s: Settings) {
    const prev = this.settings;
    this.settings = s;
    i18n.set(i18n.resolve(s['ui.language'], this.locale));
    const dark = s['ui.theme'] === 'dark' || (s['ui.theme'] === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    this.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = this.theme;
    const root = document.documentElement.style;
    root.setProperty('--ed-font', s['editor.fontFamily']);
    root.setProperty('--ed-font-size', `${(s['editor.fontSize'] * (1 + s['editor.zoom'] * 0.1)).toFixed(1)}px`);

    if (this.states.size || this.view) {
      this.reconfigureAll((tab) => {
        const effects: StateEffect<unknown>[] = [comps.phrases.reconfigure(ext.phrases(this.phrases()))];
        if (prev['editor.lineNumbers'] !== s['editor.lineNumbers']) effects.push(comps.gutters.reconfigure(ext.gutters(s['editor.lineNumbers'])));
        if (prev['editor.wordWrap'] !== s['editor.wordWrap']) effects.push(comps.wrap.reconfigure(ext.wrap(s['editor.wordWrap'] && tab.docKind !== 'large')));
        if (prev['editor.tabSize'] !== s['editor.tabSize'] || prev['editor.insertSpaces'] !== s['editor.insertSpaces'])
          effects.push(comps.indent.reconfigure(ext.indent(s['editor.tabSize'], s['editor.insertSpaces'])));
        if (prev['editor.showWhitespace'] !== s['editor.showWhitespace']) effects.push(comps.whitespace.reconfigure(ext.whitespace(s['editor.showWhitespace'])));
        if (prev['editor.bidiControls'] !== s['editor.bidiControls']) effects.push(comps.bidi.reconfigure(bidiControls(s['editor.bidiControls'])));
        effects.push(comps.direction.reconfigure(directionExtension(this.directionMode(tab))));
        effects.push(comps.isolates.reconfigure(ext.isolates(this.isolatesOn(tab))));
        return effects;
      });
    }
  }

  async updateSettings(patch: Partial<Settings>) {
    try {
      this.applySettings(await api.settingsUpdate(patch));
    } catch (e) {
      ui.toast(errorMessage(e), 'error');
    }
  }

  private phrases(): Record<string, string> {
    return i18n.lang === 'he' ? cmPhrasesHe : {};
  }

  directionMode(tab: Tab): DirectionMode {
    if (tab.dirOverride) return tab.dirOverride;
    if (!getLanguage(tab.lang).prose) return 'code';
    return this.settings['editor.rtl.autoDirection'] ? 'auto' : 'ltr';
  }

  private isolatesOn(tab: Tab): boolean {
    return this.settings['editor.rtl.codeComments'] === 'isolate' && this.directionMode(tab) === 'code';
  }

  private docConfig(tab: Tab): DocConfig {
    const s = this.settings;
    return {
      lineNumbers: s['editor.lineNumbers'],
      wrap: s['editor.wordWrap'],
      tabSize: s['editor.tabSize'],
      insertSpaces: s['editor.insertSpaces'],
      showWhitespace: s['editor.showWhitespace'],
      direction: this.directionMode(tab),
      isolates: this.isolatesOn(tab),
      readonly: tab.readonly && tab.docKind === 'binary',
      phrases: this.phrases(),
      bidi: s['editor.bidiControls'],
      large: tab.docKind === 'large',
    };
  }

  /** Apply effects to every loaded document: dispatch on the active view, update stored states. */
  private reconfigureAll(effectsFor: (tab: Tab) => StateEffect<unknown>[]) {
    for (const tab of this.tabs) this.reconfigure(tab, effectsFor(tab));
  }

  private reconfigure(tab: Tab, effects: StateEffect<unknown>[]) {
    if (!effects.length) return;
    if (tab.docId === this.activeId && this.view && this.states.has(tab.docId)) {
      this.view.dispatch({ effects });
    } else {
      const st = this.states.get(tab.docId);
      if (st) this.states.set(tab.docId, st.update({ effects }).state);
    }
  }

  // ───────────────────────────── documents ─────────────────────────────

  /** The live document text, if loaded. */
  docOf(id: string): Text | null {
    if (id === this.activeId && this.view && this.states.has(id)) return this.view.state.doc;
    return this.states.get(id)?.doc ?? null;
  }

  private stateOf(id: string): EditorState | null {
    if (id === this.activeId && this.view && this.states.has(id)) return this.view.state;
    return this.states.get(id) ?? null;
  }

  private async loadText(tab: Tab): Promise<{ text: string; saved: Text | null }> {
    if (tab.kind === 'untitled') {
      const text = tab.dirty ? await api.sessionGetBuffer(tab.docId) : '';
      return { text, saved: Text.empty };
    }
    if (tab.dirty) {
      const text = await api.sessionGetBuffer(tab.docId);
      return { text, saved: null };
    }
    const text = await api.fileReadText(tab.docId);
    return { text, saved: Text.of(text.split('\n')) };
  }

  /** Make sure a tab's EditorState exists (loads its text on first use). */
  private async ensureState(tab: Tab): Promise<EditorState> {
    const existing = this.stateOf(tab.docId);
    if (existing) return existing;
    const { text, saved } = await this.loadText(tab);
    // Another caller may have loaded it while we awaited.
    const again = this.stateOf(tab.docId);
    if (again) return again;
    const st = createEditorState(text, this.docConfig(tab), this.listener, this.viewMeta.get(tab.docId)?.sel);
    this.states.set(tab.docId, st);
    this.saved.set(tab.docId, saved);
    void this.loadLanguage(tab);
    return st;
  }

  private async loadLanguage(tab: Tab) {
    try {
      const support = await getLanguage(tab.lang).load();
      if (!this.tab(tab.docId)) return;
      this.reconfigure(tab, [comps.language.reconfigure(support)]);
    } catch (e) {
      console.error('language load failed', e);
    }
  }

  async activate(id: string, pos?: { line?: number | null; col?: number | null }) {
    const tab = this.tab(id);
    if (!tab || !this.view) return;
    const token = ++this.activateToken;
    if (this.activeId && this.activeId !== id && this.states.has(this.activeId)) {
      this.states.set(this.activeId, this.view.state);
      this.rememberView(this.activeId);
    }
    let st: EditorState;
    try {
      st = await this.ensureState(tab);
    } catch (e) {
      ui.toast(t('toast.openFailed', { name: tabTitle(tab), message: errorMessage(e) }), 'error');
      return;
    }
    if (token !== this.activateToken) return;
    this.activeId = id;
    this.view.setState(st);
    const vm = this.viewMeta.get(id);
    if (pos?.line) this.goTo(pos.line, pos.col ?? 1);
    else if (vm?.scrollLine) {
      const line = this.view.state.doc.line(Math.min(Math.max(1, vm.scrollLine), this.view.state.doc.lines));
      this.view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start' }) });
    }
    this.updateCursor(this.view.state);
    this.view.focus();
    this.scheduleMeta();
  }

  private rememberView(id: string) {
    const st = this.states.get(id);
    if (!st || !this.view) return;
    this.viewMeta.set(id, {
      sel: st.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head })),
      scrollLine: this.topLine(),
    });
  }

  /** The first visible line of the active view. */
  private topLine(): number {
    if (!this.view) return 1;
    const doc = this.view.state.doc;
    const block = this.view.lineBlockAtHeight(this.view.scrollDOM.scrollTop);
    return doc.lineAt(Math.min(block.from, doc.length)).number;
  }

  private onViewUpdate(u: ViewUpdate) {
    const id = this.activeId;
    const tab = this.tab(id);
    if (!tab || !id) return;
    if (u.docChanged) {
      const dirty = tab.formatDirty || !sameText(u.state.doc, this.saved.get(id));
      if (tab.dirty !== dirty) {
        tab.dirty = dirty;
        this.scheduleMeta();
      }
      this.scheduleBuffer(id);
    }
    if (u.docChanged || u.selectionSet) {
      this.updateCursor(u.state);
      this.scheduleMeta(1500);
    }
  }

  private updateCursor(st: EditorState) {
    const main = st.selection.main;
    const line = st.doc.lineAt(main.head);
    const selected = st.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0);
    this.cursor = { line: line.number, col: main.head - line.from + 1, selected, cursors: st.selection.ranges.length };
  }

  goTo(line: number, col = 1) {
    const view = this.view;
    if (!view) return;
    const doc = view.state.doc;
    const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
    const pos = Math.min(l.from + Math.max(0, col - 1), l.to);
    view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    view.focus();
  }

  // ───────────────────────────── persistence ─────────────────────────────

  private scheduleBuffer(id: string) {
    const now = Date.now();
    const prev = this.bufferTimers.get(id);
    if (prev) clearTimeout(prev.timer);
    const big = (this.docOf(id)?.length ?? 0) > BIG_DOC;
    const debounce = big ? 30_000 : 500;
    const maxWait = big ? 30_000 : 2_000;
    const firstAt = prev?.firstAt ?? now;
    const wait = Math.max(0, Math.min(debounce, firstAt + maxWait - now));
    this.bufferTimers.set(id, { timer: setTimeout(() => void this.flushBuffer(id), wait), firstAt });
  }

  /** Write (or drop) one tab's unsaved-text buffer now. */
  async flushBuffer(id: string) {
    const pending = this.bufferTimers.get(id);
    if (pending) clearTimeout(pending.timer);
    this.bufferTimers.delete(id);
    const tab = this.tab(id);
    const doc = this.docOf(id);
    if (!tab || !doc) return;
    try {
      if (tab.dirty) await api.sessionPutBuffer(id, doc.toString());
      else await api.sessionDropBuffer(id);
    } catch (e) {
      console.error('buffer write failed', e);
    }
  }

  async flushAllBuffers() {
    await Promise.all([...this.bufferTimers.keys()].map((id) => this.flushBuffer(id)));
  }

  scheduleMeta(delay = 400) {
    clearTimeout(this.metaTimer);
    this.metaTimer = setTimeout(() => void this.saveMeta(), delay);
  }

  private tabMeta(tab: Tab): TabMeta {
    const st = this.stateOf(tab.docId);
    const vm = this.viewMeta.get(tab.docId);
    const scrollLine = tab.docId === this.activeId && this.view && st ? this.topLine() : (vm?.scrollLine ?? 0);
    const untitledTitle = tab.untitledNo < 0 ? `recovered ${-tab.untitledNo}` : `new ${tab.untitledNo}`;
    return {
      docId: tab.docId,
      kind: tab.kind,
      path: tab.path,
      title: tab.kind === 'untitled' ? untitledTitle : tabTitle(tab),
      dirty: tab.dirty,
      encoding: tab.encoding,
      bom: tab.bom,
      eol: tab.eol,
      lang: tab.lang,
      disk: tab.disk,
      sel: st ? st.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head })) : (vm?.sel ?? []),
      scrollLine,
      wrap: null,
      dirOverride: tab.dirOverride,
      pinned: tab.pinned,
    };
  }

  async saveMeta() {
    clearTimeout(this.metaTimer);
    if (!this.ready) return;
    const meta: SessionMeta = {
      version: 1,
      untitledCounter: this.untitledCounter,
      window: null,
      activeDocId: this.activeId,
      commandMru: this.commandMru.slice(0, 50),
      tabs: this.tabs.map((t) => this.tabMeta(t)),
      closedTabs: this.closedTabs.slice(0, MAX_CLOSED),
    };
    try {
      await api.sessionPutMeta(meta);
    } catch (e) {
      console.error('session write failed', e);
    }
  }

  /** The window is closing: persist everything, then let Rust exit. */
  async flushForQuit() {
    await this.flushAllBuffers();
    // Loaded dirty tabs without a pending timer still get a final write.
    await Promise.all(this.tabs.filter((t) => t.dirty && this.docOf(t.docId)).map((t) => this.flushBuffer(t.docId)));
    await this.saveMeta();
  }

  // ───────────────────────────── open / new / close ─────────────────────────────

  async newUntitled(activate = true): Promise<Tab> {
    const meta = await api.fileNew();
    const tab = this.makeTab(meta, { untitledNo: ++this.untitledCounter, lang: 'plain' });
    this.tabs.push(tab);
    if (activate) await this.activate(tab.docId);
    return tab;
  }

  private findByPath(path: string | null): Tab | undefined {
    return this.tabs.find((t) => samePath(t.path, path, this.caseInsensitivePaths));
  }

  /** A single clean, empty "new 1" tab is replaced by the first opened file (like Notepad++). */
  private replaceableTab(): Tab | undefined {
    if (this.tabs.length !== 1) return undefined;
    const only = this.tabs[0];
    const doc = this.docOf(only.docId);
    return only.kind === 'untitled' && !only.dirty && (!doc || doc.length === 0) ? only : undefined;
  }

  /** Open files by path (already granted on the Rust side). Returns the doc id to show. */
  async openPaths(reqs: OpenRequest[], activate = true): Promise<string | undefined> {
    const fresh: OpenRequest[] = [];
    let last: { id: string; line?: number | null; col?: number | null } | undefined;
    for (const r of reqs) {
      const existing = this.findByPath(r.path);
      if (existing) last = { id: existing.docId, line: r.line, col: r.col };
      else fresh.push(r);
    }
    if (fresh.length) {
      const results = await api.fileOpenPaths(fresh);
      last = (await this.adoptOpenResults(results)) ?? last;
    }
    if (last && activate) await this.activate(last.id, last);
    return last?.id;
  }

  async openDialog() {
    const results = await api.fileOpenDialog();
    const last = await this.adoptOpenResults(results);
    if (last) await this.activate(last.id, last);
  }

  private async adoptOpenResults(results: OpenResult[]): Promise<{ id: string; line: number | null; col: number | null } | undefined> {
    let last: { id: string; line: number | null; col: number | null } | undefined;
    const replaceable = this.replaceableTab();
    let added = false;
    for (const r of results) {
      if (r.meta) {
        const dup = this.findByPath(r.meta.path);
        if (dup) {
          void api.fileClose(r.meta.docId);
          last = { id: dup.docId, line: r.line, col: r.col };
          continue;
        }
        this.tabs.push(this.makeTab(r.meta));
        added = true;
        last = { id: r.meta.docId, line: r.line, col: r.col };
        this.touchRecent(r.meta.path);
      } else if (r.error) {
        const name = baseName(r.path);
        if (r.error.code === 'Binary') {
          const choice = await ui.confirm({
            title: t('dlg.binary.title', { name }),
            body: t('dlg.binary.body'),
            buttons: [{ id: 'open', label: t('dlg.openAnyway') }, { id: 'cancel', label: t('dlg.cancel'), primary: true }],
          });
          if (choice === 'open') {
            const meta = await api.fileOpenBinary(r.path).catch((e) => (ui.toast(errorMessage(e), 'error'), null));
            if (meta) {
              this.tabs.push(this.makeTab(meta));
              added = true;
              last = { id: meta.docId, line: null, col: null };
            }
          }
        } else if (r.error.code === 'TooLarge') {
          ui.toast(t('toast.tooLarge', { name }), 'error', 6000);
        } else {
          ui.toast(t('toast.openFailed', { name, message: r.error.message }), 'error', 6000);
        }
      }
    }
    if (added && replaceable && last && last.id !== replaceable.docId) {
      await this.discardTab(replaceable.docId);
    }
    return last;
  }

  private touchRecent(path: string | null) {
    if (!path) return;
    this.recent = [{ path, lastOpenedMs: Date.now() }, ...this.recent.filter((r) => !samePath(r.path, path, this.caseInsensitivePaths))].slice(0, 30);
  }

  /** Close a tab, asking to save if it has unsaved changes. Returns false if the user cancelled. */
  async close(id: string | null = this.activeId): Promise<boolean> {
    const tab = this.tab(id);
    if (!tab) return true;
    if (tab.dirty) {
      if (tab.docId !== this.activeId) await this.activate(tab.docId);
      const choice = await ui.confirm({
        title: t('dlg.close.title', { name: tabTitle(tab) }),
        body: t('dlg.close.body'),
        buttons: [
          { id: 'save', label: t('dlg.save'), primary: true },
          { id: 'discard', label: t('dlg.dontSave'), danger: true },
          { id: 'cancel', label: t('dlg.cancel') },
        ],
      });
      if (choice === 'cancel') return false;
      if (choice === 'save' && !(await this.save(tab.docId))) return false;
    }
    if (tab.kind === 'file' && tab.path) {
      this.closedTabs = [{ ...this.tabMeta(tab), dirty: false }, ...this.closedTabs.filter((c) => !samePath(c.path, tab.path, this.caseInsensitivePaths))].slice(0, MAX_CLOSED);
    }
    await this.discardTab(tab.docId);
    return true;
  }

  /** Remove a tab without asking. */
  private async discardTab(id: string) {
    const index = this.tabs.findIndex((t) => t.docId === id);
    if (index < 0) return;
    const timer = this.bufferTimers.get(id);
    if (timer) clearTimeout(timer.timer);
    this.bufferTimers.delete(id);
    this.tabs.splice(index, 1);
    this.states.delete(id);
    this.saved.delete(id);
    this.viewMeta.delete(id);
    void api.fileClose(id);
    void api.sessionDropBuffer(id);
    if (this.activeId === id) {
      this.activeId = null;
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      if (next) await this.activate(next.docId);
      else await this.newUntitled();
    }
    this.scheduleMeta();
  }

  async closeAll(exceptId?: string) {
    for (const tab of [...this.tabs]) {
      if (tab.docId === exceptId) continue;
      if (!(await this.close(tab.docId))) return;
    }
  }

  async reopenClosed() {
    const last = this.closedTabs.shift();
    if (!last?.path) {
      ui.toast(t('toast.noClosed'));
      return;
    }
    await this.openPaths([{ path: last.path, line: last.scrollLine || null }]);
  }

  cycleTab(delta: number) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex((t) => t.docId === this.activeId);
    const next = this.tabs[(i + delta + this.tabs.length) % this.tabs.length];
    void this.activate(next.docId);
  }

  moveTab(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= this.tabs.length || to >= this.tabs.length) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this.scheduleMeta();
  }

  // ───────────────────────────── save ─────────────────────────────

  async save(id: string | null = this.activeId, force = false): Promise<boolean> {
    const tab = this.tab(id);
    if (!tab) return false;
    if (tab.kind === 'untitled' || !tab.path) return this.saveAs(tab.docId);
    const st = await this.ensureState(tab);
    const doc = st.doc;
    let res: SaveResult;
    try {
      res = await api.fileSave(tab.docId, doc.toString(), force);
    } catch (e) {
      ui.toast(t('toast.saveFailed', { name: tabTitle(tab), message: errorMessage(e) }), 'error', 6000);
      return false;
    }
    return this.handleSaveResult(tab, doc, res);
  }

  async saveAs(id: string | null = this.activeId): Promise<boolean> {
    const tab = this.tab(id);
    if (!tab) return false;
    const st = await this.ensureState(tab);
    const doc = st.doc;
    const suggested = tab.kind === 'untitled' ? `${tabTitle(tab)}.txt` : tabTitle(tab);
    let res: SaveResult;
    try {
      res = await api.fileSaveAs(tab.docId, doc.toString(), suggested);
    } catch (e) {
      ui.toast(t('toast.saveFailed', { name: tabTitle(tab), message: errorMessage(e) }), 'error', 6000);
      return false;
    }
    const wasUntitled = tab.kind === 'untitled';
    const ok = await this.handleSaveResult(tab, doc, res);
    if (ok && (wasUntitled || tab.lang === 'plain')) {
      const lang = detectLanguage(tab.path);
      if (lang !== tab.lang) this.setLanguage(lang, tab.docId);
    }
    return ok;
  }

  async saveAll() {
    for (const tab of [...this.tabs]) if (tab.dirty) await this.save(tab.docId);
  }

  private async handleSaveResult(tab: Tab, doc: Text, res: SaveResult): Promise<boolean> {
    const name = tabTitle(tab);
    switch (res.status) {
      case 'saved': {
        this.applyMeta(tab, res.meta);
        this.saved.set(tab.docId, doc);
        tab.formatDirty = false;
        tab.diskChanged = false;
        tab.missing = false;
        tab.dirty = !sameText(this.docOf(tab.docId), doc);
        this.touchRecent(tab.path);
        await this.flushBuffer(tab.docId);
        this.scheduleMeta();
        return true;
      }
      case 'conflict': {
        const choice = await ui.confirm({
          title: t('dlg.conflict.title', { name }),
          body: t('dlg.conflict.body'),
          buttons: [{ id: 'overwrite', label: t('dlg.overwrite'), danger: true }, { id: 'cancel', label: t('dlg.cancel'), primary: true }],
        });
        return choice === 'overwrite' ? this.save(tab.docId, true) : false;
      }
      case 'readOnly':
        ui.toast(t('toast.readonly', { name }), 'error');
        return this.saveAs(tab.docId);
      case 'unmappable': {
        const choice = await ui.confirm({
          title: t('dlg.unmappable.title', { encoding: tab.encoding }),
          body: t('dlg.unmappable.body', { count: res.count, encoding: tab.encoding, line: res.firstLine, col: res.firstCol }),
          buttons: [{ id: 'utf8', label: t('dlg.convertUtf8'), primary: true }, { id: 'cancel', label: t('dlg.cancel') }],
        });
        if (choice !== 'utf8') {
          this.goTo(res.firstLine, res.firstCol);
          return false;
        }
        this.applyMeta(tab, await api.fileSetFormat(tab.docId, { encoding: 'UTF-8' }));
        return this.save(tab.docId);
      }
      case 'lossy': {
        const choice = await ui.confirm({
          title: t('dlg.lossy.title', { name }),
          body: t('dlg.lossy.body', { encoding: tab.encoding }),
          buttons: [{ id: 'save', label: t('dlg.saveAnyway'), danger: true }, { id: 'cancel', label: t('dlg.cancel'), primary: true }],
        });
        return choice === 'save' ? this.save(tab.docId, true) : false;
      }
      case 'cancelled':
        return false;
    }
  }

  // ───────────────────────────── disk changes ─────────────────────────────

  /** Called when the window regains focus. */
  async checkDisk() {
    const ids = this.tabs.filter((t) => t.kind === 'file').map((t) => t.docId);
    if (!ids.length) return;
    let statuses;
    try {
      statuses = await api.fileCheckDisk(ids);
    } catch {
      return;
    }
    for (const s of statuses) {
      const tab = this.tab(s.docId);
      if (!tab) continue;
      if (s.deleted) {
        tab.missing = true;
      } else if (s.changed) {
        if (!tab.dirty && this.settings['files.reloadCleanOnExternalChange']) {
          await this.reloadFromDisk(tab.docId);
          ui.toast(t('toast.reloaded', { name: tabTitle(tab) }));
        } else {
          tab.diskChanged = true;
        }
      }
    }
  }

  /** Replace a document's text (undoably) and mark it as matching `saved`. */
  private replaceText(tab: Tab, text: string) {
    const savedDoc = Text.of(text.split('\n'));
    this.saved.set(tab.docId, savedDoc);
    tab.formatDirty = false;
    const st = this.stateOf(tab.docId);
    if (!st) {
      tab.dirty = false;
      return;
    }
    const spec = { changes: { from: 0, to: st.doc.length, insert: savedDoc } };
    if (tab.docId === this.activeId && this.view) this.view.dispatch(spec);
    else this.states.set(tab.docId, st.update(spec).state);
    tab.dirty = false;
    void this.flushBuffer(tab.docId);
  }

  async reloadFromDisk(id: string | null = this.activeId) {
    const tab = this.tab(id);
    if (!tab || tab.kind !== 'file') return;
    try {
      this.applyMeta(tab, await api.fileReload(tab.docId));
      const text = await api.fileReadText(tab.docId);
      this.replaceText(tab, text);
      tab.diskChanged = false;
      tab.missing = false;
      this.scheduleMeta();
    } catch (e) {
      ui.toast(errorMessage(e), 'error');
    }
  }

  keepMine(id: string | null = this.activeId) {
    const tab = this.tab(id);
    if (tab) {
      tab.diskChanged = false;
      tab.missing = false;
    }
  }

  // ───────────────────────────── format ─────────────────────────────

  async reopenWithEncoding(encoding: string, id: string | null = this.activeId) {
    const tab = this.tab(id);
    if (!tab || tab.kind !== 'file') return;
    if (tab.dirty) {
      const choice = await ui.confirm({
        title: t('dlg.reopenDirty.title', { name: tabTitle(tab), encoding }),
        body: t('dlg.reopenDirty.body'),
        buttons: [{ id: 'discard', label: t('dlg.discard'), danger: true }, { id: 'cancel', label: t('dlg.cancel'), primary: true }],
      });
      if (choice !== 'discard') return;
    }
    try {
      this.applyMeta(tab, await api.fileReopen(tab.docId, encoding));
      await this.ensureState(tab);
      this.replaceText(tab, await api.fileReadText(tab.docId));
      tab.guessNoticed = true;
      this.scheduleMeta();
    } catch (e) {
      ui.toast(errorMessage(e), 'error');
    }
  }

  async convert(format: { encoding?: string; bom?: boolean; eol?: Eol }, id: string | null = this.activeId) {
    const tab = this.tab(id);
    if (!tab) return;
    try {
      this.applyMeta(tab, await api.fileSetFormat(tab.docId, format));
      tab.formatDirty = true;
      tab.dirty = true;
      tab.guessNoticed = true;
      this.scheduleBuffer(tab.docId);
      this.scheduleMeta();
    } catch (e) {
      ui.toast(errorMessage(e), 'error');
    }
  }

  setLanguage(lang: string, id: string | null = this.activeId) {
    const tab = this.tab(id);
    if (!tab) return;
    tab.lang = lang;
    this.reconfigure(tab, [
      comps.direction.reconfigure(directionExtension(this.directionMode(tab))),
      comps.isolates.reconfigure(ext.isolates(this.isolatesOn(tab))),
    ]);
    void this.loadLanguage(tab);
    this.scheduleMeta();
  }

  setDirection(dir: 'rtl' | 'ltr' | null, id: string | null = this.activeId) {
    const tab = this.tab(id);
    if (!tab) return;
    tab.dirOverride = dir;
    this.reconfigure(tab, [
      comps.direction.reconfigure(directionExtension(this.directionMode(tab))),
      comps.isolates.reconfigure(ext.isolates(this.isolatesOn(tab))),
    ]);
    this.scheduleMeta();
  }

  zoom(delta: number | null) {
    const z = delta === null ? 0 : Math.max(-5, Math.min(20, this.settings['editor.zoom'] + delta));
    void this.updateSettings({ 'editor.zoom': z });
  }

  async openSettings() {
    try {
      const meta = await api.settingsOpenFile();
      const dup = this.findByPath(meta.path);
      if (dup) {
        void api.fileClose(meta.docId);
        await this.activate(dup.docId);
        return;
      }
      this.tabs.push(this.makeTab(meta, { lang: 'json' }));
      await this.activate(meta.docId);
    } catch (e) {
      ui.toast(errorMessage(e), 'error');
    }
  }

  async revealActive() {
    if (this.active?.kind === 'file') await api.fileReveal(this.active.docId).catch((e) => ui.toast(errorMessage(e), 'error'));
  }

  updateWindowTitle() {
    const tab = this.active;
    const title = tab ? `${tab.dirty ? '● ' : ''}${tabTitle(tab)} — Daf` : 'Daf';
    void getCurrentWindow().setTitle(title).catch(() => {});
  }
}

export const ws = new Workspace();
