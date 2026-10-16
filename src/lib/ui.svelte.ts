/** Transient UI state: quick pick, modal dialog, toasts. */

export interface QuickPickItem {
  id: string;
  label: string;
  /** Secondary text (path, description). */
  detail?: string;
  /** Right-aligned hint (key binding). */
  hint?: string;
}

export interface QuickPickSpec {
  placeholder: string;
  /** Items to show for the current query (already filtered and sorted). Omit for free-text input. */
  items?: (query: string) => QuickPickItem[];
  /** Free-text validation; returns an error message or null. */
  validate?: (query: string) => string | null;
  emptyText?: string;
  initialQuery?: string;
  onAccept: (item: QuickPickItem | null, query: string) => void;
}

export interface DialogButton {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface DialogSpec {
  title: string;
  body?: string;
  buttons: DialogButton[];
  resolve: (id: string) => void;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

class Ui {
  quickPick = $state<QuickPickSpec | null>(null);
  dialog = $state<DialogSpec | null>(null);
  toasts = $state<Toast[]>([]);
  private nextToast = 1;

  openQuickPick(spec: QuickPickSpec) {
    this.quickPick = spec;
  }

  closeQuickPick() {
    this.quickPick = null;
  }

  /** Show a modal and resolve with the clicked button id ("cancel" on Escape). */
  confirm(spec: Omit<DialogSpec, 'resolve'>): Promise<string> {
    // A second dialog replaces the first; the first resolves as cancelled.
    this.dialog?.resolve('cancel');
    return new Promise((resolve) => {
      this.dialog = {
        ...spec,
        resolve: (id) => {
          this.dialog = null;
          resolve(id);
          // Give the keyboard back to the editor.
          requestAnimationFrame(() => document.querySelector<HTMLElement>('.cm-content')?.focus());
        },
      };
    });
  }

  toast(text: string, kind: Toast['kind'] = 'info', ms = 3500) {
    const id = this.nextToast++;
    this.toasts.push({ id, text, kind });
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    }, ms);
  }
}

export const ui = new Ui();
