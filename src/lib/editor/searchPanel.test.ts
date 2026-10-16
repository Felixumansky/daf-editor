import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { SearchQuery, getSearchQuery, setSearchQuery } from '@codemirror/search';
import { configureHebrewSearch, dafSearch } from './searchPanel';

function matches(state: EditorState): string[] {
  const out: string[] = [];
  const cur = getSearchQuery(state).getCursor(state);
  for (let r = cur.next(); !r.done; r = cur.next()) out.push(state.sliceDoc(r.value.from, r.value.to));
  return out;
}

describe('hebrew-aware search query', () => {
  const doc = 'אמר שָׁלוֹם, ענה שלום. a.b axb';
  const base = () => EditorState.create({ doc, extensions: dafSearch() });

  it('folds niqqud for a Hebrew literal search', () => {
    configureHebrewSearch({ get: () => true, set: () => {} });
    const st = base().update({ effects: setSearchQuery.of(new SearchQuery({ search: 'שלום' })) }).state;
    expect(matches(st)).toEqual(['שָׁלוֹם', 'שלום']);
  });

  it('leaves the search exact when the toggle is off', () => {
    configureHebrewSearch({ get: () => false, set: () => {} });
    const st = base().update({ effects: setSearchQuery.of(new SearchQuery({ search: 'שלום' })) }).state;
    expect(matches(st)).toEqual(['שלום']);
    configureHebrewSearch({ get: () => true, set: () => {} });
  });

  it("does not let a folded query's internal regexp flag leak into the next search", () => {
    let st = base().update({ effects: setSearchQuery.of(new SearchQuery({ search: 'שלום' })) }).state;
    // What CodeMirror's Ctrl+F does with a selection: copy the previous query's flags.
    const inherited = new SearchQuery({ search: 'a.b', regexp: getSearchQuery(st).regexp });
    st = st.update({ effects: setSearchQuery.of(inherited) }).state;
    expect(getSearchQuery(st).regexp).toBe(false);
    expect(matches(st)).toEqual(['a.b']);
  });
});
