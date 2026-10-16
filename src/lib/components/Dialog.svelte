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
    background: var(--backdrop);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    animation: daf-fade var(--dur-2) var(--ease-out);
  }
  .dialog {
    width: min(460px, calc(100vw - 32px));
    padding: 22px 24px 18px;
    background: var(--surface-1);
    border-radius: var(--r-xl);
    box-shadow: var(--glass-edge), var(--elev-3);
    outline: none;
    animation: daf-rise var(--dur-3) var(--ease-spring);
  }
  h2 {
    margin: 0 0 8px;
    font-family: var(--ui-font-display);
    font-size: 16px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0 0 20px;
    color: var(--fg-muted);
    line-height: 1.55;
  }
  .buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  button {
    min-width: 88px;
    height: 32px;
    padding: 0 16px;
    border: none;
    border-radius: var(--r-m);
    background: var(--hover);
    cursor: pointer;
    transition:
      background var(--dur-1),
      transform var(--dur-1);
  }
  button:hover {
    background: var(--pressed);
  }
  button:active {
    transform: scale(0.97);
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 600;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.12), 0 4px 12px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  button.primary:hover {
    background: var(--accent-hover);
  }
  button.danger {
    color: var(--danger);
  }
</style>
