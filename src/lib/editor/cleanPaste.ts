/**
 * After a paste, remove the invisible characters Word and browsers drag along, as a separate
 * undo step: the paste lands exactly as copied, and Ctrl+Z right after brings the marks back.
 */
import { Transaction, type ChangeSpec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';

import { cleanEdits } from '$lib/text/clean';

let onCleaned: (removed: number) => void = () => {};

export function configureCleanPaste(fn: (removed: number) => void) {
  onCleaned = fn;
}

export const cleanPaste: Extension = EditorView.updateListener.of((u) => {
  if (u.transactions.length !== 1) return;
  const tr = u.transactions[0];
  if (!tr.docChanged || !tr.isUserEvent('input.paste')) return;
  const changes: ChangeSpec[] = [];
  tr.changes.iterChanges((_fa, _ta, fromB, toB) => {
    for (const e of cleanEdits(u.state.sliceDoc(fromB, toB))) {
      changes.push({ from: fromB + e.from, to: fromB + e.to, insert: e.insert });
    }
  });
  if (!changes.length) return;
  // A view can't be updated from inside its own update.
  queueMicrotask(() => {
    if (u.view.state !== u.state) return;
    u.view.dispatch({
      changes,
      annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.cleanPaste')],
    });
    onCleaned(changes.length);
  });
});
