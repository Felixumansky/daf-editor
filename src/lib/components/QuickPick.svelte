<script lang="ts">
  import { untrack } from 'svelte';
  import { ui, type QuickPickSpec } from '$lib/ui.svelte';
  import { ws } from '$lib/state/workspace.svelte';

  let { spec }: { spec: QuickPickSpec } = $props();

  // The component is re-created per spec ({#key}), so the initial query is read once on purpose.
  let query = $state(untrack(() => spec.initialQuery) ?? '');
  let selected = $state(0);
  let input: HTMLInputElement;
  let list: HTMLUListElement | undefined = $state();

  const items = $derived(spec.items ? spec.items(query) : []);
  const error = $derived(spec.validate ? spec.validate(query) : null);

  $effect(() => {
    // Reset the highlight whenever the result list changes.
    void items;
    selected = 0;
  });

  $effect(() => {
    input.focus();
  });

  function close() {
    ui.closeQuickPick();
    ws.view?.focus();
  }

  function accept(index = selected) {
    if (spec.items && !items.length) return;
    if (error) return;
    const item = spec.items ? items[index] : null;
    close();
    spec.onAccept(item ?? null, query);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      accept();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      list?.children[selected]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      selected = Math.max(0, Math.min(items.length - 1, selected + (e.key === 'PageDown' ? 10 : -10)));
      list?.children[selected]?.scrollIntoView({ block: 'nearest' });
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={close}>
  <div class="panel" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" aria-modal="true" aria-label={spec.placeholder}>
    <input
      bind:this={input}
      bind:value={query}
      onkeydown={onKey}
      placeholder={spec.placeholder}
      dir="auto"
      spellcheck="false"
      autocomplete="off"
      role="combobox"
      aria-expanded="true"
      aria-controls="qp-list"
      aria-activedescendant={items.length ? `qp-${selected}` : undefined}
    />
    {#if error}
      <div class="message error">{error}</div>
    {/if}
    {#if spec.items}
      {#if items.length}
        <ul id="qp-list" role="listbox" bind:this={list}>
          {#each items as item, i (item.id)}
            <li
              id="qp-{i}"
              role="option"
              aria-selected={i === selected}
              class:selected={i === selected}
              onmousemove={() => (selected = i)}
              onclick={() => accept(i)}
            >
              <span class="label" dir="auto">{item.label}</span>
              {#if item.detail}<span class="detail" dir="auto">{item.detail}</span>{/if}
              {#if item.hint}<span class="kbd">{item.hint}</span>{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <div class="message">{spec.emptyText ?? ''}</div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 56px;
  }
  .panel {
    width: min(640px, calc(100vw - 32px));
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  input {
    width: 100%;
    padding: 10px 14px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 14px;
    outline: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 4px;
    max-height: min(420px, 60vh);
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  li.selected {
    background: var(--accent-soft);
  }
  .label {
    white-space: nowrap;
  }
  .detail {
    flex: 1;
    color: var(--fg-muted);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kbd {
    margin-inline-start: auto;
  }
  .message {
    padding: 10px 14px;
    color: var(--fg-muted);
  }
  .message.error {
    color: var(--danger);
  }
</style>
