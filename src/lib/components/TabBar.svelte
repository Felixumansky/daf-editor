<script lang="ts">
  import { ws, tabTitle } from '$lib/state/workspace.svelte';
  import { t } from '$lib/i18n/index.svelte';

  let dragFrom = $state<number | null>(null);
  let dropAt = $state<number | null>(null);

  function onMouseDown(e: MouseEvent, id: string) {
    if (e.button === 1) {
      e.preventDefault();
      void ws.close(id);
    }
  }

  function onKey(e: KeyboardEvent, index: number) {
    const dir = document.documentElement.dir === 'rtl' ? -1 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = (e.key === 'ArrowRight' ? 1 : -1) * dir;
      const next = ws.tabs[(index + delta + ws.tabs.length) % ws.tabs.length];
      void ws.activate(next.docId);
      requestAnimationFrame(() => document.getElementById(`tab-${next.docId}`)?.focus());
    } else if (e.key === 'Delete') {
      void ws.close(ws.tabs[index].docId);
    }
  }
</script>

<div
  class="tabbar"
  role="tablist"
  tabindex="-1"
  ondblclick={(e) => {
    if (e.target === e.currentTarget) void ws.newUntitled();
  }}
>
  {#each ws.tabs as tab, i (tab.docId)}
    <div
      id="tab-{tab.docId}"
      class="tab"
      class:active={tab.docId === ws.activeId}
      class:drop={dropAt === i && dragFrom !== i}
      role="tab"
      tabindex={tab.docId === ws.activeId ? 0 : -1}
      aria-selected={tab.docId === ws.activeId}
      title={tab.path ?? tabTitle(tab)}
      draggable="true"
      onclick={() => ws.activate(tab.docId)}
      onmousedown={(e) => onMouseDown(e, tab.docId)}
      onkeydown={(e) => onKey(e, i)}
      ondragstart={(e) => {
        dragFrom = i;
        e.dataTransfer?.setData('text/plain', tab.docId);
      }}
      ondragover={(e) => {
        e.preventDefault();
        dropAt = i;
      }}
      ondrop={(e) => {
        e.preventDefault();
        if (dragFrom !== null) ws.moveTab(dragFrom, i);
        dragFrom = dropAt = null;
      }}
      ondragend={() => (dragFrom = dropAt = null)}
    >
      <span class="name" dir="auto">{tabTitle(tab)}</span>
      {#if tab.readonly}<span class="lock" title={t('status.readonly')}>🔒</span>{/if}
      <button
        class="close"
        class:dirty={tab.dirty}
        tabindex="-1"
        aria-label={tab.dirty ? t('tab.dirty') : t('tab.close')}
        title={tab.dirty ? t('tab.dirty') : t('tab.close')}
        onclick={(e) => {
          e.stopPropagation();
          void ws.close(tab.docId);
        }}
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="x" aria-hidden="true">×</span>
      </button>
    </div>
  {/each}
  <button class="new" title={t('untitled', { n: '' }).trim()} aria-label="+" onclick={() => ws.newUntitled()}>+</button>
</div>

<style>
  .tabbar {
    display: flex;
    align-items: stretch;
    gap: 1px;
    height: 34px;
    padding-inline-start: 4px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    flex-shrink: 0;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 220px;
    min-width: 72px;
    padding-inline: 12px 6px;
    margin-top: 4px;
    border-radius: 7px 7px 0 0;
    color: var(--fg-muted);
    cursor: default;
    user-select: none;
    white-space: nowrap;
  }
  .tab:hover {
    background: var(--surface-3);
  }
  .tab.active {
    background: var(--ed-bg);
    color: var(--fg);
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .tab.drop {
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .lock {
    font-size: 10px;
  }
  .close {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
  }
  .close > span {
    grid-area: 1 / 1;
  }
  .close .x {
    opacity: 0;
    font-size: 16px;
    line-height: 1;
  }
  .close .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--dirty);
    opacity: 0;
  }
  .close.dirty .dot {
    opacity: 1;
  }
  .tab:hover .close .x,
  .tab.active .close:not(.dirty) .x {
    opacity: 0.7;
  }
  .tab:hover .close.dirty .dot {
    opacity: 0;
  }
  .close:hover {
    background: var(--surface-3);
  }
  .close:hover .x {
    opacity: 1;
  }
  .new {
    align-self: center;
    width: 26px;
    height: 26px;
    margin-inline-start: 4px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-muted);
    font-size: 18px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .new:hover {
    background: var(--surface-3);
    color: var(--fg);
  }
</style>
