import { EditorSelection, type ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  copyLineDown, deleteLine, indentLess, indentMore, moveLineDown, moveLineUp, redo, selectAll,
  toggleBlockComment, toggleComment, undo,
} from '@codemirror/commands';
import { findNext, findPrevious, openSearchPanel, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { foldAll, foldCode, unfoldAll, unfoldCode } from '@codemirror/language';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { registry, type Command } from './registry';
import { gotoLine, openPalette, pickEncoding, pickEol, pickLanguage, pickRecent, pickTab } from './pickers';
import { ws } from '$lib/state/workspace.svelte';
import { ui } from '$lib/ui.svelte';
import { i18n, t } from '$lib/i18n/index.svelte';
import { api } from '$lib/ipc/api';
import { compare } from '$lib/diff/compare.svelte';
import { fixLayout, wrongLayoutRunStart } from '$lib/text/layout';
import { MARKS } from '$lib/text/hebrewSearch';
import { CalcError, evaluate, formatResult } from '$lib/text/calc';

/** Run a CodeMirror command on the active editor. */
const cm = (fn: (v: EditorView) => boolean) => () => {
  const v = ws.view;
  if (!v) return;
  fn(v);
  v.focus();
};

function transformSelection(view: EditorView, fn: (s: string) => string): boolean {
  const st = view.state;
  view.dispatch(
    st.changeByRange((r) => {
      const range = r.empty ? (st.wordAt(r.head) ?? r) : r;
      const text = st.sliceDoc(range.from, range.to);
      const out = fn(text);
      return {
        changes: { from: range.from, to: range.to, insert: out },
        range: EditorSelection.range(range.from, range.from + out.length),
      };
    }),
  );
  return true;
}

/** Lines touched by the selection, or the whole document when nothing is selected. */
function selectedLineRange(view: EditorView): { from: number; to: number } {
  const st = view.state;
  const main = st.selection.main;
  if (main.empty && st.selection.ranges.length === 1) return { from: 1, to: st.doc.lines };
  return { from: st.doc.lineAt(main.from).number, to: st.doc.lineAt(main.to).number };
}

function joinLines(view: EditorView): boolean {
  const { doc } = view.state;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const first = doc.lineAt(r.from).number;
    let last = doc.lineAt(r.to).number;
    if (last === first) last = Math.min(first + 1, doc.lines);
    for (let n = first; n < last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = doc.line(n);
      const next = doc.line(n + 1);
      const lead = /^\s*/.exec(next.text)![0].length;
      changes.push({ from: line.to, to: next.from + lead, insert: line.text.length && next.text.length > lead ? ' ' : '' });
    }
  }
  if (changes.length) view.dispatch({ changes, scrollIntoView: true });
  return true;
}

function trimTrailing(view: EditorView): boolean {
  const { doc } = view.state;
  const { from, to } = selectedLineRange(view);
  const changes: ChangeSpec[] = [];
  for (let n = from; n <= to; n++) {
    const line = doc.line(n);
    const m = /[ \t]+$/.exec(line.text);
    if (m) changes.push({ from: line.from + m.index, to: line.to });
  }
  if (changes.length) view.dispatch({ changes });
  return true;
}

function sortLines(view: EditorView, desc: boolean): boolean {
  const { doc } = view.state;
  const { from, to } = selectedLineRange(view);
  const start = doc.line(from).from;
  const end = doc.line(to).to;
  const collator = new Intl.Collator([i18n.lang, 'he', 'en'], { numeric: true, sensitivity: 'base' });
  const lines = doc.sliceString(start, end).split('\n').sort(collator.compare);
  if (desc) lines.reverse();
  view.dispatch({ changes: { from: start, to: end, insert: lines.join('\n') } });
  return true;
}

function removeDuplicateLines(view: EditorView): boolean {
  const { doc } = view.state;
  const { from, to } = selectedLineRange(view);
  const start = doc.line(from).from;
  const end = doc.line(to).to;
  const seen = new Set<string>();
  const kept = doc.sliceString(start, end).split('\n').filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
  view.dispatch({ changes: { from: start, to: end, insert: kept.join('\n') } });
  return true;
}

function openReplace(view: EditorView): boolean {
  openSearchPanel(view);
  requestAnimationFrame(() => view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.focus());
  return true;
}

