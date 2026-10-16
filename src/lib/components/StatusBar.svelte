<script lang="ts">
  import { ws } from '$lib/state/workspace.svelte';
  import { getLanguage } from '$lib/editor/languages';
  import { pickEncoding, pickEol, pickLanguage } from '$lib/commands/pickers';
  import { registry } from '$lib/commands/registry';
  import { t } from '$lib/i18n/index.svelte';

  const tab = $derived(ws.active);
  const zoomPct = $derived(Math.round(100 * (1 + ws.settings['editor.zoom'] * 0.1)));
  const dirKey = $derived(tab?.dirOverride ? (tab.dirOverride === 'rtl' ? 'status.dir.rtl' : 'status.dir.ltr') : 'status.dir.auto');
  const encodingLabel = $derived(tab ? `${tab.encoding}${tab.bom ? ' BOM' : ''}` : '');

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

    <span class="spacer"></span>

    {#if tab.readonly}<span class="item warn">{t('status.readonly')}</span>{/if}
    {#if tab.docKind === 'large'}<span class="item warn">{t('status.large')}</span>{/if}
    {#if tab.lossy}<span class="item warn">{t('status.lossy')}</span>{/if}

    <button class="item" onclick={cycleDirection} title={t(dirKey)}>
      {tab.dirOverride === 'rtl' ? '⇐ RTL' : tab.dirOverride === 'ltr' ? 'LTR ⇒' : '⇔ ' + t('status.dir.auto')}
    </button>
    <button class="item" onclick={() => ws.zoom(null)} title={t('status.zoom', { pct: zoomPct })}>{zoomPct}%</button>
    <button class="item" onclick={pickLanguage}>{getLanguage(tab.lang).label}</button>
    <button
      class="item"
      class:warn={tab.eolMixed}
      onclick={pickEol}
      title={tab.eolMixed ? t('status.mixedEol', { eol: tab.eol.toUpperCase() }) : t('pick.eol')}
    >
      {tab.eol.toUpperCase()}{tab.eolMixed ? ' ⚠' : ''}
    </button>
    <button
      class="item"
      class:warn={tab.confidence === 'guessed'}
      onclick={() => pickEncoding(tab.kind === 'file' ? 'reopen' : 'convert')}
      oncontextmenu={(e) => {
        e.preventDefault();
        pickEncoding('convert');
      }}
      title={tab.confidence === 'guessed' ? t('status.guessed') : t('pick.encoding.reopen')}
    >
      {encodingLabel}{tab.confidence === 'guessed' ? ' ?' : ''}
    </button>
  </footer>
{/if}

<style>
  .status {
    display: flex;
    align-items: center;
    height: 26px;
    padding-inline: 6px;
    background: var(--surface-2);
    border-top: 1px solid var(--border);
    color: var(--fg-muted);
    font-size: 12px;
    flex-shrink: 0;
    user-select: none;
  }
  .spacer {
    flex: 1;
  }
  .item {
    height: 22px;
    padding: 0 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-size: 12px;
    white-space: nowrap;
    unicode-bidi: isolate;
  }
  button.item {
    cursor: pointer;
  }
  button.item:hover {
    background: var(--surface-3);
    color: var(--fg);
  }
  .warn {
    color: var(--dirty);
  }
</style>
