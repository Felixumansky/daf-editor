<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import MenuBar from './MenuBar.svelte';
  import Icon from './Icon.svelte';
  import { ws, tabTitle } from '$lib/state/workspace.svelte';
  import { ui } from '$lib/ui.svelte';
  import { registry } from '$lib/commands/registry';
  import { api } from '$lib/ipc/api';
  import { t, i18n } from '$lib/i18n/index.svelte';

  const win = getCurrentWindow();
  /** Daf draws its own caption buttons only where the native frame is off (tauri.windows.conf.json). */
  const custom = $derived(ws.platform === 'windows');

  let maximized = $state(false);
  let snapHover = $state(false);
  let snapPressed = $state(false);
  let maxBtn = $state<HTMLButtonElement>();

  const modal = $derived(!!(ui.dialog || ui.about || ui.quickPick));
  const fileName = $derived(ws.active ? tabTitle(ws.active) : '');

  /** Keep the native snap overlay exactly over the HTML maximize button. */
  function syncSnap() {
    if (!custom) return;
    const r = maxBtn?.getBoundingClientRect();
    // Modals cover the title bar: the overlay must not keep catching the mouse above them.
    const hide = !r || modal;
    void api.windowSnapRect(hide ? { x: 0, y: 0, w: 0, h: 0 } : { x: r.left, y: r.top, w: r.width, h: r.height }).catch(() => {});
  }

  $effect(() => {
    void modal;
    void i18n.lang; // RTL moves the buttons to the other side.
    void maxBtn;
    requestAnimationFrame(syncSnap);
  });

  onMount(() => {
    const refresh = async () => {
      maximized = await win.isMaximized().catch(() => false);
      requestAnimationFrame(syncSnap);
    };
    void refresh();
    const unlisten = Promise.all([
      win.onResized(refresh),
      listen<string>('daf://snap', (e) => {
        snapHover = e.payload !== 'leave';
        snapPressed = e.payload === 'down';
      }),
    ]);
    return () => void unlisten.then((fns) => fns.forEach((f) => f()));
  });
</script>

<svelte:window onresize={syncSnap} />

