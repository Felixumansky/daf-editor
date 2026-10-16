import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter,
  highlightWhitespace, keymap, lineNumbers, rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';

import { dafHighlight, dafTheme } from './theme';
import { directionExtension, type DirectionMode } from './rtl/directionPlugin';
import { commentIsolates } from './rtl/isolates';
import { bidiControls } from './rtl/bidiControls';
import { dafSearch } from './searchPanel';
import { cleanPaste } from './cleanPaste';
import { inlineImages } from './images';
import type { Sel } from '$lib/ipc/api';

/** Per-document settings that can change at runtime. Shared compartment objects work across states. */
export const comps = {
  language: new Compartment(),
  gutters: new Compartment(),
  wrap: new Compartment(),
  indent: new Compartment(),
  direction: new Compartment(),
  isolates: new Compartment(),
  whitespace: new Compartment(),
  readonly: new Compartment(),
  phrases: new Compartment(),
  bidi: new Compartment(),
  cleanPaste: new Compartment(),
};

export interface DocConfig {
  lineNumbers: boolean;
  wrap: boolean;
  tabSize: number;
  insertSpaces: boolean;
  showWhitespace: boolean;
  direction: DirectionMode;
  isolates: boolean;
  readonly: boolean;
  phrases: Record<string, string>;
  bidi: string;
  cleanPaste: boolean;
  /** Files above the "large" threshold skip features whose cost grows with the document. */
  large: boolean;
  /** The document this editor shows; enables inline pictures and screenshot paste. */
  docId?: string;
}

export const ext = {
  gutters: (on: boolean): Extension => (on ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : []),
  wrap: (on: boolean): Extension => (on ? EditorView.lineWrapping : []),
  indent: (size: number, spaces: boolean): Extension => [
    EditorState.tabSize.of(size),
    indentUnit.of(spaces ? ' '.repeat(size) : '\t'),
  ],
  isolates: (on: boolean): Extension => (on ? commentIsolates : []),
  whitespace: (on: boolean): Extension => (on ? highlightWhitespace() : []),
  readonly: (on: boolean): Extension => [EditorState.readOnly.of(on), EditorView.editable.of(!on)],
  phrases: (p: Record<string, string>): Extension => EditorState.phrases.of(p),
  cleanPaste: (on: boolean): Extension => (on ? cleanPaste : []),
};

/** CodeMirror's default keys, minus the ones Daf's command registry owns (it runs first anyway). */
const editorKeymap = keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]);

export function createEditorState(text: string, cfg: DocConfig, listener: Extension, sel?: Sel[]): EditorState {
  const extensions = editorExtensions(cfg, listener);
  let selection: EditorSelection | undefined;
  if (sel?.length) {
    const max = text.length;
    const clamp = (n: number) => Math.max(0, Math.min(max, n));
    selection = EditorSelection.create(sel.map((r) => EditorSelection.range(clamp(r.anchor), clamp(r.head))));
  }
  return EditorState.create({ doc: text, selection, extensions });
}

/** Everything a Daf editor has; also used by the compare view's editors. */
export function editorExtensions(cfg: DocConfig, listener: Extension): Extension[] {
  return [
    comps.gutters.of(ext.gutters(cfg.lineNumbers)),
    comps.bidi.of(bidiControls(cfg.bidi)),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    dafHighlight,
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    cfg.large ? [] : [bracketMatching(), highlightSelectionMatches()],
    dafSearch(),
    editorKeymap,
    dafTheme,
    comps.language.of([]),
    comps.wrap.of(ext.wrap(cfg.wrap && !cfg.large)),
    comps.indent.of(ext.indent(cfg.tabSize, cfg.insertSpaces)),
    comps.direction.of(directionExtension(cfg.direction)),
    comps.isolates.of(ext.isolates(cfg.isolates)),
    comps.whitespace.of(ext.whitespace(cfg.showWhitespace)),
    comps.readonly.of(ext.readonly(cfg.readonly)),
    comps.phrases.of(ext.phrases(cfg.phrases)),
    comps.cleanPaste.of(ext.cleanPaste(cfg.cleanPaste)),
    cfg.docId && !cfg.large ? inlineImages(cfg.docId) : [],
    listener,
  ];
}
