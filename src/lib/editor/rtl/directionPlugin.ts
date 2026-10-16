import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { firstStrongDir, type Dir } from './direction';

/**
 * - `auto`: each line gets `dir` from its first strong character (plain text, Markdown).
 * - `code`: every line stays left-to-right; RTL comments/strings are isolated separately.
 * - `rtl` / `ltr`: the user forced a direction for the whole document (Ctrl+Alt+R / Ctrl+Alt+L).
 */
export type DirectionMode = 'auto' | 'code' | 'rtl' | 'ltr';

const rtlLine = Decoration.line({ attributes: { dir: 'rtl' } });
const ltrLine = Decoration.line({ attributes: { dir: 'ltr' } });

/** How far above the viewport to look for a line that decides an empty line's direction. */
const LOOKBACK = 200;

function inheritedDir(view: EditorView, lineNo: number): Dir {
  const doc = view.state.doc;
  for (let n = lineNo - 1; n >= 1 && n >= lineNo - LOOKBACK; n--) {
    const d = firstStrongDir(doc.line(n).text);
    if (d) return d;
  }
  return 'ltr';
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  let lastLine = 0;
  let prev: Dir | null = null;
  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from);
    if (prev === null || line.number !== lastLine + 1) prev = inheritedDir(view, line.number);
    for (;;) {
      if (line.number > lastLine) {
        const dir: Dir = firstStrongDir(line.text) ?? prev;
        // Lines are left-to-right by default; only mark the exceptions (and LTR lines that follow
        // RTL ones, so CodeMirror's per-line direction lookup sees an explicit value).
        builder.add(line.from, line.from, dir === 'rtl' ? rtlLine : ltrLine);
        prev = dir;
        lastLine = line.number;
      }
      if (line.to >= to || line.number >= doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

const autoDirection = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** The direction extension for a mode. Swap it through a compartment when the mode changes. */
export function directionExtension(mode: DirectionMode): Extension {
  switch (mode) {
    case 'auto':
      // perLineTextDirection makes cursor motion and selection follow each line's `dir`.
      return [EditorView.perLineTextDirection.of(true), autoDirection];
    case 'rtl':
      return EditorView.contentAttributes.of({ dir: 'rtl' });
    case 'ltr':
    case 'code':
      return [];
  }
}