/** `raw`: skip the clean-paste pass (which listens for the "input.paste" user event). */
async function paste(raw = false) {
  const v = ws.view;
  if (!v) return;
  try {
    const text = await navigator.clipboard.readText();
    v.dispatch({ ...v.state.replaceSelection(text), userEvent: raw ? 'input.pasteRaw' : 'input.paste', scrollIntoView: true });
  } catch {
    document.execCommand('paste');
  }
  v.focus();
}

/** Fix text typed in the wrong keyboard layout: the selection, or the run typed just before the cursor. */
function fixKeyboardLayout(view: EditorView): boolean {
  const st = view.state;
  view.dispatch(
    st.changeByRange((r) => {
      let { from } = r;
      if (r.empty) {
        const line = st.doc.lineAt(r.head);
        from = line.from + wrongLayoutRunStart(line.text, r.head - line.from);
      }
      if (from === r.to) return { range: r };
      const out = fixLayout(st.sliceDoc(from, r.to));
      return { changes: { from, to: r.to, insert: out }, range: EditorSelection.range(from, from + out.length) };
    }),
  );
  return true;
}

const MARKS_RUN = new RegExp(`[${MARKS}]+`, 'gu');

/** Remove niqqud and cantillation from the selection, or from the whole document. */
function removeNiqqud(view: EditorView): boolean {
  const st = view.state;
  const ranges = st.selection.ranges.every((r) => r.empty) ? [{ from: 0, to: st.doc.length }] : st.selection.ranges;
  const changes: ChangeSpec[] = [];
  for (const r of ranges) {
    for (const m of st.sliceDoc(r.from, r.to).matchAll(MARKS_RUN)) {
      changes.push({ from: r.from + m.index, to: r.from + m.index + m[0].length });
    }
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'delete.niqqud' });
  return true;
}

/** The arithmetic right before a trailing "=" on a line: "total 12*3+4 =" → "12*3+4". */
const EXPR_BEFORE_EQ = /([\d.,+\-*/%^()×÷−–\s]*\d[\d.,+\-*/%^()×÷−–\s]*)=\s*$/;

/**
 * Calculate: a selection is replaced by its result, or gets the result after a trailing "=".
 * With no selection, a line ending in "=" gets the result appended.
 */
function evaluateSelection(view: EditorView): boolean {
  const st = view.state;
  const changes: ChangeSpec[] = [];
  /** Each result ends where `end` maps to (with forward association). */
  const results: { end: number; len: number }[] = [];
  try {
    for (const r of st.selection.ranges) {
      const text = r.empty ? st.doc.lineAt(r.head).text : st.sliceDoc(r.from, r.to);
      const m = EXPR_BEFORE_EQ.exec(text);
      if (r.empty && !m) continue;
      const result = formatResult(evaluate(m ? m[1] : text));
      if (m) {
        const at = r.empty ? st.doc.lineAt(r.head).to : r.to;
        changes.push({ from: at, insert: /\s$/.test(text) ? result : ' ' + result });
        results.push({ end: at, len: result.length });
      } else {
        changes.push({ from: r.from, to: r.to, insert: result });
        results.push({ end: r.to, len: result.length });
      }
    }
  } catch (e) {
    if (!(e instanceof CalcError)) throw e;
    ui.toast(t('toast.calcInvalid', { message: e.message }), 'error');
    return true;
  }
  if (!changes.length) {
    ui.toast(t('toast.calcNothing'));
    return true;
  }
  const changeSet = st.changes(changes);
  view.dispatch({
    changes: changeSet,
    selection: EditorSelection.create(
      results.map(({ end, len }) => {
        const to = changeSet.mapPos(end, 1);
        return EditorSelection.range(to - len, to);
      }),
    ),
    userEvent: 'input.calc',
  });
  return true;
}

function toggleMarkdownPreview() {
  if (!ws.mdPreview && ws.active?.lang !== 'markdown') {
    ui.toast(t('toast.notMarkdown'));
    return;
  }
  ws.mdPreview = !ws.mdPreview;
  ws.view?.focus();
}

const execCmd = (name: 'cut' | 'copy') => () => {
  ws.view?.focus();
  document.execCommand(name);
};

