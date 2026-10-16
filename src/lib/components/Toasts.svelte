<script lang="ts">
  import { ui } from '$lib/ui.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each ui.toasts as toast (toast.id)}
    <div class="toast glass" class:error={toast.kind === 'error'} dir="auto">{toast.text}</div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    inset-block-end: 44px;
    inset-inline-end: 20px;
    z-index: 70;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }
  .toast {
    position: relative;
    max-width: 420px;
    padding: 10px 16px 10px 20px;
    border-radius: var(--r-l);
    line-height: 1.45;
    animation: toast-in var(--dur-3) var(--ease-spring);
  }
  .toast::before {
    content: '';
    position: absolute;
    inset-inline-start: 8px;
    top: 10px;
    bottom: 10px;
    width: 3px;
    border-radius: 3px;
    background: var(--brand-grad);
  }
  .toast.error::before {
    background: var(--danger);
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.96);
    }
  }
</style>
