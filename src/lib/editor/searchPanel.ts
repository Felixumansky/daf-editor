/**
 * Daf's find/replace panel: CodeMirror's panel plus an "ignore niqqud" toggle.
 *
 * CodeMirror's SearchQuery has no hook for normalizing text, so a Hebrew literal search is run
 * as a generated regular expression (see hebrewSearch.ts). The user's own text and flags are
 * remembered next to each query, so the panel keeps showing what was typed, not the regex.
 */
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, runScopeHandlers, type Panel, type ViewUpdate } from '@codemirror/view';
import {
  SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext,
  search, selectMatches, setSearchQuery,
} from '@codemirror/search';

import { hasHebrew } from '$lib/palette/hebrew';
import { hebrewFoldRegex, literalReplacement, unquote } from '$lib/text/hebrewSearch';

interface QueryInfo {
  /** What the user typed. */
  search: string;
  replace: string;
  /** The user's regexp toggle (a folded query is a regexp even when this is off). */
  regexp: boolean;
  fold: boolean;
}

interface QuerySpec extends QueryInfo {
  caseSensitive: boolean;
  wholeWord: boolean;
}

const infos = new WeakMap<SearchQuery, QueryInfo>();

let foldDefault = () => true;
let onFoldChange: (on: boolean) => void = () => {};

/** Where the "ignore niqqud" default comes from and where a change is saved. */
export function configureHebrewSearch(opts: { get: () => boolean; set: (on: boolean) => void }) {
  foldDefault = opts.get;
  onFoldChange = opts.set;
}

function makeQuery(spec: QuerySpec): SearchQuery {
  const folded = spec.fold && !spec.regexp && hasHebrew(spec.search);
  const q = folded
    ? new SearchQuery({
        search: hebrewFoldRegex(unquote(spec.search)),
        replace: literalReplacement(spec.replace),
        regexp: true,
        caseSensitive: spec.caseSensitive,
        wholeWord: spec.wholeWord,
      })
    : new SearchQuery({ ...spec });
  infos.set(q, { search: spec.search, replace: spec.replace, regexp: spec.regexp, fold: spec.fold });
  return q;
}

function infoOf(q: SearchQuery): QueryInfo {
  return infos.get(q) ?? { search: q.search, replace: q.replace, regexp: q.regexp, fold: foldDefault() };
}

/**
 * Queries set by CodeMirror itself (Ctrl+F with a selection) inherit flags from the previous
 * query, including a folded query's internal `regexp: true`. Re-make them from the user's flags.
 */
const adoptForeignQueries = EditorState.transactionExtender.of((tr) => {
  for (const e of tr.effects) {
    if (!e.is(setSearchQuery) || infos.has(e.value)) continue;
    const prev = infos.get(getSearchQuery(tr.startState));
    const q = e.value;
    return {
      effects: setSearchQuery.of(
        makeQuery({
          search: q.search,
          replace: q.replace,
          regexp: prev ? prev.regexp : q.regexp,
          fold: prev ? prev.fold : foldDefault(),
          caseSensitive: q.caseSensitive,
          wholeWord: q.wholeWord,
        }),
      ),
    };
  }
  return null;
});

function elt<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (typeof v === 'boolean') (el as unknown as Record<string, boolean>)[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

class DafSearchPanel implements Panel {
  dom: HTMLElement;
  top = true;
  private query: SearchQuery;
  private searchField: HTMLInputElement;
  private replaceField: HTMLInputElement;
  private caseField: HTMLInputElement;
  private reField: HTMLInputElement;
  private wordField: HTMLInputElement;
  private foldField: HTMLInputElement;

  constructor(private view: EditorView) {
    const phrase = (p: string) => view.state.phrase(p);
    const commit = () => this.commit();
    const field = (name: string, label: string) =>
      elt('input', { class: 'cm-textfield', name, form: '', placeholder: label, 'aria-label': label, onchange: commit, onkeyup: commit });
    const check = (name: string) => elt('input', { type: 'checkbox', name, form: '', onchange: commit });
    const button = (name: string, onclick: () => void, label: string) =>
      elt('button', { class: 'cm-button', name, type: 'button', onclick }, [label]);

    this.searchField = field('search', phrase('Find'));
    this.searchField.setAttribute('main-field', 'true');
    this.replaceField = field('replace', phrase('Replace'));
    this.caseField = check('case');
    this.reField = check('re');
    this.wordField = check('word');
    this.foldField = elt('input', {
      type: 'checkbox', name: 'niqqud', form: '',
      onchange: () => {
        this.commit();
        onFoldChange(this.foldField.checked);
      },
    });

    this.dom = elt('div', { class: 'cm-search', onkeydown: (e) => this.keydown(e as KeyboardEvent) }, [
      this.searchField,
      button('next', () => findNext(view), phrase('next')),
      button('prev', () => findPrevious(view), phrase('previous')),
      button('select', () => selectMatches(view), phrase('all')),
      elt('label', {}, [this.caseField, phrase('match case')]),
      elt('label', {}, [this.reField, phrase('regexp')]),
      elt('label', {}, [this.wordField, phrase('by word')]),
      elt('label', { title: phrase('niqqud and final letters') }, [this.foldField, phrase('ignore niqqud')]),
      ...(view.state.readOnly
        ? []
        : [
            elt('br'),
            this.replaceField,
            button('replace', () => replaceNext(view), phrase('replace')),
            button('replaceAll', () => replaceAll(view), phrase('replace all')),
          ]),
      elt('button', { name: 'close', type: 'button', 'aria-label': phrase('close'), onclick: () => closeSearchPanel(view) }, ['×']),
    ]);

    this.query = getSearchQuery(view.state);
    this.show(this.query);
  }

  private commit() {
    const q = makeQuery({
      search: this.searchField.value,
      replace: this.replaceField.value,
      regexp: this.reField.checked,
      fold: this.foldField.checked,
      caseSensitive: this.caseField.checked,
      wholeWord: this.wordField.checked,
    });
    const cur = infoOf(this.query);
    const next = infoOf(q);
    const same =
      cur.search === next.search && cur.replace === next.replace && cur.regexp === next.regexp && cur.fold === next.fold &&
      this.query.caseSensitive === q.caseSensitive && this.query.wholeWord === q.wholeWord;
    if (same) return;
    this.query = q;
    this.view.dispatch({ effects: setSearchQuery.of(q) });
  }

  private keydown(e: KeyboardEvent) {
    if (runScopeHandlers(this.view, e, 'search-panel')) {
      e.preventDefault();
    } else if (e.key === 'Enter' && e.target === this.searchField) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(this.view);
    } else if (e.key === 'Enter' && e.target === this.replaceField) {
      e.preventDefault();
      replaceNext(this.view);
    }
  }

  update(u: ViewUpdate) {
    for (const tr of u.transactions)
      for (const e of tr.effects) if (e.is(setSearchQuery) && e.value !== this.query) this.show(e.value);
  }

  private show(q: SearchQuery) {
    this.query = q;
    const info = infoOf(q);
    this.searchField.value = info.search;
    this.replaceField.value = info.replace;
    this.caseField.checked = q.caseSensitive;
    this.reField.checked = info.regexp;
    this.wordField.checked = q.wholeWord;
    this.foldField.checked = info.fold;
  }

  mount() {
    this.searchField.select();
  }
}

/** Replaces `search({ top: true })`. */
export function dafSearch(): Extension {
  return [search({ top: true, createPanel: (view) => new DafSearchPanel(view) }), adoptForeignQueries];
}
