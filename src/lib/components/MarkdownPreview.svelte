<script lang="ts">
  import { onMount } from 'svelte';
  import { ws } from '$lib/state/workspace.svelte';
  import { ui } from '$lib/ui.svelte';
  import { t } from '$lib/i18n/index.svelte';
  import { imageUrl, localSource } from '$lib/editor/images';

  /**
   * Markdown preview where every block takes its own direction (`dir="auto"`), so a Hebrew
   * paragraph reads right-to-left next to an English one. The HTML always goes through DOMPurify;
   * the app's CSP blocks inline script and remote images on top of that.
   */

  let body: HTMLDivElement;
  let width = $state(Math.round(window.innerWidth * 0.45));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renderer: ((md: string) => DocumentFragment) | null = null;

  const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, ul, ol, blockquote, table, td, th, dt, dd';

  async function loadRenderer() {
    if (renderer) return renderer;
    const [{ marked }, { default: DOMPurify }] = await Promise.all([import('marked'), import('dompurify')]);
    renderer = (md) => {
      const html = marked.parse(md, { async: false, gfm: true }) as string;
      const frag = DOMPurify.sanitize(html, {
        RETURN_DOM_FRAGMENT: true,
        FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
      });
      for (const el of frag.querySelectorAll<HTMLElement>(BLOCKS)) if (!el.hasAttribute('dir')) el.dir = 'auto';
      for (const el of frag.querySelectorAll<HTMLElement>('pre, code')) el.dir = 'ltr';
      return frag;
    };
    return renderer;
  }

  async function render() {
    const id = ws.activeId;
    const doc = id ? ws.docOf(id) : null;
    if (!doc || !body) return;
    const r = await loadRenderer();
    const frag = r(doc.toString());
    // Relative pictures (pasted screenshots) come from the document's folder through Rust.
    for (const img of frag.querySelectorAll('img')) {
      const src = localSource(img.getAttribute('src') ?? '');
      if (!id || !src || src.startsWith('data:')) continue;
      img.removeAttribute('src');
      imageUrl(id, src).then(
        (url) => (img.src = url),
        () => (img.alt ||= t('image.missing', { src })),
      );
    }
    body.replaceChildren(frag);
  }

  $effect(() => {
    void ws.docTick;
    void ws.activeId;
    clearTimeout(timer);
    timer = setTimeout(() => void render(), 150);
  });

  /** Links don't navigate the app window: in-page anchors scroll, others are copied. */
  async function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      const target = body.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`);
      target?.scrollIntoView({ block: 'start' });
      return;
    }
    try {
      await navigator.clipboard.writeText(a.href || href);
      ui.toast(t('toast.copied', { text: a.href || href }));
    } catch {
      /* clipboard unavailable */
    }
  }

  // Follow the editor's scroll position proportionally.
  onMount(() => {
    const scroller = ws.view?.scrollDOM;
    if (!scroller) return;
    const sync = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      const ratio = max > 0 ? scroller.scrollTop / max : 0;
      body.scrollTop = ratio * (body.scrollHeight - body.clientHeight);
    };
    scroller.addEventListener('scroll', sync, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', sync);
      clearTimeout(timer);
    };
  });

  function startResize(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => {
      width = Math.max(200, Math.min(window.innerWidth - 240, startW - (ev.clientX - startX)));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }
</script>

<div class="divider" role="separator" aria-orientation="vertical" onpointerdown={startResize}></div>
<aside class="preview" style:width="{width}px" aria-label={t('preview.title')}>
  <header>
    <span>{t('preview.title')}</span>
    <button onclick={() => (ws.mdPreview = false)} title={t('preview.close')} aria-label={t('preview.close')}>×</button>
  </header>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="body" bind:this={body} onclick={onClick}></div>
</aside>

<style>
  .divider {
    width: 5px;
    margin-inline: -2px;
    cursor: col-resize;
    z-index: 1;
    flex-shrink: 0;
    border-inline-start: 1px solid var(--border);
  }
  .preview {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex-shrink: 0;
    background: var(--ed-bg);
    color: var(--fg);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    padding-inline: 12px 4px;
    font-size: 12px;
    color: var(--fg-muted);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  header button {
    width: 24px;
    height: 22px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-size: 16px;
    cursor: pointer;
  }
  header button:hover {
    background: var(--surface-3);
    color: var(--fg);
  }
  .body {
    flex: 1;
    overflow: auto;
    padding: 16px 24px 48px;
    font-family: 'Segoe UI', 'Noto Sans Hebrew', Arial, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .body :global(h1),
  .body :global(h2) {
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.25em;
  }
  .body :global(a) {
    color: var(--accent);
  }
  .body :global(code) {
    font-family: var(--ed-font);
    font-size: 0.9em;
    background: var(--surface-2);
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  .body :global(pre) {
    background: var(--surface-2);
    padding: 12px;
    border-radius: 6px;
    overflow: auto;
  }
  .body :global(pre code) {
    background: none;
    padding: 0;
  }
  .body :global(blockquote) {
    margin-inline: 0;
    padding-inline-start: 12px;
    border-inline-start: 3px solid var(--border);
    color: var(--fg-muted);
  }
  .body :global(table) {
    border-collapse: collapse;
  }
  .body :global(td),
  .body :global(th) {
    border: 1px solid var(--border);
    padding: 4px 8px;
  }
  .body :global(img) {
    max-width: 100%;
  }
</style>