const T = (he: string, en: string) => ({ he, en });
const editorCmd = (c: Omit<Command, 'when' | 'macroSafe' | 'category'> & { category?: Command['category'] }): Command => ({
  category: 'edit',
  when: 'editor',
  macroSafe: true,
  menu: true,
  ...c,
});

export function registerBuiltinCommands() {
  registry.register(
    // ─── File
    { id: 'file.new', category: 'file', title: T('קובץ חדש', 'New File'), keywords: ['new', 'untitled', 'חדש'], menu: true, group: 'open', run: () => ws.newUntitled() },
    { id: 'file.open', category: 'file', title: T('פתח…', 'Open…'), keywords: ['open', 'פתיחה'], menu: true, group: 'open', run: () => ws.openDialog() },
    { id: 'file.openRecent', category: 'file', title: T('פתח קובץ אחרון…', 'Open Recent…'), keywords: ['recent', 'mru', 'אחרונים'], menu: true, group: 'open', run: pickRecent },
    { id: 'file.reopenClosed', category: 'file', title: T('פתח מחדש טאב שנסגר', 'Reopen Closed Tab'), keywords: ['undo close'], menu: true, group: 'open', run: () => ws.reopenClosed() },
    { id: 'file.save', category: 'file', title: T('שמור', 'Save'), keywords: ['save', 'שמירה'], menu: true, group: 'save', run: () => ws.save() },
    { id: 'file.saveAs', category: 'file', title: T('שמור בשם…', 'Save As…'), keywords: ['save as', 'שמירה בשם'], menu: true, group: 'save', run: () => ws.saveAs() },
    { id: 'file.saveAll', category: 'file', title: T('שמור הכל', 'Save All'), keywords: ['save all'], menu: true, group: 'save', run: () => ws.saveAll() },
    { id: 'file.reload', category: 'file', title: T('טען מחדש מהדיסק', 'Reload from Disk'), keywords: ['revert', 'refresh'], menu: true, group: 'save', enabled: () => ws.active?.kind === 'file', run: () => ws.reloadFromDisk() },
    { id: 'file.reveal', category: 'file', title: T('הצג בתיקייה', 'Reveal in File Explorer'), keywords: ['explorer', 'folder', 'finder', 'סייר'], menu: true, group: 'save', enabled: () => ws.active?.kind === 'file', run: () => ws.revealActive() },
    { id: 'compare.withTab', category: 'file', title: T('השווה עם טאב…', 'Compare with Tab…'), keywords: ['compare', 'diff', 'השוואה', 'הבדלים'], menu: true, group: 'compare', enabled: () => ws.canCompare(ws.active) && ws.tabs.length > 1, run: () => compare.pickTab() },
    { id: 'compare.withSaved', category: 'file', title: T('השווה עם הגרסה השמורה', 'Compare with Saved Version'), keywords: ['compare', 'diff', 'changes', 'השוואה', 'שינויים'], menu: true, group: 'compare', enabled: () => ws.canCompare(ws.active) && ws.active.kind === 'file', run: () => compare.withSaved() },
    { id: 'compare.withClipboard', category: 'file', title: T('השווה עם הלוח', 'Compare with Clipboard'), keywords: ['compare', 'diff', 'clipboard', 'השוואה', 'לוח'], menu: true, group: 'compare', enabled: () => ws.canCompare(ws.active), run: () => compare.withClipboard() },
    { id: 'compare.withFile', category: 'file', title: T('השווה עם קובץ…', 'Compare with File…'), keywords: ['compare', 'diff', 'השוואה'], menu: true, group: 'compare', enabled: () => ws.canCompare(ws.active), run: () => compare.withFile() },
    { id: 'compare.next', category: 'view', title: T('השוואה: השינוי הבא', 'Compare: Next Change'), keywords: ['diff'], enabled: () => compare.open, run: () => compare.controller?.next() },
    { id: 'compare.prev', category: 'view', title: T('השוואה: השינוי הקודם', 'Compare: Previous Change'), keywords: ['diff'], enabled: () => compare.open, run: () => compare.controller?.prev() },
    { id: 'compare.copyToRight', category: 'view', title: T('השוואה: העתק שינוי לימין', 'Compare: Copy Change to Right'), keywords: ['diff', 'merge', 'מיזוג'], enabled: () => compare.open, run: () => compare.controller?.copy('right') },
    { id: 'compare.copyToLeft', category: 'view', title: T('השוואה: העתק שינוי לשמאל', 'Compare: Copy Change to Left'), keywords: ['diff', 'merge', 'מיזוג'], enabled: () => compare.open, run: () => compare.controller?.copy('left') },
    { id: 'compare.swap', category: 'view', title: T('השוואה: החלף צדדים', 'Compare: Swap Sides'), keywords: ['diff'], enabled: () => compare.open, run: () => compare.swap() },
    { id: 'compare.toggleLayout', category: 'view', title: T('השוואה: זה לצד זה / מאוחד', 'Compare: Side by Side / Inline'), keywords: ['diff', 'unified', 'split'], enabled: () => compare.open, run: () => compare.setMode(compare.mode === 'split' ? 'unified' : 'split') },
    { id: 'compare.close', category: 'view', title: T('סגור השוואה', 'Close Compare'), keywords: ['diff'], enabled: () => compare.open, run: () => compare.close() },
    { id: 'file.close', category: 'file', title: T('סגור טאב', 'Close Tab'), keywords: ['close'], menu: true, group: 'close', run: () => ws.close() },
    { id: 'file.pinTab', category: 'file', title: T('הצמד טאב', 'Pin Tab'), keywords: ['pin', 'unpin', 'נעץ', 'נעיצה', 'הצמדה'], menu: true, group: 'close', checked: () => !!ws.active?.pinned, run: () => ws.togglePin() },
    { id: 'file.closeOthers', category: 'file', title: T('סגור את כל השאר', 'Close Other Tabs'), menu: true, group: 'close', run: () => ws.closeAll(ws.activeId ?? undefined) },
    { id: 'file.closeAll', category: 'file', title: T('סגור הכל', 'Close All Tabs'), menu: true, group: 'close', run: () => ws.closeAll() },
    { id: 'file.clearRecent', category: 'file', title: T('נקה רשימת קבצים אחרונים', 'Clear Recent Files'), run: async () => { await api.recentClear(); ws.recent = []; } },
    {
      id: 'file.launchAtLogin', category: 'file', title: T('פתח את דף בהפעלת המחשב', 'Open Daf When I Sign In'), keywords: ['startup', 'autostart', 'boot', 'login', 'הפעלה'], menu: true, group: 'settings',
      checked: () => ws.settings['startup.launchAtLogin'],
      run: () => ws.updateSettings({ 'startup.launchAtLogin': !ws.settings['startup.launchAtLogin'], 'startup.prompted': true }),
    },
    { id: 'file.settings', category: 'file', title: T('הגדרות (settings.json)', 'Settings (settings.json)'), keywords: ['preferences', 'config', 'העדפות'], menu: true, group: 'settings', run: () => ws.openSettings() },
    { id: 'file.exit', category: 'file', title: T('יציאה', 'Exit'), keywords: ['quit'], menu: true, group: 'exit', run: () => getCurrentWindow().close() },

    // ─── Edit
    editorCmd({ id: 'edit.undo', title: T('בטל', 'Undo'), group: 'undo', run: cm(undo) }),
    editorCmd({ id: 'edit.redo', title: T('בצע שוב', 'Redo'), group: 'undo', run: cm(redo) }),
    editorCmd({ id: 'edit.cut', title: T('גזור', 'Cut'), group: 'clip', run: execCmd('cut') }),
    editorCmd({ id: 'edit.copy', title: T('העתק', 'Copy'), group: 'clip', run: execCmd('copy') }),
    editorCmd({ id: 'edit.paste', title: T('הדבק', 'Paste'), group: 'clip', run: () => paste() }),
    editorCmd({ id: 'edit.pasteRaw', title: T('הדבק כמו שהוא (בלי ניקוי)', 'Paste As-Is (No Cleanup)'), keywords: ['paste raw', 'rlm', 'lrm', 'הדבקה', 'כיווניות'], group: 'clip', run: () => paste(true) }),
    editorCmd({ id: 'edit.selectAll', title: T('בחר הכל', 'Select All'), group: 'clip', run: cm(selectAll) }),
    editorCmd({ id: 'edit.duplicateLine', title: T('שכפל שורה', 'Duplicate Line'), keywords: ['copy line'], group: 'line', run: cm(copyLineDown) }),
    editorCmd({ id: 'edit.deleteLine', title: T('מחק שורה', 'Delete Line'), group: 'line', run: cm(deleteLine) }),
    editorCmd({ id: 'edit.moveLineUp', title: T('הזז שורה למעלה', 'Move Line Up'), group: 'line', run: cm(moveLineUp) }),
    editorCmd({ id: 'edit.moveLineDown', title: T('הזז שורה למטה', 'Move Line Down'), group: 'line', run: cm(moveLineDown) }),
    editorCmd({ id: 'edit.joinLines', title: T('חבר שורות', 'Join Lines'), group: 'line', run: cm(joinLines) }),
    editorCmd({ id: 'edit.indent', title: T('הגדל הזחה', 'Indent'), group: 'line', menu: false, run: cm(indentMore) }),
    editorCmd({ id: 'edit.outdent', title: T('הקטן הזחה', 'Outdent'), group: 'line', menu: false, run: cm(indentLess) }),
    editorCmd({ id: 'edit.toggleComment', title: T('הערה / ביטול הערה', 'Toggle Line Comment'), keywords: ['comment'], group: 'comment', run: cm(toggleComment) }),
    editorCmd({ id: 'edit.toggleBlockComment', title: T('הערת בלוק', 'Toggle Block Comment'), group: 'comment', run: cm(toggleBlockComment) }),
    editorCmd({ id: 'edit.upperCase', title: T('לאותיות גדולות', 'UPPERCASE'), keywords: ['case'], group: 'case', run: cm((v) => transformSelection(v, (s) => s.toUpperCase())) }),
    editorCmd({ id: 'edit.lowerCase', title: T('לאותיות קטנות', 'lowercase'), keywords: ['case'], group: 'case', run: cm((v) => transformSelection(v, (s) => s.toLowerCase())) }),
    editorCmd({ id: 'edit.trimTrailing', title: T('מחק רווחים בסוף שורות', 'Trim Trailing Whitespace'), keywords: ['trim', 'whitespace'], group: 'lines', run: cm(trimTrailing) }),
    editorCmd({ id: 'edit.sortAsc', title: T('מיין שורות (עולה)', 'Sort Lines Ascending'), keywords: ['sort'], group: 'lines', run: cm((v) => sortLines(v, false)) }),
    editorCmd({ id: 'edit.sortDesc', title: T('מיין שורות (יורד)', 'Sort Lines Descending'), keywords: ['sort'], group: 'lines', run: cm((v) => sortLines(v, true)) }),
    editorCmd({ id: 'edit.dedupe', title: T('הסר שורות כפולות', 'Remove Duplicate Lines'), keywords: ['unique', 'duplicate'], group: 'lines', run: cm(removeDuplicateLines) }),
    editorCmd({ id: 'edit.fixLayout', title: T('תקן שפת מקלדת (akuo ← שלום)', 'Fix Keyboard Layout (akuo → שלום)'), keywords: ['layout', 'keyboard', 'gibberish', 'wrong language', 'מקלדת', 'ג׳יבריש', 'שפה', 'akuo'], group: 'hebrew', run: cm(fixKeyboardLayout) }),
    editorCmd({ id: 'edit.stripNiqqud', title: T('הסר ניקוד', 'Remove Niqqud'), keywords: ['niqqud', 'nikud', 'vowels', 'diacritics', 'ניקוד', 'טעמים'], group: 'hebrew', run: cm(removeNiqqud) }),
    editorCmd({ id: 'edit.evaluate', title: T('חשב ביטוי (12*3= ← 36)', 'Calculate Expression (12*3= → 36)'), keywords: ['calc', 'calculator', 'math', 'evaluate', 'מחשבון', 'חישוב'], group: 'hebrew', run: cm(evaluateSelection) }),
    editorCmd({ id: 'edit.addNextOccurrence', title: T('הוסף סמן במופע הבא', 'Add Next Occurrence'), keywords: ['multi cursor', 'ריבוי סמנים'], group: 'multi', run: cm(selectNextOccurrence) }),
    editorCmd({ id: 'edit.selectAllOccurrences', title: T('בחר את כל המופעים', 'Select All Occurrences'), keywords: ['multi cursor'], group: 'multi', run: cm(selectSelectionMatches) }),

    // ─── Search
    editorCmd({ id: 'search.find', category: 'search', title: T('חיפוש…', 'Find…'), group: 'find', run: cm(openSearchPanel) }),
    editorCmd({ id: 'search.replace', category: 'search', title: T('החלפה…', 'Replace…'), group: 'find', run: cm(openReplace) }),
    editorCmd({ id: 'search.findNext', category: 'search', title: T('חפש הבא', 'Find Next'), group: 'find', run: cm(findNext) }),
    editorCmd({ id: 'search.findPrev', category: 'search', title: T('חפש הקודם', 'Find Previous'), group: 'find', run: cm(findPrevious) }),
    { id: 'search.gotoLine', category: 'search', title: T('מעבר לשורה…', 'Go to Line…'), keywords: ['goto', 'line', 'שורה'], menu: true, group: 'goto', run: gotoLine },

    // ─── View
    { id: 'view.palette', category: 'view', title: T('פלטת פקודות…', 'Command Palette…'), keywords: ['commands'], menu: true, group: 'palette', run: openPalette },
    { id: 'view.tabs', category: 'view', title: T('מעבר לטאב…', 'Go to Tab…'), keywords: ['switch', 'tabs'], menu: true, group: 'palette', run: pickTab },
    { id: 'view.nextTab', category: 'view', title: T('הטאב הבא', 'Next Tab'), group: 'palette', run: () => ws.cycleTab(1) },
    { id: 'view.prevTab', category: 'view', title: T('הטאב הקודם', 'Previous Tab'), group: 'palette', run: () => ws.cycleTab(-1) },
    { id: 'view.wordWrap', category: 'view', title: T('גלישת שורות', 'Word Wrap'), keywords: ['wrap'], menu: true, group: 'display', checked: () => ws.settings['editor.wordWrap'], run: () => ws.updateSettings({ 'editor.wordWrap': !ws.settings['editor.wordWrap'] }) },
    { id: 'view.lineNumbers', category: 'view', title: T('מספרי שורות', 'Line Numbers'), menu: true, group: 'display', checked: () => ws.settings['editor.lineNumbers'], run: () => ws.updateSettings({ 'editor.lineNumbers': !ws.settings['editor.lineNumbers'] }) },
    { id: 'view.whitespace', category: 'view', title: T('הצג רווחים וטאבים', 'Show Whitespace'), keywords: ['spaces', 'tabs'], menu: true, group: 'display', checked: () => ws.settings['editor.showWhitespace'], run: () => ws.updateSettings({ 'editor.showWhitespace': !ws.settings['editor.showWhitespace'] }) },
    { id: 'view.zoomIn', category: 'view', title: T('הגדל', 'Zoom In'), menu: true, group: 'zoom', run: () => ws.zoom(1) },
    { id: 'view.zoomOut', category: 'view', title: T('הקטן', 'Zoom Out'), menu: true, group: 'zoom', run: () => ws.zoom(-1) },
    { id: 'view.zoomReset', category: 'view', title: T('גודל רגיל', 'Reset Zoom'), menu: true, group: 'zoom', run: () => ws.zoom(null) },
    { id: 'view.dirRtl', category: 'view', title: T('כיוון: מימין לשמאל', 'Direction: Right to Left'), keywords: ['rtl', 'hebrew', 'עברית', 'כיוון'], menu: true, group: 'dir', checked: () => ws.active?.dirOverride === 'rtl', run: () => ws.setDirection('rtl') },
    { id: 'view.dirLtr', category: 'view', title: T('כיוון: משמאל לימין', 'Direction: Left to Right'), keywords: ['ltr', 'english', 'כיוון'], menu: true, group: 'dir', checked: () => ws.active?.dirOverride === 'ltr', run: () => ws.setDirection('ltr') },
    { id: 'view.dirAuto', category: 'view', title: T('כיוון: אוטומטי לפי שורה', 'Direction: Automatic per Line'), keywords: ['auto', 'bidi', 'כיוון'], menu: true, group: 'dir', checked: () => !ws.active?.dirOverride, run: () => ws.setDirection(null) },
    editorCmd({ id: 'view.foldAll', category: 'view', title: T('קפל הכל', 'Fold All'), group: 'fold', run: cm(foldAll) }),
    editorCmd({ id: 'view.unfoldAll', category: 'view', title: T('פתח הכל', 'Unfold All'), group: 'fold', run: cm(unfoldAll) }),
    editorCmd({ id: 'view.fold', category: 'view', title: T('קפל', 'Fold'), group: 'fold', menu: false, run: cm(foldCode) }),
    editorCmd({ id: 'view.unfold', category: 'view', title: T('פתח קיפול', 'Unfold'), group: 'fold', menu: false, run: cm(unfoldCode) }),
    { id: 'view.markdownPreview', category: 'view', title: T('תצוגה מקדימה ל-Markdown', 'Markdown Preview'), keywords: ['markdown', 'md', 'preview', 'render', 'תצוגה'], menu: true, group: 'display', checked: () => ws.mdPreview, run: toggleMarkdownPreview },
    {
      id: 'view.theme', category: 'view', title: T('ערכת נושא: בהיר / כהה / אוטומטי', 'Theme: Light / Dark / Auto'), keywords: ['dark', 'light', 'כהה', 'בהיר'], menu: true, group: 'ui',
      run: () => {
        const order = ['auto', 'light', 'dark'] as const;
        const next = order[(order.indexOf(ws.settings['ui.theme']) + 1) % order.length];
        return ws.updateSettings({ 'ui.theme': next });
      },
    },
    {
      id: 'view.uiLanguage', category: 'view', title: T('שפת ממשק: אנגלית / עברית', 'Interface Language: English / Hebrew'), keywords: ['language', 'hebrew', 'english', 'שפה'], menu: true, group: 'ui',
      checked: () => i18n.lang === 'he',
      run: () => ws.updateSettings({ 'ui.language': i18n.lang === 'he' ? 'en' : 'he' }),
    },
    {
      id: 'view.keymap', category: 'view', title: T('קיצורי מקלדת: Notepad++ / VS Code', 'Keyboard Shortcuts: Notepad++ / VS Code'), keywords: ['keymap', 'shortcuts', 'קיצורים'], menu: true, group: 'ui',
      run: () => ws.updateSettings({ 'keymap.preset': ws.settings['keymap.preset'] === 'vscode' ? 'notepad++' : 'vscode' }),
    },

    // ─── Encoding / format
    { id: 'format.reopenEncoding', category: 'format', title: T('פתח מחדש בקידוד…', 'Reopen with Encoding…'), keywords: ['encoding', 'charset', 'קידוד', 'ג׳יבריש', 'gibberish'], menu: true, group: 'enc', enabled: () => ws.active?.kind === 'file', run: () => pickEncoding('reopen') },
    { id: 'format.convertEncoding', category: 'format', title: T('המר לקידוד…', 'Convert to Encoding…'), keywords: ['encoding', 'utf-8', 'קידוד'], menu: true, group: 'enc', run: () => pickEncoding('convert') },
    { id: 'format.utf8', category: 'format', title: T('המר ל-UTF-8', 'Convert to UTF-8'), keywords: ['utf8'], menu: true, group: 'enc', run: () => ws.convert({ encoding: 'UTF-8', bom: false }) },
    { id: 'format.eol', category: 'format', title: T('סוף שורה…', 'Line Endings…'), keywords: ['eol', 'crlf', 'lf'], menu: true, group: 'eol', run: pickEol },
    { id: 'format.eolCrlf', category: 'format', title: T('המר ל-CRLF (Windows)', 'Convert to CRLF (Windows)'), keywords: ['eol'], menu: true, group: 'eol', checked: () => ws.active?.eol === 'crlf', run: () => ws.convert({ eol: 'crlf' }) },
    { id: 'format.eolLf', category: 'format', title: T('המר ל-LF (Unix)', 'Convert to LF (Unix)'), keywords: ['eol'], menu: true, group: 'eol', checked: () => ws.active?.eol === 'lf', run: () => ws.convert({ eol: 'lf' }) },
    { id: 'format.language', category: 'format', title: T('שפת תכנות…', 'Language Mode…'), keywords: ['syntax', 'highlight', 'צביעה'], menu: true, group: 'lang', run: pickLanguage },

    // ─── Help
    { id: 'help.about', category: 'help', title: T('אודות דף', 'About Daf'), menu: true, run: () => ui.openAbout() },
  );
}
