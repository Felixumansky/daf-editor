<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { ws } from '$lib/state/workspace.svelte';
  import { registry } from '$lib/commands/registry';
  import { i18n, t } from '$lib/i18n/index.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  let host: HTMLDivElement;

  /** A fresh, empty untitled page shows a quiet welcome; the first keystroke hides it. */
  const blank = $derived.by(() => {
    void ws.cursor; // Updated on every edit and selection change.
    const tab = ws.active;
    return !!tab && tab.kind === 'untitled' && !tab.readonly && ws.view?.state.doc.length === 0;
  });

  const actions: { id: string; icon: IconName; label: () => string }[] = [
    { id: 'file.open', icon: 'folder-open', label: () => t('empty.open') },
    { id: 'file.openRecent', icon: 'file-plus', label: () => t('empty.recent') },
    { id: 'view.palette', icon: 'command', label: () => t('empty.palette') },
  ];

  onMount(() => {
    const view = new EditorView({ parent: host });
    ws.attachView(view);

    // Ctrl+wheel zooms the editor font (not the UI).
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      ws.zoom(e.deltaY < 0 ? 1 : -1);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      host.removeEventListener('wheel', onWheel);
      view.destroy();
    };
  });
</script>

<div class="editor" bind:this={host} dir="ltr">
  {#if blank}
    <div class="blank" dir={i18n.lang === 'he' ? 'rtl' : 'ltr'}>
      <div class="lines" aria-hidden="true">
        <span style:width="72%"></span>
        <span style:width="48%"></span>
        <span style:width="86%"></span>
        <span class="caret"></span>
      </div>
      <h3>{t('empty.title')}</h3>
      <p>{t('empty.body')}</p>
      <div class="actions">
        {#each actions as a (a.id)}
          <button onclick={() => registry.run(a.id)}>
            <Icon name={a.icon} size={15} />
            <span>{a.label()}</span>
            {#if registry.keyLabel(a.id)}<span class="kbd">{registry.keyLabel(a.id)}</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .editor {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--ed-bg);
  }
  .editor :global(.cm-editor) {
    flex: 1;
    min-height: 0;
  }
  .editor :global(.cm-editor.cm-focused) {
    outline: none;
  }

  /* Clicks fall through to the editor everywhere except the action buttons. */
  .blank {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
    pointer-events: none;
    animation: blank-in 500ms var(--ease-out) both;
  }
  @keyframes blank-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  /* The icon's right-aligned lines, drawn in CSS, with the amber caret blinking at the end. */
  .lines {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 7px;
    width: 92px;
    margin-bottom: 22px;
    padding: 18px 16px;
    border-radius: 14px;
    background: linear-gradient(160deg, color-mix(in srgb, var(--brand-1) 9%, transparent), transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand-1) 16%, transparent);
  }
  .lines span {
    height: 6px;
    border-radius: 3px;
    background: var(--brand-grad);
    opacity: 0.55;
  }
  .lines .caret {
    width: 3px;
    height: 14px;
    margin-top: -4px;
    align-self: center;
    background: var(--ed-caret);
    opacity: 1;
    animation: blink 1.1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  h3 {
    margin: 0 0 6px;
    font-family: var(--ui-font-display);
    font-size: 18px;
    font-weight: 600;
    color: var(--fg);
  }
  p {
    max-width: 380px;
    margin: 0 0 20px;
    color: var(--fg-muted);
    line-height: 1.55;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 12px;
    border: none;
    border-radius: var(--r-m);
    background: var(--surface-2);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--fg);
    font-size: 12.5px;
    cursor: pointer;
    pointer-events: auto;
    transition:
      background var(--dur-1),
      box-shadow var(--dur-1),
      transform var(--dur-2) var(--ease-spring);
  }
  .actions button:hover {
    background: var(--surface-1);
    box-shadow: 0 0 0 1px var(--accent-ring), 0 4px 14px rgb(20 30 60 / 0.1);
    transform: translateY(-1px);
  }
  .actions button :global(.icon) {
    color: var(--accent);
  }
</style>
