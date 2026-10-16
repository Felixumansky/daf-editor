<script lang="ts">
  import { ui } from '$lib/ui.svelte';
  import { ws } from '$lib/state/workspace.svelte';
  import { t } from '$lib/i18n/index.svelte';
  import { api } from '$lib/ipc/api';

  const year = new Date().getFullYear();
  let closeBtn: HTMLButtonElement;

  $effect(() => {
    closeBtn.focus();
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      ui.closeAbout();
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && ui.closeAbout()}>
  <div class="about" role="dialog" aria-modal="true" aria-labelledby="about-name" tabindex="-1" onkeydown={onKey}>
    <div class="hero" aria-hidden="true">
      <img class="logo" src="/favicon.png" alt="" width="64" height="64" />
    </div>
    <h2 id="about-name">{t('app.name')}</h2>
    <p class="tagline">{t('about.tagline')}</p>
    <p class="version">{t('about.version', { version: ws.version })}</p>

    <div class="credit">
      <span class="label">{t('about.builtBy')}</span>
      <span class="author">{t('about.author')}</span>
    </div>

    <ul class="facts">
      <li>{t('about.privacy')}</li>
      <li>{t('about.license')}</li>
    </ul>

    {#if ws.homepage}
      <button class="link" dir="ltr" title={t('about.homepage')} onclick={() => api.appOpenHomepage()}>
        {ws.homepage.replace(/^https?:\/\//, '')}
      </button>
    {/if}

    <p class="copyright" dir="ltr">© {year} Felix Umansky</p>

    <button class="primary" bind:this={closeBtn} onclick={() => ui.closeAbout()}>{t('about.close')}</button>
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
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
    animation: daf-fade var(--dur-2) var(--ease-out);
  }
  .about {
    position: relative;
    width: min(380px, calc(100vw - 32px));
    padding: 32px 28px 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    background:
      radial-gradient(120% 60% at 50% 0%, color-mix(in srgb, var(--brand-1) 16%, transparent), transparent 70%),
      var(--surface-1);
    border-radius: 20px;
    box-shadow: var(--glass-edge), var(--elev-3);
    outline: none;
    overflow: hidden;
    animation: daf-rise var(--dur-3) var(--ease-spring);
  }
  .hero {
    position: relative;
    display: grid;
    place-items: center;
    margin-bottom: 12px;
  }
  /* A soft halo in the icon's ink and caret colors. */
  .hero::before {
    content: '';
    position: absolute;
    width: 120px;
    height: 120px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 35% 40%, rgb(79 125 255 / 0.45), transparent 60%),
      radial-gradient(circle at 70% 70%, rgb(255 180 84 / 0.3), transparent 55%);
    filter: blur(18px);
    animation: halo 6s ease-in-out infinite alternate;
  }
  @keyframes halo {
    to {
      transform: rotate(40deg) scale(1.12);
    }
  }
  .logo {
    position: relative;
    width: 72px;
    height: 72px;
    filter: drop-shadow(0 8px 18px rgb(20 30 80 / 0.35));
  }
  h2 {
    margin: 0;
    font-family: var(--ui-font-display);
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.01em;
    background: var(--brand-grad);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .tagline {
    margin: 4px 0 0;
    color: var(--fg-muted);
  }
  .version {
    margin: 10px 0 0;
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--hover);
    color: var(--fg-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .credit {
    margin: 22px 0 0;
    padding: 14px 0;
    width: 100%;
    border-block: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .label {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .author {
    font-size: 16px;
    font-weight: 600;
  }
  .facts {
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
    color: var(--fg-muted);
    font-size: 12px;
    line-height: 1.7;
  }
  .copyright {
    margin: 12px 0 18px;
    color: var(--fg-muted);
    font-size: 12px;
  }
  button.primary {
    min-width: 110px;
    height: 32px;
    padding: 0 16px;
    border: none;
    border-radius: var(--r-m);
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.12), 0 4px 12px color-mix(in srgb, var(--accent) 35%, transparent);
    transition:
      background var(--dur-1),
      transform var(--dur-1);
  }
  button.primary:hover {
    background: var(--accent-hover);
  }
  button.primary:active {
    transform: scale(0.97);
  }
  button.link {
    margin: 10px 0 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
  }
  button.link:hover {
    text-decoration: underline;
  }
</style>
