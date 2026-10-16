import { highlightSpecialChars } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/** Embedding/override/isolate controls: can reorder code invisibly ("Trojan Source", CVE-2021-42574). */
const DANGEROUS: Record<number, string> = {
  0x202a: 'LRE', 0x202b: 'RLE', 0x202c: 'PDF', 0x202d: 'LRO', 0x202e: 'RLO',
  0x2066: 'LRI', 0x2067: 'RLI', 0x2068: 'FSI', 0x2069: 'PDI',
};
/** Harmless direction marks that Hebrew text legitimately uses; shown subtly. */
const MARKS: Record<number, string> = { 0x200e: 'LRM', 0x200f: 'RLM', 0x061c: 'ALM' };

function render(code: number, description: string | null, placeholder: string): HTMLElement {
  const span = document.createElement('span');
  const name = DANGEROUS[code] ?? MARKS[code];
  if (name) {
    span.className = DANGEROUS[code] ? 'cm-bidi-ctrl' : 'cm-bidi-mark';
    span.textContent = DANGEROUS[code] ? `⚠${name}` : name;
  } else {
    span.className = 'cm-specialChar';
    span.textContent = placeholder;
  }
  span.title = description ?? `\\u${code.toString(16).padStart(4, '0')}`;
  span.setAttribute('aria-label', span.title);
  return span;
}

/** Make invisible bidi controls visible. `highlight` flags them; `off` uses CodeMirror's defaults. */
export function bidiControls(mode: string): Extension {
  if (mode === 'off') return highlightSpecialChars();
  return highlightSpecialChars({
    addSpecialChars: /[‪-‮⁦-⁩‎‏؜]/,
    render,
  });
}
