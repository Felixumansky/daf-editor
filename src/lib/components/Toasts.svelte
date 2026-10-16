<script lang="ts">
  import { ui } from '$lib/ui.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each ui.toasts as toast (toast.id)}
    <div class="toast" class:error={toast.kind === 'error'} dir="auto">{toast.text}</div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    inset-block-end: 36px;
    inset-inline-end: 16px;
    z-index: 70;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }
  .toast {
    max-width: 420px;
    padding: 9px 14px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-inline-start: 3px solid var(--accent);
    border-radius: 8px;
    box-shadow: var(--shadow);
    line-height: 1.4;
  }
  .toast.error {
    border-inline-start-color: var(--danger);
  }
</style>
