import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { Prec } from '@codemirror/state';

/**
 * In left-to-right code, a Hebrew comment or string is its own bidi island: `dir=auto` on the span
 * keeps quotes, slashes and the surrounding code in place, and `bidiIsolatedRanges` tells
 * CodeMirror's cursor motion about it.
 */
const isolate = Decoration.mark({ attributes: { dir: 'auto' }, bidiIsolate: null });

const ISOLATED_NODE = /Comment|String|Character|Template/;
const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
/** Comment markers and quotes stay outside the isolate, so `// הערה` keeps `//` on the left. */
const LEADING = /^(?:\/\/+!?|\/\*+!?|#+|--|<!--|;+|[rRbBuUfF]{0,2}(?:"""|'''|["'`]))\s*/;
const TRAILING = /\s*(?:\*+\/|-->|"""|'''|["'`])$/;

/** The part of a comment/string node that holds its text, without markers or quotes. */
export function innerRange(text: string): { start: number; end: number } {
  const start = LEADING.exec(text)?.[0].length ?? 0;
  const tail = TRAILING.exec(text.slice(start));
  const end = tail ? text.length - tail[0].length : text.length;
  return { start, end: Math.max(start, end) };
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (!ISOLATED_NODE.test(node.name)) return;
        if (node.from < last || node.to <= node.from) return false;
        const text = view.state.doc.sliceString(node.from, node.to);
        if (!RTL_CHAR.test(text)) return false;
        const { start, end } = innerRange(text);
        if (end > start) {
          builder.add(node.from + start, node.from + end, isolate);
          last = node.to;
        }
        return false;
      },
    });
  }
  return builder.finish();
}

export const commentIsolates = ViewPlugin.fromClass(
  class {
    isolates: DecorationSet;
    constructor(view: EditorView) {
      this.isolates = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.isolates = build(u.view);
      }
    }
  },
  {
    provide: (plugin) => {
      const get = (view: EditorView) => view.plugin(plugin)?.isolates ?? Decoration.none;
      return [EditorView.decorations.of(get), Prec.lowest(EditorView.bidiIsolatedRanges.of(get))];
    },
  },
);
