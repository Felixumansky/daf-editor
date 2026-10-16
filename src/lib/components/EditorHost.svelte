<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { ws } from '$lib/state/workspace.svelte';

  let host: HTMLDivElement;

  onMount(() => {
    const view = new EditorView({ parent: host });
    ws.attachView(view);

    // Ctrl+wheel zooms the editor font (not the UI).
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      ws.zoom(e.deltaY < 0 ? 1 : -1);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      host.removeEventListener('wheel', onWheel);
      view.destroy();
    };
  });
</script>

<div class="editor" bind:this={host} dir="ltr"></div>

<style>
  .editor {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--ed-bg);
  }
  .editor :global(.cm-editor) {
    flex: 1;
    min-height: 0;
  }
  .editor :global(.cm-editor.cm-focused) {
    outline: none;
  }
</style>
