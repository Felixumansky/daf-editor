<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';

  import TitleBar from './TitleBar.svelte';
  import TabBar from './TabBar.svelte';
  import EditorHost from './EditorHost.svelte';
  import MarkdownPreview from './MarkdownPreview.svelte';
  import StatusBar from './StatusBar.svelte';
  import Banner from './Banner.svelte';
  import QuickPick from './QuickPick.svelte';
  import Dialog from './Dialog.svelte';
  import About from './About.svelte';
  import Toasts from './Toasts.svelte';

  import { ws } from '$lib/state/workspace.svelte';
  import { ui } from '$lib/ui.svelte';
  import { registry } from '$lib/commands/registry';
  import { registerBuiltinCommands } from '$lib/commands/builtin';
  import { api, EVENTS, type OpenRequest, type Settings } from '$lib/ipc/api';
  import { i18n } from '$lib/i18n/index.svelte';
  import { compare } from '$lib/diff/compare.svelte';
  import CompareView from './CompareView.svelte';

  if (!registry.get('file.new')) registerBuiltinCommands();

  const COMPARE_KEYS = new Set(['file.save', 'file.saveAll', 'view.palette', 'view.zoomIn', 'view.zoomOut', 'view.zoomReset']);

  /** Key bindings run before CodeMirror sees the key (capture phase), so the registry wins conflicts. */
  function onKeyDown(e: KeyboardEvent) {
    if (ui.dialog || ui.about || e.isComposing) return;
    const cmd = registry.commandForEvent(e);
    if (!cmd) return;
    if (ui.quickPick && cmd.id !== 'view.palette') return;
    // Compare keys do nothing (and stay with the editor) unless a comparison is open.
    if (cmd.id.startsWith('compare.') && cmd.enabled && !cmd.enabled()) return;
    // While comparing, editor commands would act on the hidden main editor.
    if (compare.open && !COMPARE_KEYS.has(cmd.id) && !cmd.id.startsWith('compare.')) return;
    if (cmd.when === 'editor') {
      const inEditor = ws.view?.hasFocus || document.activeElement === document.body;
      if (!inEditor) return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (cmd.id === 'view.palette' && ui.quickPick) {
      ui.closeQuickPick();
      return;
    }
    registry.run(cmd.id);
  }

  $effect(() => {
    registry.setPreset(ws.settings['keymap.preset'], ws.platform === 'macos');
  });

  $effect(() => {
    // Track what the title depends on.
    void ws.active?.dirty;
    void ws.active?.path;
    void i18n.lang;
    ws.updateWindowTitle();
  });

  onMount(() => {
    window.addEventListener('keydown', onKeyDown, { capture: true });
    // data-focused dims the chrome while the window is inactive, like native Windows apps.
    const root = document.documentElement;
    const onFocus = () => {
      root.dataset.focused = 'true';
      void ws.checkDisk();
    };
    const onBlur = () => {
      root.dataset.focused = 'false';
      void ws.flushAllBuffers();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => ws.applySettings(ws.settings);
    scheme.addEventListener('change', onScheme);

    const unlisten = Promise.all([
      listen<OpenRequest[]>(EVENTS.openFiles, (e) => void ws.openPaths(e.payload)),
      listen<Settings>(EVENTS.settingsChanged, (e) => ws.applySettings(e.payload)),
      listen(EVENTS.flushRequest, async () => {
        try {
          await ws.flushForQuit();
        } finally {
          await api.appQuitReady();
        }
      }),
    ]);

    ws.init()
      .catch((e) => {
        console.error('startup failed', e);
        ui.toast(String(e?.message ?? e), 'error', 10000);
      })
      .finally(() => {
        // Show the window only after the first real paint: no white flash.
        requestAnimationFrame(() => requestAnimationFrame(() => void api.appShown()));
      });

    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      scheme.removeEventListener('change', onScheme);
      void unlisten.then((fns) => fns.forEach((f) => f()));
    };
  });
</script>

<div class="app">
  <TitleBar />
  <TabBar />
  <!-- The page: an opaque sheet floating on the (Mica) chrome; the active tab joins it. -->
  <main class="sheet">
    {#if compare.open}
      <CompareView />
    {:else if ws.active}
      <Banner tab={ws.active} />
    {/if}
    <!-- Kept mounted while comparing: it owns the main EditorView. -->
    <div class="editor-slot" class:hidden={compare.open}>
      <EditorHost />
      {#if ws.mdPreview && ws.active?.lang === 'markdown'}
        <MarkdownPreview />
      {/if}
    </div>
  </main>
  <StatusBar />
</div>

{#if ui.quickPick}
  {#key ui.quickPick}
    <QuickPick spec={ui.quickPick} />
  {/key}
{/if}
{#if ui.dialog}
  <Dialog spec={ui.dialog} />
{/if}
{#if ui.about}
  <About />
{/if}
<Toasts />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .sheet {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    margin-inline: 6px;
    border-radius: var(--r-l);
    background: var(--ed-bg);
    box-shadow: var(--elev-1);
    overflow: hidden;
  }
  /* The tab strip joins the sheet: square the corner under the first tab when it is active. */
  :global(.tabbar:has(.tab.active:first-child)) + .sheet {
    border-start-start-radius: 0;
  }
  /* A row: the editor, and the Markdown preview beside it when open. */
  .editor-slot {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .editor-slot > :global(.editor) {
    min-width: 0;
  }
  .editor-slot.hidden {
    display: none;
  }
</style>
