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
  /* An inset callout at the top of the page, not a full-width strip. */
  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 10px 2px;
    padding: 6px 8px 6px 14px;
    border: 1px solid var(--warn-border);
    border-radius: var(--r-m);
    background: var(--warn-bg);
    flex-shrink: 0;
    animation: daf-pop var(--dur-2) var(--ease-out);
  }
  .banner.info {
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent) 25%, transparent);
  }
  span {
    flex: 1;
  }
  button {
    height: 26px;
    padding: 0 12px;
    border: none;
    border-radius: var(--r-s);
    background: var(--surface-1);
    box-shadow: 0 0 0 1px var(--border);
    cursor: pointer;
    transition: background var(--dur-1);
  }
  button:hover {
    background: var(--surface-2);
  }
</style>