<header class="titlebar" class:custom data-tauri-drag-region>
  <div class="brand" data-tauri-drag-region>
    <svg class="mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <defs>
        <linearGradient id="tb-paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2b3550" />
          <stop offset="1" stop-color="#111522" />
        </linearGradient>
        <linearGradient id="tb-ink" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#4f7dff" />
          <stop offset="1" stop-color="#8fd0ff" />
        </linearGradient>
      </defs>
      <path d="M6 1.5h8.5l5 5v14.2a1.8 1.8 0 0 1-1.8 1.8H6a1.8 1.8 0 0 1-1.8-1.8V3.3A1.8 1.8 0 0 1 6 1.5z" fill="url(#tb-paper)" stroke="#5a74b8" stroke-width=".8" />
      <path d="M14.5 1.5v3.7a1.3 1.3 0 0 0 1.3 1.3h3.7z" fill="#4a5b8c" />
      <g fill="url(#tb-ink)">
        <rect x="7.6" y="9.4" width="9.4" height="1.6" rx=".8" />
        <rect x="10.4" y="12.4" width="6.6" height="1.6" rx=".8" />
        <rect x="6.9" y="15.4" width="10.1" height="1.6" rx=".8" />
      </g>
      <rect x="10.2" y="17.8" width=".9" height="3" rx=".45" fill="#ffb454" />
    </svg>
  </div>

  <MenuBar />

  <div class="center" data-tauri-drag-region>
    <button class="command-center" onclick={() => registry.run('view.palette')} title={t('chrome.commandCenter')}>
      <Icon name="search" size={14} />
      {#if fileName}
        <span class="file" dir="auto">{fileName}</span>
        <span class="sep" aria-hidden="true"></span>
      {/if}
      <span class="hint">{t('chrome.commandCenter')}</span>
      {#if registry.keyLabel('view.palette')}<span class="kbd">{registry.keyLabel('view.palette')}</span>{/if}
    </button>
  </div>

  {#if custom}
    <div class="caption">
      <button class="cap" tabindex="-1" aria-label={t('chrome.minimize')} title={t('chrome.minimize')} onclick={() => win.minimize()}>
        <span class="glyph">&#xE921;</span>
      </button>
      <!-- Clicks and hover on this button come from the native snap overlay above it (see snap.rs). -->
      <button
        bind:this={maxBtn}
        class="cap"
        class:hover={snapHover}
        class:pressed={snapPressed}
        tabindex="-1"
        aria-label={maximized ? t('chrome.restore') : t('chrome.maximize')}
        title={maximized ? t('chrome.restore') : t('chrome.maximize')}
        onclick={() => win.toggleMaximize()}
      >
        <span class="glyph">{maximized ? '' : ''}</span>
      </button>
      <button class="cap close" tabindex="-1" aria-label={t('chrome.close')} title={t('chrome.close')} onclick={() => win.close()}>
        <span class="glyph">&#xE8BB;</span>
      </button>
    </div>
  {/if}
</header>

<style>
  .titlebar {
    position: relative;
    z-index: 30;
    display: flex;
    align-items: center;
    height: var(--titlebar-h);
    padding-inline-start: 6px;
    flex-shrink: 0;
    user-select: none;
    transition: opacity var(--dur-2) var(--ease-out);
  }
  .titlebar:not(.custom) {
    height: 36px;
  }
  :global(:root[data-focused='false']) .titlebar > :not(.caption) {
    opacity: 0.55;
  }
  .brand {
    display: grid;
    place-items: center;
    width: 34px;
    height: 100%;
  }
  .mark {
    filter: drop-shadow(0 1px 2px rgb(20 30 70 / 0.35));
    transition: transform var(--dur-3) var(--ease-spring);
  }
  .brand:hover .mark {
    transform: rotate(-6deg) scale(1.08);
  }

  .center {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-inline: 12px;
  }
  .command-center {
    display: flex;
    align-items: center;
    gap: 8px;
    width: min(460px, 100%);
    height: 28px;
    padding-inline: 10px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-m);
    background: color-mix(in srgb, var(--surface-1) 55%, transparent);
    color: var(--fg-muted);
    font-size: 12.5px;
    cursor: pointer;
    overflow: hidden;
    transition:
      background var(--dur-1),
      border-color var(--dur-1),
      box-shadow var(--dur-2) var(--ease-out);
  }
  .command-center:hover {
    background: var(--surface-1);
    border-color: var(--border-strong);
    box-shadow: 0 2px 10px rgb(20 30 60 / 0.08);
    color: var(--fg);
  }
  .command-center .file {
    color: var(--fg);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 45%;
  }
  .command-center .sep {
    width: 1px;
    height: 12px;
    background: var(--border-strong);
  }
  .command-center .hint {
    flex: 1;
    min-width: 0;
    text-align: start;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .command-center .kbd {
    padding: 1px 6px;
    border-radius: var(--r-xs);
    background: var(--hover);
  }
  @media (max-width: 760px) {
    .command-center .hint {
      display: none;
    }
  }

  .caption {
    display: flex;
    align-self: stretch;
  }
  .cap {
    display: grid;
    place-items: center;
    width: var(--caption-w);
    height: var(--titlebar-h);
    padding: 0;
    border: none;
    background: transparent;
    color: var(--fg);
    cursor: default;
    transition: background var(--dur-1);
  }
  .glyph {
    font-family: var(--icon-font);
    font-size: 10px;
    line-height: 1;
  }
  .cap:hover,
  .cap.hover {
    background: var(--hover);
  }
  .cap:active,
  .cap.pressed {
    background: var(--pressed);
  }
  .cap.close:hover {
    background: #c42b1c;
    color: #fff;
  }
  .cap.close:active {
    background: #b3271a;
    color: #fff;
  }
</style>
