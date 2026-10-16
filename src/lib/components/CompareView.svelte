<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { EditorState, type Extension, type Text } from '@codemirror/state';
  import {
    MergeView, acceptChunk, getChunks, getOriginalDoc, goToNextChunk, goToPreviousChunk, rejectChunk,
    unifiedMergeView, updateOriginalDoc, type Chunk,
  } from '@codemirror/merge';

  import { comps, editorExtensions, type DocConfig } from '$lib/editor/setup';
  import { getLanguage } from '$lib/editor/languages';
  import { cmPhrasesHe } from '$lib/i18n/cmPhrases';
  import { i18n, t } from '$lib/i18n/index.svelte';
  import type { MessageKey } from '$lib/i18n/en';
  import { registry } from '$lib/commands/registry';
  import { ws } from '$lib/state/workspace.svelte';
  import { compare, type Side, type SideKey } from '$lib/diff/compare.svelte';
  import { compareTheme } from '$lib/diff/compareTheme';
  import { chunkIndexAt, chunkStats, summarize, type DiffSummary } from '$lib/diff/summary';

  const DIFF_CONFIG = { scanLimit: 5000, timeout: 1500 };
  const COLLAPSE = { margin: 3, minSize: 6 };
  const LARGE = 2_000_000;

  let host: HTMLDivElement;
  let toolbar: HTMLDivElement;
  let merge: MergeView | null = null;
  let single: EditorView | null = null;
  let summary = $state<DiffSummary | null>(null);
  let current = $state(-1);
  let announcement = $state('');
  let summaryTimer: ReturnType<typeof setTimeout> | undefined;

  const left = $derived(compare.left);
  const right = $derived(compare.right);
  const canEdit = (s: Side | null) => !!s && !s.readonly;

  // ───────────────────────────── building ─────────────────────────────

  function config(side: Side): DocConfig {
    const s = ws.settings;
    return {
      lineNumbers: s['editor.lineNumbers'],
      wrap: s['editor.wordWrap'],
      tabSize: s['editor.tabSize'],
      insertSpaces: s['editor.insertSpaces'],
      showWhitespace: s['editor.showWhitespace'],
      direction: side.direction,
      isolates: s['editor.rtl.codeComments'] === 'isolate' && side.direction === 'code',
      readonly: side.readonly,
      phrases: i18n.lang === 'he' ? cmPhrasesHe : {},
      bidi: s['editor.bidiControls'],
      cleanPaste: s['editor.cleanPaste'],
      large: side.text.length > LARGE,
    };
  }

  /** Mirror edits into the tab a side came from, and keep the summary current. */
  function listener(side: Side): Extension {
    return EditorView.updateListener.of((u) => {
      if (u.docChanged && side.docId) ws.applyChanges(side.docId, u.changes);
      if (u.docChanged) scheduleSummary();
      // Unified mode: "copy to left" changes the original document.
      if (compare.left?.docId && compare.left.kind === 'tab' && !compare.left.readonly) {
        for (const tr of u.transactions)
          for (const e of tr.effects) if (e.is(updateOriginalDoc)) ws.applyChanges(compare.left.docId, e.value.changes);
      }
    });
  }

  function sideExtensions(side: Side, key: SideKey): Extension[] {
    const label = t(key === 'left' ? 'compare.aria.left' : 'compare.aria.right', { name: side.label });
    return [
      editorExtensions(config(side), listener(side)),
      compareTheme,
      EditorView.contentAttributes.of({ 'aria-label': label }),
    ];
  }

  async function loadLanguage(view: EditorView, lang: string) {
    try {
      const support = await getLanguage(lang).load();
      if (view.dom.isConnected) view.dispatch({ effects: comps.language.reconfigure(support) });
    } catch (e) {
      console.error('language load failed', e);
    }
  }

  function arrowButton(to: SideKey, onActivate?: (e: MouseEvent) => void): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    const text = t(to === 'right' ? 'compare.copyToRight' : 'compare.copyToLeft');
    b.setAttribute('aria-label', text);
    b.title = text;
    b.textContent = to === 'right' ? '→' : '←';
    b.className = 'cmp-copy';
    // MergeView reverts on mousedown; give keyboard users (Enter/Space → click with detail 0) the same.
    b.addEventListener('click', (e) => {
      if (onActivate) onActivate(e);
      else if (e.detail === 0) b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    return b;
  }

  function destroyViews() {
    merge?.destroy();
    single?.destroy();
    merge = null;
    single = null;
  }

  function build() {
    destroyViews();
    const L = compare.left;
    const R = compare.right;
    if (!L || !R || !host) return;
    const collapseUnchanged = compare.collapse ? COLLAPSE : undefined;
    if (compare.mode === 'split') {
      // Copy direction: into whichever side can be edited (the right one when both can).
      const revertControls = canEdit(R) ? 'a-to-b' : canEdit(L) ? 'b-to-a' : undefined;
      merge = new MergeView({
        a: { doc: L.text, extensions: sideExtensions(L, 'left') },
        b: { doc: R.text, extensions: sideExtensions(R, 'right') },
        parent: host,
        revertControls,
        renderRevertControl: revertControls ? () => arrowButton(revertControls === 'a-to-b' ? 'right' : 'left') : undefined,
        highlightChanges: true,
        gutter: true,
        collapseUnchanged,
        diffConfig: DIFF_CONFIG,
      });
      void loadLanguage(merge.a, L.lang);
      void loadLanguage(merge.b, R.lang);
    } else {
      const leftEditable = canEdit(L);
      single = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: R.text,
          extensions: [
            sideExtensions(R, 'right'),
            unifiedMergeView({
              original: L.text,
              gutter: true,
              highlightChanges: true,
              syntaxHighlightDeletions: true,
              collapseUnchanged,
              diffConfig: DIFF_CONFIG,
              mergeControls: (type, action) => {
                if (type === 'accept') {
                  const b = arrowButton('left', action);
                  if (!leftEditable) b.hidden = true;
                  return b;
                }
                const b = arrowButton('right', action);
                if (!canEdit(R)) b.hidden = true;
                return b;
              },
            }),
          ],
        }),
      });
      void loadLanguage(single, R.lang);
    }
    current = -1;
    refreshSummary();
    if (summary) announce(summaryText(summary));
    requestAnimationFrame(() => focusEditor());
  }

  // ───────────────────────────── summary & navigation ─────────────────────────────

  function docs(): { chunks: readonly Chunk[]; a: Text; b: Text } | null {
    if (merge) return { chunks: merge.chunks, a: merge.a.state.doc, b: merge.b.state.doc };
    if (single) {
      const c = getChunks(single.state);
      return { chunks: c?.chunks ?? [], a: getOriginalDoc(single.state), b: single.state.doc };
    }
    return null;
  }

  function refreshSummary() {
    const d = docs();
    summary = d ? summarize(d.chunks, d.a, d.b) : null;
    if (summary && current >= summary.changes) current = summary.changes - 1;
  }

  function scheduleSummary() {
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(refreshSummary, 60);
  }

  function summaryText(s: DiffSummary): string {
    if (s.identical) return t('compare.identical');
    return t('compare.summary', { n: s.changes, added: s.added, removed: s.removed });
  }

  function announce(text: string) {
    // Re-setting the same text would not be announced again.
    announcement = '';
    requestAnimationFrame(() => (announcement = text));
  }

  /** The editor to act on: the focused one, else the right (editable) one. */
  function activeView(): { view: EditorView; side: 'a' | 'b' } | null {
    if (merge) return merge.a.hasFocus ? { view: merge.a, side: 'a' } : { view: merge.b, side: 'b' };
    return single ? { view: single, side: 'b' } : null;
  }

  function focusEditor() {
    activeView()?.view.focus();
  }

  function go(dir: 1 | -1) {
    const target = activeView();
    const d = docs();
    if (!target || !d) return;
    if (!d.chunks.length) {
      announce(t('compare.identical'));
      return;
    }
    (dir > 0 ? goToNextChunk : goToPreviousChunk)(target.view);
    target.view.focus();
    const i = chunkIndexAt(d.chunks, target.view.state.selection.main.head, target.side);
    current = i;
    const s = chunkStats(d.chunks[i], d.a, d.b);
    announce(t('compare.chunk', { i: i + 1, n: d.chunks.length, removed: s.removed, added: s.added }));
  }

  /** Copy the change at the cursor (or the next one) to the given side. */
  function copy(to: SideKey) {
    const target = activeView();
    const d = docs();
    if (!target || !d) return;
    const dest = to === 'right' ? compare.right : compare.left;
    if (!canEdit(dest)) {
      announce(t('compare.readonlySide'));
      return;
    }
    const i = chunkIndexAt(d.chunks, target.view.state.selection.main.head, target.side);
    if (i < 0) {
      announce(t('compare.identical'));
      return;
    }
    const chunk = d.chunks[i];
    if (single) {
      const pos = chunk.fromB;
      if (to === 'left') acceptChunk(single, pos);
      else rejectChunk(single, pos);
    } else if (merge) {
      const [src, dst, sFrom, sTo, dFrom, dTo] = to === 'right'
        ? [merge.a, merge.b, chunk.fromA, chunk.toA, chunk.fromB, chunk.toB]
        : [merge.b, merge.a, chunk.fromB, chunk.toB, chunk.fromA, chunk.toA];
      let insert = src.state.sliceDoc(sFrom, Math.max(sFrom, sTo - 1));
      if (sFrom !== sTo && dTo <= dst.state.doc.length) insert += src.state.lineBreak;
      dst.dispatch({ changes: { from: dFrom, to: Math.min(dst.state.doc.length, dTo), insert }, userEvent: 'revert' });
    }
    announce(t(to === 'right' ? 'compare.copiedRight' : 'compare.copiedLeft'));
  }

  compare.controller = { next: () => go(1), prev: () => go(-1), copy, focus: focusEditor };

  // ───────────────────────────── lifecycle ─────────────────────────────

  $effect(() => {
    void compare.revision;
    void i18n.lang;
    untrack(build);
  });

  // Switching to another tab, or closing a compared tab, ends the comparison.
  $effect(() => {
    const active = ws.activeId;
    const ids = new Set(ws.tabs.map((x) => x.docId));
    untrack(() => {
      const gone = [compare.left, compare.right].some((s) => s?.docId && !ids.has(s.docId));
      if (gone || active !== compare.homeId) compare.close();
    });
  });

  onDestroy(() => {
    clearTimeout(summaryTimer);
    destroyViews();
    compare.controller = null;
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      compare.close();
    }
  }

  /** Arrow keys move between toolbar buttons (mirrored in RTL). */
  function onToolbarKey(e: KeyboardEvent) {
    const keys = i18n.dir === 'rtl' ? { ArrowLeft: 1, ArrowRight: -1 } : { ArrowLeft: -1, ArrowRight: 1 };
    const step = keys[e.key as keyof typeof keys] ?? (e.key === 'Home' ? -Infinity : e.key === 'End' ? Infinity : 0);
    if (!step) return;
    const items = [...toolbar.querySelectorAll<HTMLElement>('button:not(:disabled)')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = step === -Infinity ? 0 : step === Infinity ? items.length - 1 : (at + step + items.length) % items.length;
    items[next]?.focus();
    e.preventDefault();
  }

  const key = (id: string) => registry.keyLabel(id);
  const tip = (label: string, id: string) => (key(id) ? `${label} (${key(id)})` : label);
  const kindLabel = (s: Side): string => t(`compare.kind.${s.kind}` as MessageKey);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="compare" aria-label={t('compare.title')} onkeydown={onKeyDown}>
  <div class="toolbar" role="toolbar" aria-label={t('compare.toolbar')} tabindex="-1" bind:this={toolbar} onkeydown={onToolbarKey}>
    <div class="group">
      <button type="button" class="btn" onclick={() => go(-1)} disabled={!summary || summary.identical} title={tip(t('compare.prev'), 'compare.prev')} aria-label={t('compare.prev')}>
        <span aria-hidden="true">↑</span>
      </button>
      <button type="button" class="btn" onclick={() => go(1)} disabled={!summary || summary.identical} title={tip(t('compare.next'), 'compare.next')} aria-label={t('compare.next')}>
        <span aria-hidden="true">↓</span>
      </button>
      {#if summary}
        <span class="summary">
          {#if summary.identical}
            {t('compare.identical')}
          {:else}
            {#if current >= 0}<span class="pos">{t('compare.position', { i: current + 1, n: summary.changes })}</span>{:else}<span>{t('compare.changes', { n: summary.changes })}</span>{/if}
            <span class="stat add" title={t('compare.addedLines', { n: summary.added })}><bdi>+{summary.added}</bdi></span>
            <span class="stat del" title={t('compare.removedLines', { n: summary.removed })}><bdi>−{summary.removed}</bdi></span>
          {/if}
        </span>
      {/if}
    </div>

    <div class="group">
      {#if canEdit(right) || canEdit(left)}
        <button type="button" class="btn" onclick={() => copy('left')} disabled={!canEdit(left) || !summary || summary.identical} title={tip(t('compare.copyToLeft'), 'compare.copyToLeft')}>
          <span aria-hidden="true" dir="ltr">←</span> {t('compare.copyLeftShort')}
        </button>
        <button type="button" class="btn" onclick={() => copy('right')} disabled={!canEdit(right) || !summary || summary.identical} title={tip(t('compare.copyToRight'), 'compare.copyToRight')}>
          {t('compare.copyRightShort')} <span aria-hidden="true" dir="ltr">→</span>
        </button>
      {/if}
      <button type="button" class="btn" onclick={() => compare.swap()} title={tip(t('compare.swap'), 'compare.swap')}>
        <span aria-hidden="true">⇄</span> {t('compare.swapShort')}
      </button>
      <div class="segmented" role="group" aria-label={t('compare.layout')}>
        <button type="button" aria-pressed={compare.mode === 'split'} onclick={() => compare.setMode('split')}>{t('compare.split')}</button>
        <button type="button" aria-pressed={compare.mode === 'unified'} onclick={() => compare.setMode('unified')}>{t('compare.unified')}</button>
      </div>
      <button type="button" class="btn" aria-pressed={compare.collapse} onclick={() => compare.toggleCollapse()}>{t('compare.collapse')}</button>
      <button type="button" class="btn close" onclick={() => compare.close()} title={`${t('compare.close')} (Esc)`} aria-label={t('compare.close')}>
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  </div>

  {#if left && right}
    <div class="heads" class:unified={compare.mode === 'unified'} dir="ltr">
      {#each [['left', left], ['right', right]] as const as [k, s] (k)}
        <button type="button" class="head {k}" onclick={() => compare.pickSource(k)} title={t('compare.changeSource')}
          aria-label={`${t(k === 'left' ? 'compare.aria.left' : 'compare.aria.right', { name: s.label })}. ${t('compare.changeSource')}`}>
          <span class="sign" aria-hidden="true">{k === 'left' ? '−' : '+'}</span>
          <span class="kind">{kindLabel(s)}</span>
          <bdi class="name">{s.label}</bdi>
          {#if s.detail}<bdi class="detail">{s.detail}</bdi>{/if}
          {#if s.readonly}<span class="badge">{t('compare.readonly')}</span>{/if}
          {#if s.docId && ws.tabs.find((x) => x.docId === s.docId)?.dirty}<span class="dirty" title={t('tab.dirty')}>●</span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if summary && (summary.identical || !summary.precise)}
    <div class="notice" role="status">
      {summary.identical ? t('compare.identicalLong') : t('compare.imprecise')}
    </div>
  {/if}

  <div class="editors" dir="ltr" bind:this={host}></div>
  <div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
</section>

<style>
  :global(:root) {
    --diff-ins-bg: #e6f6ea;
    --diff-ins-strong: #a8e6b8;
    --diff-ins-mark: #1a7f37;
    --diff-del-bg: #fdebec;
    --diff-del-strong: #f8c0c4;
    --diff-del-mark: #c4314b;
  }
  :global(:root[data-theme='dark']) {
    --diff-ins-bg: rgb(46 160 67 / 0.16);
    --diff-ins-strong: rgb(46 160 67 / 0.42);
    --diff-ins-mark: #56d364;
    --diff-del-bg: rgb(248 81 73 / 0.16);
    --diff-del-strong: rgb(248 81 73 / 0.42);
    --diff-del-mark: #ff7b8a;
  }

  .compare {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--ed-bg);
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 12px;
    padding: 6px 10px;
    background: var(--surface-1);
    border-bottom: 1px solid var(--border);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .btn,
  .segmented button {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-1);
    cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover:not(:disabled),
  .segmented button:hover {
    background: var(--surface-2);
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .btn.close {
    padding: 0 9px;
  }
  .segmented {
    display: inline-flex;
  }
  .segmented button {
    border-radius: 0;
  }
  .segmented button:first-child {
    border-start-start-radius: 6px;
    border-end-start-radius: 6px;
  }
  .segmented button:last-child {
    border-start-end-radius: 6px;
    border-end-end-radius: 6px;
    margin-inline-start: -1px;
  }
  button[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: var(--accent);
    font-weight: 600;
  }

  .summary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding-inline-start: 4px;
    color: var(--fg-muted);
  }
  .pos {
    color: var(--fg);
    font-weight: 600;
  }
  .stat {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .stat.add {
    color: var(--diff-ins-mark);
  }
  .stat.del {
    color: var(--diff-del-mark);
  }

  .heads {
    display: grid;
    grid-template-columns: 1fr 1.6em 1fr;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .heads .head.right {
    grid-column: 3;
  }
  .heads.unified {
    grid-template-columns: 1fr 1fr;
  }
  .heads.unified .head.right {
    grid-column: 2;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 5px 10px;
    border: 0;
    background: none;
    text-align: start;
    cursor: pointer;
  }
  .head:hover {
    background: var(--surface-3);
  }
  .sign {
    font-weight: 700;
    font-family: var(--ed-font);
  }
  .head.left .sign {
    color: var(--diff-del-mark);
  }
  .head.right .sign {
    color: var(--diff-ins-mark);
  }
  .kind {
    font-size: 11px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .name {
    font-weight: 600;
    white-space: nowrap;
  }
  .detail {
    color: var(--fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .badge {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--fg-muted);
    white-space: nowrap;
  }
  .dirty {
    color: var(--dirty);
  }

  .notice {
    padding: 6px 12px;
    background: var(--warn-bg);
    border-bottom: 1px solid var(--warn-border);
  }

  .editors {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .editors :global(.cm-mergeView) {
    height: 100%;
    overflow: auto;
  }
  .editors > :global(.cm-editor) {
    height: 100%;
  }
  .editors :global(.cm-mergeViewEditor + .cm-merge-revert),
  .editors :global(.cm-merge-revert) {
    background: var(--surface-2);
    border-inline: 1px solid var(--border);
  }
  .editors :global(.cmp-copy) {
    color: var(--fg-muted);
    font-size: 14px;
    line-height: 1.2;
    border-radius: 4px;
  }
  .editors :global(.cm-merge-revert .cmp-copy:hover),
  .editors :global(.cm-merge-revert .cmp-copy:focus-visible) {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
