/**
 * Pictures in text files. Pasting a screenshot (an image on the clipboard with no text) saves it
 * as a file in `<stem>.assets/` next to the document and inserts a Markdown link `![](...)` on its
 * own line. Every line with such a link shows its pictures right under it. The file stays plain
 * text, and other editors (GitHub, VS Code, Obsidian) show the same pictures.
 */
import { Facet, RangeSet, StateField, type EditorState, type Extension, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

import { api, errorMessage } from '$lib/ipc/api';

interface ImageHooks {
  /** Make sure the document has a file (Save As for untitled ones). */
  ensurePath: (docId: string) => Promise<boolean>;
  error: (message: string) => void;
  missing: (src: string) => string;
}

let hooks: ImageHooks = {
  ensurePath: async () => false,
  error: () => {},
  missing: (src) => src,
};

export function configureImages(h: ImageHooks) {
  hooks = h;
}

/** The document an editor shows; relative links resolve against its folder. */
const docIdFacet = Facet.define<string, string | null>({ combine: (v) => v[0] ?? null });

const LINK = /!\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+"[^"\n]*")?\s*\)/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The image sources a line links to (local files and `data:image/` URIs). */
export function imageLinks(line: string): string[] {
  if (!line.includes('![')) return [];
  const out: string[] = [];
  for (const m of line.matchAll(LINK)) {
    const src = localSource(m[1].startsWith('<') ? m[1].slice(1, -1) : m[1]);
    if (src) out.push(src);
  }
  return out;
}

/** A link's source if Daf can show it (a relative file or a `data:image/` URI), decoded. */
export function localSource(raw: string): string | null {
  if (raw.startsWith('data:image/')) return raw;
  if (!raw || SCHEME.test(raw) || raw.startsWith('/') || raw.startsWith('#')) return null;
  return decodeLink(raw);
}

function decodeLink(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}

/** Spaces and parentheses would end a Markdown link; everything else (Hebrew too) stays readable. */
export function encodeLink(path: string): string {
  return path.replace(/[ ()%]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

const urls = new Map<string, Promise<string>>();

/** A blob URL for an image the document links to, cached per document and link. */
export function imageUrl(docId: string, src: string): Promise<string> {
  if (src.startsWith('data:image/')) return Promise.resolve(src);
  const key = `${docId}\n${src}`;
  let p = urls.get(key);
  if (!p) {
    p = api.imageRead(docId, src).then((buf) => URL.createObjectURL(new Blob([buf])));
    // A missing picture may appear later; don't remember the failure.
    p.catch(() => urls.delete(key));
    urls.set(key, p);
  }
  return p;
}

class ImagesWidget extends WidgetType {
  constructor(
    readonly docId: string,
    readonly srcs: string[],
  ) {
    super();
  }

  eq(other: ImagesWidget) {
    return other.docId === this.docId && other.srcs.join('\n') === this.srcs.join('\n');
  }

  get estimatedHeight() {
    return 240;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-inlineImages';
    for (const src of this.srcs) {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.onload = () => {
        // Show screenshots at the size they had on screen.
        img.style.width = `${img.naturalWidth / window.devicePixelRatio}px`;
        view.requestMeasure();
      };
      wrap.append(img);
      imageUrl(this.docId, src).then(
        (url) => (img.src = url),
        () => {
          const chip = document.createElement('span');
          chip.className = 'cm-inlineImage-missing';
          chip.textContent = hooks.missing(src.startsWith('data:') ? 'data:' : src);
          img.replaceWith(chip);
          view.requestMeasure();
        },
      );
    }
    return wrap;
  }
}

/** Widgets for the image links on lines touching [from, to]. */
function scan(doc: Text, docId: string, from: number, to: number): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  for (let pos = doc.lineAt(from).from; pos <= to; ) {
    const line = doc.lineAt(pos);
    const srcs = imageLinks(line.text);
    if (srcs.length) {
      out.push(Decoration.widget({ widget: new ImagesWidget(docId, srcs), block: true, side: 1 }).range(line.to));
    }
    pos = line.to + 1;
  }
  return out;
}

function build(state: EditorState): DecorationSet {
  const docId = state.facet(docIdFacet);
  return docId ? RangeSet.of(scan(state.doc, docId, 0, state.doc.length)) : Decoration.none;
}

const imageField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    if (!tr.docChanged) return deco;
    const docId = tr.state.facet(docIdFacet);
    if (!docId) return Decoration.none;
    const doc = tr.state.doc;
    deco = deco.map(tr.changes);
    tr.changes.iterChangedRanges((_fa, _ta, fromB, toB) => {
      const from = doc.lineAt(fromB).from;
      const to = doc.lineAt(toB).to;
      deco = deco.update({ filterFrom: from, filterTo: to, filter: () => false, add: scan(doc, docId, from, to) });
    });
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `screenshot-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function pasteImage(view: EditorView, docId: string, file: File) {
  if (!(await hooks.ensurePath(docId))) return;
  let link: string;
  try {
    ({ link } = await api.imageSave(docId, new Uint8Array(await file.arrayBuffer()), stamp()));
  } catch (e) {
    hooks.error(errorMessage(e));
    return;
  }
  // The view is shared between tabs; the user may have switched away during Save As.
  if (view.state.facet(docIdFacet) !== docId) return;
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const before = from === doc.lineAt(from).from ? '' : '\n';
  const after = to === doc.lineAt(to).to ? '' : '\n';
  const insert = `${before}![](${encodeLink(link)})${after}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
    userEvent: 'input.paste.image',
  });
  view.focus();
}

const imagePaste = EditorView.domEventHandlers({
  paste(e, view) {
    const dt = e.clipboardData;
    const docId = view.state.facet(docIdFacet);
    if (!dt || !docId || view.state.readOnly || dt.getData('text/plain')) return false;
    const item = [...dt.items].find((it) => it.kind === 'file' && it.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!file) return false;
    e.preventDefault();
    void pasteImage(view, docId, file);
    return true;
  },
});

const imageTheme = EditorView.baseTheme({
  '.cm-inlineImages': { padding: '4px 18px 8px 8px', display: 'flex', flexWrap: 'wrap', gap: '8px' },
  '.cm-inlineImages img': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '4px',
    boxShadow: '0 0 0 1px var(--border)',
  },
  '.cm-inlineImage-missing': {
    fontFamily: 'var(--ui-font)',
    fontSize: '12px',
    color: 'var(--fg-muted)',
    padding: '2px 8px',
    borderRadius: '4px',
    border: '1px dashed var(--border)',
  },
});

/** Inline pictures and screenshot paste for one document. */
export function inlineImages(docId: string): Extension {
  return [docIdFacet.of(docId), imageField, imagePaste, imageTheme];
}
