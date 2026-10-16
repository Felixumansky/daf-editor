import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/** One theme for light and dark: every color is a CSS variable defined in app.css. */
export const dafTheme = EditorView.theme({
  '&': { color: 'var(--ed-fg)', backgroundColor: 'var(--ed-bg)', height: '100%', fontSize: 'var(--ed-font-size)' },
  '.cm-scroller': { fontFamily: 'var(--ed-font)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--ed-caret)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ed-caret)', borderLeftWidth: '2px' },
  // CodeMirror draws the selection in a layer *behind* the text, so anything painted on the line
  // itself (the active-line highlight) must be translucent or it hides the selection.
  '.cm-selectionBackground': { backgroundColor: 'var(--ed-selection-blur)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--ed-selection)' },
  // drawSelection replaces the native selection; never paint both (they disagree in mixed-direction text).
  '.cm-content ::selection': { backgroundColor: 'transparent' },
  '.cm-activeLine': { backgroundColor: 'var(--ed-active-line)' },
  '.cm-gutters': { backgroundColor: 'var(--ed-gutter-bg)', color: 'var(--ed-gutter-fg)', border: 'none', borderInlineEnd: '1px solid var(--border)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--ed-active-line)', color: 'var(--ed-fg)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--fg-muted)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--ed-match)' },
  '.cm-searchMatch': { backgroundColor: 'var(--ed-search)', outline: '1px solid var(--accent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--ed-search-current)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--ed-match)', outline: '1px solid var(--fg-muted)' },
  '.cm-panels': { backgroundColor: 'var(--surface-1)', color: 'var(--fg)', borderColor: 'var(--border)' },
  '.cm-panel input, .cm-panel button, .cm-textfield, .cm-button': { font: 'inherit', fontSize: '13px' },
  '.cm-tooltip': { backgroundColor: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--fg)' },
  '.cm-specialChar': { color: 'var(--danger)' },
  '.cm-bidi-ctrl': {
    color: 'var(--danger)', backgroundColor: 'var(--danger-bg)', borderRadius: '3px',
    fontSize: '0.75em', padding: '0 2px', fontFamily: 'var(--ui-font)', verticalAlign: 'middle',
  },
  '.cm-bidi-mark': { color: 'var(--fg-muted)', fontSize: '0.75em', fontFamily: 'var(--ui-font)' },
  '.cm-highlightSpace': { backgroundImage: 'radial-gradient(circle at 50% 55%, var(--ed-whitespace) 15%, transparent 5%)' },
  '.cm-highlightTab': {
    backgroundImage: 'linear-gradient(to right, transparent 45%, var(--ed-whitespace) 45%, var(--ed-whitespace) 55%, transparent 55%)',
    backgroundSize: '100% 1px', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
  },
});

export const dafHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: 'var(--tok-keyword)' },
    { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--tok-string)' },
    { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--tok-number)' },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--tok-comment)', fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--tok-function)' },
    { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--tok-type)' },
    { tag: [t.propertyName, t.attributeName], color: 'var(--tok-property)' },
    { tag: [t.definition(t.variableName), t.labelName], color: 'var(--tok-definition)' },
    { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: 'var(--tok-punct)' },
    { tag: [t.meta, t.processingInstruction, t.annotation], color: 'var(--tok-meta)' },
    { tag: t.heading, color: 'var(--tok-keyword)', fontWeight: '700' },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.link, color: 'var(--tok-function)', textDecoration: 'underline' },
    { tag: [t.inserted], color: 'var(--tok-string)' },
    { tag: [t.deleted, t.invalid], color: 'var(--danger)' },
  ]),
);
