import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/** One theme for light and dark: every color is a CSS variable defined in app.css. */
export const dafTheme = EditorView.theme({
  '&': { color: 'var(--ed-fg)', backgroundColor: 'var(--ed-bg)', height: '100%', fontSize: 'var(--ed-font-size)' },
  '.cm-scroller': { fontFamily: 'var(--ed-font)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--ed-caret)', padding: '10px 0 40px' },
  '.cm-line': { padding: '0 18px 0 8px' },
  // The amber caret is the signature detail from the app icon.
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ed-caret)', borderLeftWidth: '2px', borderRadius: '1px' },
  // CodeMirror draws the selection in a layer *behind* the text, so anything painted on the line
  // itself (the active-line highlight) must be translucent or it hides the selection.
  '.cm-selectionBackground': { backgroundColor: 'var(--ed-selection-blur)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--ed-selection)' },
  // drawSelection replaces the native selection; never paint both (they disagree in mixed-direction text).
  '.cm-content ::selection': { backgroundColor: 'transparent' },
  '.cm-activeLine': { backgroundColor: 'var(--ed-active-line)' },
  // The gutter is part of the page, not a separate column: no border, same background.
  '.cm-gutters': { backgroundColor: 'var(--ed-gutter-bg)', color: 'var(--ed-gutter-fg)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 18px', minWidth: '44px', fontVariantNumeric: 'tabular-nums' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--accent)', fontWeight: '600' },
  '.cm-lineNumbers .cm-activeLineGutter': { boxShadow: 'inset 2px 0 0 var(--accent)' },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--fg-subtle)', opacity: '0', transition: 'opacity var(--dur-2) var(--ease-out)', cursor: 'pointer' },
  '.cm-gutters:hover .cm-foldGutter .cm-gutterElement': { opacity: '1' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--accent-soft)', border: 'none', borderRadius: 'var(--r-xs)', color: 'var(--accent)', padding: '0 6px', margin: '0 2px',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--ed-match)' },
  '.cm-searchMatch': { backgroundColor: 'var(--ed-search)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--ed-search-current)', boxShadow: '0 0 0 1px var(--warn)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--ed-match)', outline: '1px solid var(--accent-ring)', borderRadius: '2px' },

  // Find/replace floats over the page as a glass card instead of pushing the text down.
  '.cm-panels': { backgroundColor: 'transparent', color: 'var(--fg)', border: 'none' },
  '.cm-panels.cm-panels-top': {
    position: 'absolute', top: '10px !important', left: 'auto', right: '20px', maxWidth: 'calc(100% - 40px)',
    borderRadius: 'var(--r-l)', border: 'none', background: 'var(--glass-bg)',
    backdropFilter: 'var(--glass-blur)', boxShadow: 'var(--glass-edge), var(--elev-2)', animation: 'daf-pop var(--dur-2) var(--ease-out)',
  },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)', backgroundColor: 'var(--surface-2)' },
  '.cm-panel': { fontFamily: 'var(--ui-font)', fontSize: '12.5px' },
  '.cm-panel.cm-search': { padding: '10px 40px 10px 12px', lineHeight: '2.2' },
  '.cm-panel input, .cm-panel button, .cm-textfield, .cm-button': { font: 'inherit', fontSize: '12.5px', verticalAlign: 'middle' },
  '.cm-textfield': {
    minWidth: '200px', padding: '4px 10px', margin: '0 4px 0 0', color: 'var(--fg)', backgroundColor: 'var(--surface-1)',
    border: '1px solid var(--border-strong)', borderRadius: 'var(--r-s)', outline: 'none',
    transition: 'border-color var(--dur-1), box-shadow var(--dur-1)',
  },
  '.cm-textfield:focus': { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-soft)' },
  '.cm-button': {
    padding: '4px 10px', margin: '0 2px', color: 'var(--fg)', backgroundImage: 'none', backgroundColor: 'var(--hover)',
    border: 'none', borderRadius: 'var(--r-s)', cursor: 'pointer', transition: 'background-color var(--dur-1)',
  },
  '.cm-button:hover': { backgroundColor: 'var(--pressed)' },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--accent-soft)' },
  '.cm-panel label': { color: 'var(--fg-muted)', fontSize: '12px', margin: '0 6px', whiteSpace: 'nowrap' },
  '.cm-panel input[type=checkbox]': { accentColor: 'var(--accent)', margin: '0 4px 0 0' },
  '.cm-panel.cm-search [name=close]': {
    position: 'absolute', top: '8px', right: '8px', width: '24px', height: '24px', padding: '0', border: 'none',
    borderRadius: 'var(--r-s)', background: 'transparent', color: 'var(--fg-muted)', fontSize: '16px', lineHeight: '1', cursor: 'pointer',
  },
  '.cm-panel.cm-search [name=close]:hover': { backgroundColor: 'var(--hover)', color: 'var(--fg)' },

  '.cm-tooltip': {
    backgroundColor: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', border: 'none', borderRadius: 'var(--r-m)',
    boxShadow: 'var(--glass-edge), var(--elev-2)', color: 'var(--fg)', overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--ed-font)', padding: '4px' },
  '.cm-tooltip-autocomplete > ul > li': { borderRadius: 'var(--r-xs)', padding: '2px 8px !important' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--fg)' },
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
