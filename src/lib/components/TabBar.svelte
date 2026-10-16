<script lang="ts">
  import { flushSync, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { ws, tabTitle, type Tab } from '$lib/state/workspace.svelte';
  import { t } from '$lib/i18n/index.svelte';
  import { compare } from '$lib/diff/compare.svelte';
  import Icon from './Icon.svelte';

  /** Pixels the pointer must travel before a press becomes a drag (so clicks stay clicks). */
  const DRAG_THRESHOLD = 4;

  /** File-type badge per language: a short tag and a hue. */
  const BADGES: Record<string, [string, number]> = {
    plain: ['TXT', -1], passwords: ['KEY', 0], markdown: ['MD', 210], javascript: ['JS', 48], typescript: ['TS', 215],
    json: ['{}', 40], html: ['<>', 14], css: ['#', 265], xml: ['<>', 160], yaml: ['YML', 330], python: ['PY', 200],
    rust: ['RS', 22], cpp: ['C++', 220], java: ['JV', 8], php: ['PHP', 245], sql: ['SQL', 190], csharp: ['C#', 285],
    shell: ['SH', 130], powershell: ['PS', 225], ini: ['INI', -1], toml: ['TML', 25], diff: ['±', 140], dockerfile: ['DK', 205],
    batch: ['BAT', -1],
  };
  const badge = (lang: string) => BADGES[lang] ?? [lang.slice(0, 3).toUpperCase(), -1];

  let bar: HTMLDivElement;
  let menuEl = $state<HTMLDivElement>();

  // Tabs are dragged with pointer events: Tauri's file-drop handler swallows HTML5 drag and drop.
  let drag = $state<{ id: string; startX: number; grab: number; offset: number; active: boolean } | null>(null);
  let menu = $state<{ id: string; x: number; y: number } | null>(null);

  const isRtl = () => getComputedStyle(bar).direction === 'rtl';
  const tabEl = (id: string) => document.getElementById(`tab-${id}`);

  function onMouseDown(e: MouseEvent, tab: Tab) {
    if (e.button === 1) {
      e.preventDefault();
      if (!tab.pinned) void ws.close(tab.docId);
    }
  }

  function onPointerDown(e: PointerEvent, tab: Tab) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    drag = { id: tab.docId, startX: e.clientX, grab: e.clientX - rect.left, offset: 0, active: false };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD) return;
      drag.active = true;
    }
    const from = ws.tabs.findIndex((tb) => tb.docId === drag!.id);
    const tab = ws.tabs[from];
    if (!tab) return endDrag();

    // Target slot: how many other tabs of the same group the pointer has passed the middle of.
    const pinned = ws.pinnedCount;
    const [lo, hi] = tab.pinned ? [0, pinned] : [pinned, ws.tabs.length];
    const rtl = isRtl();
    let to = lo;
    for (let i = lo; i < hi; i++) {
      if (i === from) continue;
      const r = tabEl(ws.tabs[i].docId)?.getBoundingClientRect();
      if (r && (rtl ? e.clientX < r.left + r.width / 2 : e.clientX > r.left + r.width / 2)) to++;
    }
    if (to !== from) {
      ws.moveTab(from, to);
      flushSync();
    }

    // Keep the dragged tab under the pointer, wherever its slot now is.
    const r = tabEl(drag.id)?.getBoundingClientRect();
    if (r) drag.offset += e.clientX - drag.grab - r.left;
  }

  function endDrag() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    drag = null;
  }

  function onKey(e: KeyboardEvent, index: number) {
    const dir = document.documentElement.dir === 'rtl' ? -1 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = (e.key === 'ArrowRight' ? 1 : -1) * dir;
      if (e.ctrlKey && e.shiftKey) {
        const id = ws.tabs[index].docId;
        ws.moveTab(index, index + delta);
        requestAnimationFrame(() => tabEl(id)?.focus());
        return;
      }
      const next = ws.tabs[(index + delta + ws.tabs.length) % ws.tabs.length];
      void ws.activate(next.docId);
      requestAnimationFrame(() => tabEl(next.docId)?.focus());
    } else if (e.key === 'Delete') {
      if (!ws.tabs[index].pinned) void ws.close(ws.tabs[index].docId);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      void openMenu(ws.tabs[index].docId, isRtl() ? r.right : r.left, r.bottom);
    }
  }

  async function openMenu(id: string, x: number, y: number) {
    menu = { id, x, y };
    await tick();
    if (!menuEl) return;
    // Keep the menu inside the window.
    const r = menuEl.getBoundingClientRect();
    const rtl = isRtl();
    const left = rtl ? x - r.width : x;
    menu.x = Math.max(4, Math.min(left, innerWidth - r.width - 4));
    menu.y = Math.min(y, innerHeight - r.height - 4);
    menuEl.querySelector<HTMLButtonElement>('button')?.focus();
  }

  function closeMenu() {
    menu = null;
  }

  function menuAction(fn: (id: string) => unknown) {
    const id = menu?.id;
    closeMenu();
    if (id) void fn(id);
  }

  function onMenuKey(e: KeyboardEvent) {
    const items = [...(menuEl?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      const id = menu?.id;
      closeMenu();
      if (id) tabEl(id)?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === 'Tab') {
      closeMenu();
    }
  }

  const menuTab = $derived(menu ? ws.tabs.find((tb) => tb.docId === menu!.id) : undefined);
</script>

<svelte:window
  onpointerdown={(e) => {
    if (menu && !menuEl?.contains(e.target as Node)) closeMenu();
  }}
  onblur={closeMenu}
  onresize={closeMenu}
/>

<div
  bind:this={bar}
  class="tabbar"
  class:dragging={drag?.active}
  role="tablist"
  tabindex="-1"
  ondblclick={(e) => {
    if (e.target === e.currentTarget) void ws.newUntitled();
  }}
>
  {#each ws.tabs as tab, i (tab.docId)}
    {@const dragged = drag?.active && drag.id === tab.docId}
    {@const [tag, hue] = badge(tab.lang)}
    <div
      id="tab-{tab.docId}"
      class="tab"
      class:active={tab.docId === ws.activeId}
      class:pinned={tab.pinned}
      class:last-pinned={tab.pinned && !ws.tabs[i + 1]?.pinned}
      class:dragged
      style:transform={dragged ? `translateX(${drag!.offset}px)` : null}
      role="tab"
      tabindex={tab.docId === ws.activeId ? 0 : -1}
      aria-selected={tab.docId === ws.activeId}
      title={tab.path ?? tabTitle(tab)}
      animate:flip={{ duration: dragged ? 0 : 150 }}
      onclick={() => ws.activate(tab.docId)}
      onmousedown={(e) => onMouseDown(e, tab)}
      onpointerdown={(e) => onPointerDown(e, tab)}
      onkeydown={(e) => onKey(e, i)}
      oncontextmenu={(e) => {
        e.preventDefault();
        void openMenu(tab.docId, e.clientX, e.clientY);
      }}
    >
      <span class="badge" class:neutral={hue < 0} style:--hue={hue} aria-hidden="true">{tag}</span>
      <span class="name" dir="auto">{tabTitle(tab)}</span>
      {#if tab.readonly}<span class="lock" title={t('status.readonly')}><Icon name="lock" size={12} /></span>{/if}
      {#if tab.pinned}
        <button
          class="close pin"
          class:dirty={tab.dirty}
          tabindex="-1"
          aria-label={t('tab.unpin')}
          title={tab.dirty ? `${t('tab.pinned')} · ${t('tab.dirty')}` : `${t('tab.pinned')} · ${t('tab.unpin')}`}
          onclick={(e) => {
            e.stopPropagation();
            ws.togglePin(tab.docId);
          }}
        >
          <span class="dot" aria-hidden="true"></span>
          <span class="x"><Icon name="pin" size={13} /></span>
        </button>
      {:else}
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
          <span class="x" aria-hidden="true"><Icon name="x" size={14} /></span>
        </button>
      {/if}
    </div>
  {/each}
  <button class="new" title={t('chrome.newTab')} aria-label={t('chrome.newTab')} onclick={() => ws.newUntitled()}>
    <Icon name="plus" size={16} />
  </button>
</div>

{#if menu && menuTab}
  <div
    bind:this={menuEl}
    class="ctx glass"
    role="menu"
    tabindex="-1"
    style:left="{menu.x}px"
    style:top="{menu.y}px"
    onkeydown={onMenuKey}
  >
    <button role="menuitem" onclick={() => menuAction((id) => ws.togglePin(id))}>
      {menuTab.pinned ? t('tab.unpin') : t('tab.pin')}
    </button>
    {#if ws.canCompare(menuTab) && ((menuTab.docId !== ws.activeId && ws.canCompare(ws.active)) || menuTab.kind === 'file')}
      <div class="sep" role="separator"></div>
      {#if menuTab.docId !== ws.activeId && ws.canCompare(ws.active)}
        <button role="menuitem" onclick={() => menuAction((id) => compare.compareTabs(id))}>{t('tab.compareActive')}</button>
      {/if}
      {#if menuTab.kind === 'file'}
        <button role="menuitem" onclick={() => menuAction((id) => compare.withSaved(id))}>{t('tab.compareSaved')}</button>
      {/if}
    {/if}
    <div class="sep" role="separator"></div>
    <button role="menuitem" onclick={() => menuAction((id) => ws.close(id))}>{t('tab.close')}</button>
    <button role="menuitem" onclick={() => menuAction((id) => ws.closeAll(id))}>{t('tab.closeOthers')}</button>
    <button role="menuitem" onclick={() => menuAction(() => ws.closeAll())}>{t('tab.closeAll')}</button>
  </div>
{/if}

<style>
  /* Tabs sit on the (Mica) chrome; the active one is cut from the same sheet as the editor below. */
  .tabbar {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 38px;
    padding-inline: 6px 8px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    flex-shrink: 0;
  }
  .tabbar.dragging {
    cursor: grabbing;
  }
  .tab {
    --tab-r: 10px;
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    max-width: 230px;
    min-width: 80px;
    margin-bottom: 3px;
    padding-inline: 10px 6px;
    border-radius: var(--r-m);
    color: var(--fg-muted);
    font-size: 12.5px;
    cursor: default;
    user-select: none;
    white-space: nowrap;
    animation: tab-in var(--dur-2) var(--ease-out);
    transition:
      background var(--dur-1),
      color var(--dur-1);
  }
  @keyframes tab-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  /* Hairline between inactive neighbours, hidden next to hover/active. */
  .tab:not(.active) + .tab:not(.active)::before {
    content: '';
    position: absolute;
    inset-inline-start: -2px;
    top: 9px;
    width: 1px;
    height: 14px;
    background: var(--border-strong);
  }
  .tab:hover {
    background: var(--hover);
    color: var(--fg);
  }
  .tab:hover + .tab:not(.active)::before,
  .tab:not(.active):hover::before {
    display: none;
  }
  .tab.active {
    z-index: 1;
    height: 35px;
    margin-bottom: 0;
    border-radius: var(--tab-r) var(--tab-r) 0 0;
    background: var(--ed-bg);
    color: var(--fg);
  }
  /* Inverted corners: the sheet curves out into the chrome on both sides of the active tab. */
  .tab.active::before,
  .tab.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    width: var(--tab-r);
    height: var(--tab-r);
    pointer-events: none;
  }
  .tab.active::before {
    left: calc(-1 * var(--tab-r));
    background: radial-gradient(circle at 0 0, transparent calc(var(--tab-r) - 0.5px), var(--ed-bg) var(--tab-r));
  }
  .tab.active::after {
    right: calc(-1 * var(--tab-r));
    background: radial-gradient(circle at 100% 0, transparent calc(var(--tab-r) - 0.5px), var(--ed-bg) var(--tab-r));
  }
  /* The first tab sits on the sheet's edge: no outward curve there. */
  .tab.active:first-child::before {
    display: none;
  }
  :global([dir='rtl']) .tab.active:first-child::before {
    display: block;
  }
  :global([dir='rtl']) .tab.active:first-child::after {
    display: none;
  }
  .tab.last-pinned {
    margin-inline-end: 8px;
  }
  .tab.dragged {
    z-index: 2;
    cursor: grabbing;
    background: var(--surface-1);
    box-shadow: var(--elev-2);
    border-radius: var(--r-m);
    animation: none;
  }
  .tab.dragged::before,
  .tab.dragged::after {
    display: none;
  }
  .badge {
    display: grid;
    place-items: center;
    min-width: 22px;
    height: 16px;
    padding: 0 4px;
    border-radius: var(--r-xs);
    background: hsl(var(--hue) 85% 55% / 0.14);
    color: hsl(var(--hue) 70% 40%);
    font: 700 8.5px/1 var(--ui-font);
    letter-spacing: 0.02em;
    flex-shrink: 0;
  }
  :global([data-theme='dark']) .badge {
    color: hsl(var(--hue) 85% 72%);
    background: hsl(var(--hue) 85% 60% / 0.16);
  }
  .badge.neutral {
    background: var(--hover);
    color: var(--fg-subtle);
  }
  .tab:not(.active):not(:hover) .badge {
    filter: saturate(0.6);
    opacity: 0.85;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .tab.active .name {
    font-weight: 600;
  }
  .lock {
    display: grid;
    color: var(--fg-subtle);
  }
  .close {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: var(--r-s);
    background: transparent;
    color: inherit;
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--dur-1);
  }
  .close > * {
    grid-area: 1 / 1;
    transition:
      opacity var(--dur-1),
      transform var(--dur-2) var(--ease-spring);
  }
  .close .x {
    display: grid;
    opacity: 0;
    transform: scale(0.7);
  }
  .close .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--dirty);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--dirty) 22%, transparent);
    opacity: 0;
    transform: scale(0.4);
  }
  .close.dirty .dot {
    opacity: 1;
    transform: scale(1);
  }
  .tab:hover .close .x,
  .tab.active .close:not(.dirty) .x,
  .close.pin:not(.dirty) .x {
    opacity: 0.75;
    transform: scale(1);
  }
  .tab:hover .close.dirty .dot {
    opacity: 0;
    transform: scale(0.4);
  }
  .close:hover {
    background: var(--pressed);
  }
  .close:hover .x {
    opacity: 1;
  }
  .new {
    display: grid;
    place-items: center;
    align-self: center;
    width: 28px;
    height: 28px;
    margin-inline-start: 4px;
    margin-top: 2px;
    border: none;
    border-radius: var(--r-s);
    background: transparent;
    color: var(--fg-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background var(--dur-1),
      transform var(--dur-2) var(--ease-spring);
  }
  .new:hover {
    background: var(--hover);
    color: var(--fg);
  }
  .new:active {
    transform: scale(0.9);
  }
  .ctx {
    position: fixed;
    z-index: 50;
    min-width: 200px;
    padding: 5px;
    border-radius: var(--r-l);
    user-select: none;
    animation: daf-pop var(--dur-1) var(--ease-out);
  }
  .ctx button {
    display: block;
    width: 100%;
    height: 30px;
    padding: 0 10px;
    border: none;
    border-radius: var(--r-s);
    background: transparent;
    text-align: start;
    white-space: nowrap;
    cursor: default;
  }
  .ctx button:hover,
  .ctx button:focus-visible {
    background: var(--accent-soft);
    outline: none;
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }
</style>
