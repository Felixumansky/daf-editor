<script lang="ts">
  import { CATEGORY_TITLES, registry, type Category, type Command } from '$lib/commands/registry';
  import { pick } from '$lib/i18n/index.svelte';
  import { ws } from '$lib/state/workspace.svelte';
  import Icon from './Icon.svelte';

  const ORDER: Category[] = ['file', 'edit', 'search', 'view', 'format', 'help'];

  let open = $state<Category | null>(null);
  let bar: HTMLElement;

  /** Menu entries with `null` marking a separator between groups. */
  function entries(cat: Category): (Command | null)[] {
    const out: (Command | null)[] = [];
    let group: string | undefined;
    for (const c of registry.all().filter((c) => c.category === cat && c.menu)) {
      if (out.length && c.group !== group) out.push(null);
      group = c.group;
      out.push(c);
    }
    return out;
  }

  function run(cmd: Command) {
    open = null;
    ws.view?.focus();
    registry.run(cmd.id);
  }

  function onWindowDown(e: MouseEvent) {
    if (open && !bar.contains(e.target as Node)) open = null;
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      open = null;
      ws.view?.focus();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const dir = document.documentElement.dir === 'rtl' ? -1 : 1;
      const i = ORDER.indexOf(open);
      open = ORDER[(i + (e.key === 'ArrowRight' ? 1 : -1) * dir + ORDER.length) % ORDER.length];
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...bar.querySelectorAll<HTMLButtonElement>('.menu button:not(:disabled)')];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }
</script>

<svelte:window onmousedown={onWindowDown} onkeydown={onKey} />

<nav class="menubar" bind:this={bar}>
  {#each ORDER as cat (cat)}
    <div class="top">
      <button
        class="head"
        class:open={open === cat}
        aria-haspopup="menu"
        aria-expanded={open === cat}
        onclick={() => (open = open === cat ? null : cat)}
        onmouseenter={() => open && (open = cat)}
      >
        {pick(CATEGORY_TITLES[cat])}
      </button>
      {#if open === cat}
        <div class="menu glass" role="menu">
          {#each entries(cat) as entry, i (entry?.id ?? `sep-${i}`)}
            {#if entry === null}
              <div class="sep" role="separator"></div>
            {:else}
              <button role="menuitem" disabled={entry.enabled ? !entry.enabled() : false} onclick={() => run(entry)}>
                <span class="check">{#if entry.checked?.()}<Icon name="check" size={13} stroke={2.4} />{/if}</span>
                <span class="label">{pick(entry.title)}</span>
                <span class="kbd">{registry.keyLabel(entry.id)}</span>
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</nav>

<style>
  /* Lives inside the title bar: no background of its own. */
  .menubar {
    display: flex;
    align-items: center;
    gap: 1px;
    height: 100%;
    flex-shrink: 0;
    user-select: none;
  }
  .top {
    position: relative;
  }
  .head {
    height: 28px;
    padding: 0 10px;
    border: none;
    border-radius: var(--r-s);
    background: transparent;
    color: var(--fg);
    font-size: 12.5px;
    cursor: default;
    transition: background var(--dur-1);
  }
  .head:hover {
    background: var(--hover);
  }
  .head.open {
    background: var(--pressed);
  }
  .menu {
    position: absolute;
    inset-inline-start: 0;
    top: 34px;
    z-index: 40;
    min-width: 270px;
    padding: 5px;
    border-radius: var(--r-l);
    transform-origin: top left;
    animation: daf-pop var(--dur-2) var(--ease-out);
  }
  :global([dir='rtl']) .menu {
    transform-origin: top right;
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 10px 0 6px;
    border: none;
    border-radius: var(--r-s);
    background: transparent;
    text-align: start;
    cursor: default;
  }
  .menu button:hover:not(:disabled),
  .menu button:focus-visible {
    background: var(--accent-soft);
    outline: none;
  }
  .menu button:hover:not(:disabled) .kbd,
  .menu button:focus-visible .kbd {
    color: var(--fg-muted);
  }
  .menu button:disabled {
    opacity: 0.4;
  }
  .check {
    display: grid;
    place-items: center;
    width: 18px;
    color: var(--accent);
  }
  .label {
    flex: 1;
    white-space: nowrap;
  }
  .sep {
    height: 1px;
    margin: 5px 8px;
    background: var(--border);
  }
</style>
