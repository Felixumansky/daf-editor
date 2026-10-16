/**
 * Every user action is a registered command. Menus, the palette, key bindings (and, later,
 * the macro recorder and "macro in words") all go through this one registry.
 */
import { bestScore } from '$lib/palette/fuzzy';
import { eventToChord, formatChord, presetBindings, type Preset } from './keybindings';

export type Category = 'file' | 'edit' | 'search' | 'view' | 'format' | 'help';

export interface Command {
  id: string;
  title: { he: string; en: string };
  category: Category;
  keywords?: string[];
  run: () => unknown;
  /** `editor`: only while the editor (not a dialog or input) has focus. Default `global`. */
  when?: 'editor' | 'global';
  /** Shown in the menu bar; commands sharing a `group` are separated from other groups. */
  menu?: boolean;
  group?: string;
  /** Safe to record into a macro (no file deletion, shell, network or settings changes). */
  macroSafe?: boolean;
  enabled?: () => boolean;
  checked?: () => boolean;
}

export const CATEGORY_TITLES: Record<Category, { he: string; en: string }> = {
  file: { he: 'קובץ', en: 'File' },
  edit: { he: 'עריכה', en: 'Edit' },
  search: { he: 'חיפוש', en: 'Search' },
  view: { he: 'תצוגה', en: 'View' },
  format: { he: 'קידוד', en: 'Encoding' },
  help: { he: 'עזרה', en: 'Help' },
};

class Registry {
  private commands = new Map<string, Command>();
  private bindings = new Map<string, string[]>();
  private byChord = new Map<string, string>();
  isMac = false;

  register(...cmds: Command[]) {
    for (const c of cmds) this.commands.set(c.id, c);
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  all(): Command[] {
    return [...this.commands.values()];
  }

  setPreset(preset: Preset, isMac: boolean) {
    this.isMac = isMac;
    this.bindings = presetBindings(preset, isMac);
    this.byChord.clear();
    for (const [id, chords] of this.bindings) for (const c of chords) this.byChord.set(c, id);
  }

  keysFor(id: string): string[] {
    return this.bindings.get(id) ?? [];
  }

  /** First binding, formatted for display. */
  keyLabel(id: string): string {
    const k = this.keysFor(id)[0];
    return k ? formatChord(k, this.isMac) : '';
  }

  /** The command bound to a key event, if any. */
  commandForEvent(e: KeyboardEvent): Command | undefined {
    const chord = eventToChord(e, this.isMac);
    const id = chord ? this.byChord.get(chord) : undefined;
    return id ? this.commands.get(id) : undefined;
  }

  run(id: string): boolean {
    const cmd = this.commands.get(id);
    if (!cmd || (cmd.enabled && !cmd.enabled())) return false;
    void Promise.resolve()
      .then(() => cmd.run())
      .catch((e) => console.error(`command ${id} failed`, e));
    return true;
  }

  /** Palette search: fuzzy over both languages' titles and keywords, boosted by recent use. */
  search(query: string, mru: string[]): Command[] {
    const cmds = this.all().filter((c) => !c.enabled || c.enabled());
    const recency = (id: string) => {
      const i = mru.indexOf(id);
      return i < 0 ? 0 : Math.max(0, 6 - i);
    };
    if (!query.trim()) {
      return cmds.sort((a, b) => recency(b.id) - recency(a.id) || a.title.en.localeCompare(b.title.en));
    }
    const scored: { c: Command; s: number }[] = [];
    for (const c of cmds) {
      const cat = CATEGORY_TITLES[c.category];
      const s = bestScore(query, [
        c.title.en, c.title.he, `${cat.en}: ${c.title.en}`, `${cat.he}: ${c.title.he}`, ...(c.keywords ?? []), c.id,
      ]);
      if (s > -Infinity) scored.push({ c, s: s + recency(c.id) * 0.5 });
    }
    return scored.sort((a, b) => b.s - a.s).map((x) => x.c);
  }
}

export const registry = new Registry();
