<script lang="ts">
  import { ws, tabTitle, type Tab } from '$lib/state/workspace.svelte';
  import { pickEncoding } from '$lib/commands/pickers';
  import { t } from '$lib/i18n/index.svelte';

  let { tab }: { tab: Tab } = $props();
  const name = $derived(tabTitle(tab));
</script>

{#if tab.missing}
  <div class="banner" role="alert">
    <span dir="auto">{t('banner.deleted', { name })}</span>
    <button onclick={() => ws.keepMine(tab.docId)}>{t('banner.keepMine')}</button>
    <button onclick={() => ws.close(tab.docId)}>{t('banner.close')}</button>
  </div>
{:else if tab.diskChanged}
  <div class="banner" role="alert">
    <span dir="auto">{t('banner.diskChanged', { name })}</span>
    <button onclick={() => ws.keepMine(tab.docId)}>{t('banner.keepMine')}</button>
    <button onclick={() => ws.reloadFromDisk(tab.docId)}>{t('banner.loadDisk')}</button>
  </div>
{:else if tab.lossy}
  <div class="banner" role="status">
    <span dir="auto">{t('banner.lossy', { name, encoding: tab.encoding })}</span>
    <button onclick={() => pickEncoding('reopen')}>{t('banner.change')}</button>
  </div>
{:else if tab.confidence === 'guessed' && !tab.guessNoticed}
  <div class="banner info" role="status">
    <span dir="auto">{t('banner.guessed', { name, encoding: tab.encoding })}</span>
    <button onclick={() => pickEncoding('reopen')}>{t('banner.change')}</button>
    <button onclick={() => (tab.guessNoticed = true)}>{t('banner.dismiss')}</button>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--warn-bg);
    border-bottom: 1px solid var(--warn-border);
    flex-shrink: 0;
  }
  .banner.info {
    background: var(--accent-soft);
    border-bottom-color: var(--border);
  }
  span {
    flex: 1;
  }
  button {
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-1);
    cursor: pointer;
  }
  button:hover {
    background: var(--surface-2);
  }
</style>
