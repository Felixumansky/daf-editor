<script lang="ts">
  import type { DialogSpec } from '$lib/ui.svelte';

  let { spec }: { spec: DialogSpec } = $props();
  let box: HTMLDivElement;

  $effect(() => {
    const primary = box.querySelector<HTMLButtonElement>('button.primary') ?? box.querySelector('button');
    primary?.focus();
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      spec.resolve('cancel');
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const buttons = [...box.querySelectorAll<HTMLButtonElement>('button')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }
</script>

<div class="backdrop">
  <div
    class="dialog"
    bind:this={box}
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="dlg-title"
    aria-describedby="dlg-body"
    tabindex="-1"
    onkeydown={onKey}
  >
    <h2 id="dlg-title" dir="auto">{spec.title}</h2>
    {#if spec.body}<p id="dlg-body" dir="auto">{spec.body}</p>{/if}
    <div class="buttons">
      {#each spec.buttons as b (b.id)}
        <button class:primary={b.primary} class:danger={b.danger} onclick={() => spec.resolve(b.id)}>{b.label}</button>
      {/each}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.28);
  }
  .dialog {
    width: min(460px, calc(100vw - 32px));
    padding: 20px 22px 16px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    outline: none;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0 0 18px;
    color: var(--fg-muted);
    line-height: 1.5;
  }
  .buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  button {
    min-width: 84px;
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface-2);
    cursor: pointer;
  }
  button:hover {
    background: var(--surface-3);
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }
  button.danger {
    color: var(--danger);
  }
</style>
