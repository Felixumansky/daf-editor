import { EditorView } from '@codemirror/view';

/**
 * Colors for @codemirror/merge, from the --diff-* tokens (CompareView defines them for both themes).
 * Color is never the only cue: the change gutter also shows "−" (left / removed) and "+" (right / added).
 */
const mark = (sign: string, color: string) => ({
  background: 'none',
  color: `var(${color})`,
  borderInlineStart: `3px solid var(${color})`,
  '&::before': { content: `"${sign}"`, fontWeight: '700' },
});

export const compareTheme = EditorView.theme({
  '.cm-changeGutter': { width: '1.4em', paddingLeft: '0', textAlign: 'center', fontFamily: 'var(--ed-font)' },

  // Left side (split) and deletions (unified): removed.
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': { backgroundColor: 'var(--diff-del-bg)' },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': { background: 'var(--diff-del-strong)', borderRadius: '2px' },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': mark('−', '--diff-del-mark'),

  // Right side (split) and the edited document (unified): added.
  '&:not(.cm-merge-a) .cm-changedLine, .cm-inlineChangedLine': { backgroundColor: 'var(--diff-ins-bg)' },
  '&:not(.cm-merge-a) .cm-changedText': { background: 'var(--diff-ins-strong)', borderRadius: '2px' },
  '&:not(.cm-merge-a) .cm-changedLineGutter, .cm-inlineChangedLineGutter': mark('+', '--diff-ins-mark'),
  '&.cm-merge-b .cm-deletedText': { background: 'var(--diff-del-strong)' },

  '.cm-deletedChunk': { paddingInlineStart: '6px', position: 'relative' },
  '.cm-deletedChunk .cm-chunkButtons': { insetInlineEnd: '8px', top: '2px', display: 'flex', gap: '4px', zIndex: '1' },
  '.cm-deletedChunk .cm-chunkButtons button': {
    font: '12px var(--ui-font)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer',
    border: '1px solid var(--border)', background: 'var(--surface-1)', color: 'var(--fg)',
  },
  '.cm-deletedChunk .cm-chunkButtons button:hover': { background: 'var(--surface-2)' },
  '.cm-deletedChunk .cm-chunkButtons button:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '1px' },

  '.cm-collapsedLines': {
    color: 'var(--fg-muted)', background: 'var(--surface-2)', fontFamily: 'var(--ui-font)', fontSize: '12px',
    padding: '4px 10px', borderBlock: '1px dashed var(--border)',
  },
  '.cm-collapsedLines:hover': { color: 'var(--fg)', background: 'var(--surface-3)' },
});
