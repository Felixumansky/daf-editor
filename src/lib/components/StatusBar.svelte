<script lang="ts">
  import { ws } from '$lib/state/workspace.svelte';
  import { getLanguage } from '$lib/editor/languages';
  import { pickEncoding, pickEol, pickLanguage } from '$lib/commands/pickers';
  import { registry } from '$lib/commands/registry';
  import { t } from '$lib/i18n/index.svelte';
  import { ui } from '$lib/ui.svelte';
  import Icon from './Icon.svelte';

  const tab = $derived(ws.active);
  const zoomPct = $derived(Math.round(100 * (1 + ws.settings['editor.zoom'] * 0.1)));
  const dirKey = $derived(tab?.dirOverride ? (tab.dirOverride === 'rtl' ? 'status.dir.rtl' : 'status.dir.ltr') : 'status.dir.auto');
  const encodingLabel = $derived(tab ? `${tab.encoding}${tab.bom ? ' BOM' : ''}` : '');

  async function copySum(sum: number) {
    try {
      await navigator.clipboard.writeText(String(sum));
      ui.toast(t('toast.copied', { text: String(sum) }));
    } catch (e) {
      ui.toast(String(e), 'error');
    }
  }

  function cycleDirection() {
    const next = !tab?.dirOverride ? 'rtl' : tab.dirOverride === 'rtl' ? 'ltr' : null;
    ws.setDirection(next);
  }
</script>

{#if tab}
  <footer class="status">
    <button class="item" onclick={() => registry.run('search.gotoLine')}>
      {t('status.ln', { line: ws.cursor.line, col: ws.cursor.col })}
      {#if ws.cursor.cursors > 1}
        · {t('status.cursors', { n: ws.cursor.cursors })}
      {:else if ws.cursor.selected}
        {t('status.sel', { n: ws.cursor.selected })}
      {/if}
    </button>
    {#if ws.cursor.stats}
      {@const stats = ws.cursor.stats}
      <span class="item">{t('status.words', { n: stats.words })}</span>
      {#if stats.numbers}
        <button
          class="item"
          title={t('status.sum.title', { count: stats.numbers.count, avg: stats.numbers.avg })}
          onclick={() => copySum(stats.numbers!.sum)}
        >
          {t('status.sum', { sum: stats.numbers.sum })}
        </button>
      {/if}
      {#if stats.gematria}
        <span class="item" title={t('status.gematria.title')}>{t('status.gematria', { n: stats.gematria })}</span>
      {/if}
    {/if}

    <span class="spacer"></span>

    {#if tab.readonly}<span class="item warn"><Icon name="lock" size={12} />{t('status.readonly')}</span>{/if}
    {#if tab.docKind === 'large'}<span class="item warn"><Icon name="info" size={12} />{t('status.large')}</span>{/if}
    {#if tab.lossy}<span class="item warn"><Icon name="alert" size={12} />{t('status.lossy')}</span>{/if}

    <button class="item" class:on={!!tab.dirOverride} onclick={cycleDirection} title={t(dirKey)}>
      <Icon name={tab.dirOverride === 'rtl' ? 'arrow-left' : tab.dirOverride === 'ltr' ? 'arrow-right' : 'arrow-left-right'} size={13} />
      {tab.dirOverride === 'rtl' ? 'RTL' : tab.dirOverride === 'ltr' ? 'LTR' : t('status.dir.auto')}
    </button>
    <button class="item" onclick={() => ws.zoom(null)} title={t('status.zoom', { pct: zoomPct })}>{zoomPct}%</button>
    <button class="item" onclick={pickLanguage}>{getLanguage(tab.lang).label}</button>
    <button
      class="item"
      class:warn={tab.eolMixed}
      onclick={pickEol}
      title={tab.eolMixed ? t('status.mixedEol', { eol: tab.eol.toUpperCase() }) : t('pick.eol')}
    >
      {#if tab.eolMixed}<Icon name="alert" size={12} />{/if}
      {tab.eol.toUpperCase()}
    </button>
    <button
      class="item"
      class:badge={!/^utf-8$/i.test(tab.encoding) || tab.bom}
      class:warn={tab.confidence === 'guessed'}
      onclick={() => pickEncoding(tab.kind === 'file' ? 'reopen' : 'convert')}
      oncontextmenu={(e) => {
        e.preventDefault();
        pickEncoding('convert');
      }}
      title={tab.confidence === 'guessed' ? t('status.guessed') : t('pick.encoding.reopen')}
    >
      {#if tab.confidence === 'guessed'}<Icon name="alert" size={12} />{/if}
      {encodingLabel}
    </button>
  </footer>
{/if}

<style>
  /* Sits on the (Mica) chrome under the sheet; every value is a pill you can click. */
  .status {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 30px;
    padding-inline: 8px;
    color: var(--fg-muted);
    font-size: 12px;
    flex-shrink: 0;
    user-select: none;
  }
  :global(:root[data-focused='false']) .status {
    opacity: 0.65;
  }
  .spacer {
    flex: 1;
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    unicode-bidi: isolate;
    transition:
      background var(--dur-1),
      color var(--dur-1);
  }
  button.item {
    cursor: pointer;
  }
  button.item:hover {
    background: var(--hover);
    color: var(--fg);
  }
  button.item:active {
    background: var(--pressed);
  }
  .item.on {
    color: var(--accent);
  }
  /* Not plain UTF-8 (e.g. windows-1255): worth seeing at a glance. */
  .item.badge {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
  .warn,
  .item.badge.warn {
    color: var(--warn);
  }
  .item.badge.warn {
    background: var(--warn-bg);
  }
</style>
