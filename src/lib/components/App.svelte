<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';

  import MenuBar from './MenuBar.svelte';
  import TabBar from './TabBar.svelte';
  import EditorHost from './EditorHost.svelte';
  import StatusBar from './StatusBar.svelte';
  import Banner from './Banner.svelte';
  import QuickPick from './QuickPick.svelte';
  import Dialog from './Dialog.svelte';
  import Toasts from './Toasts.svelte';

  import { ws } from '$lib/state/workspace.svelte';
  import { ui } from '$lib/ui.svelte';
  import { registry } from '$lib/commands/registry';
  import { registerBuiltinCommands } from '$lib/commands/builtin';
  import { api, EVENTS, type OpenRequest, type Settings } from '$lib/ipc/api';
  import { i18n } from '$lib/i18n/index.svelte';

  if (!registry.get('file.new')) registerBuiltinCommands();

  /** Key bindings run before CodeMirror sees the key (capture phase), so the registry wins conflicts. */
  function onKeyDown(e: KeyboardEvent) {
    if (ui.dialog || e.isComposing) return;
    const cmd = registry.commandForEvent(e);
    if (!cmd) return;
    if (ui.quickPick && cmd.id !== 'view.palette') return;
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
    const onFocus = () => void ws.checkDisk();
    const onBlur = () => void ws.flushAllBuffers();
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
  <MenuBar />
  <TabBar />
  {#if ws.active}
    <Banner tab={ws.active} />
  {/if}
  <EditorHost />
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
<Toasts />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
</style>
