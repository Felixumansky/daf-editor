import type { Extension } from '@codemirror/state';
import { StreamLanguage, type StreamParser } from '@codemirror/language';

/** A language Daf can highlight. Grammars load lazily so startup only pays for what is opened. */
export interface LangDef {
  id: string;
  label: string;
  extensions: string[];
  /** Exact file names (e.g. "Dockerfile"). */
  names?: string[];
  /** Prose languages get automatic per-line direction; code stays left-to-right. */
  prose?: boolean;
  load: () => Promise<Extension>;
}

const legacy = (p: Promise<StreamParser<unknown>>) => p.then((parser) => StreamLanguage.define(parser));

export const LANGUAGES: LangDef[] = [
  { id: 'plain', label: 'Plain Text', extensions: ['txt', 'text', 'log'], prose: true, load: async () => [] },
  { id: 'markdown', label: 'Markdown', extensions: ['md', 'markdown', 'mdx'], prose: true, load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()) },
  { id: 'javascript', label: 'JavaScript', extensions: ['js', 'mjs', 'cjs', 'jsx'], load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })) },
  { id: 'typescript', label: 'TypeScript', extensions: ['ts', 'mts', 'cts', 'tsx'], load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true, jsx: true })) },
  { id: 'json', label: 'JSON', extensions: ['json', 'jsonc', 'json5', 'webmanifest'], load: () => import('@codemirror/lang-json').then((m) => m.json()) },
  { id: 'html', label: 'HTML', extensions: ['html', 'htm', 'xhtml', 'svelte', 'vue'], load: () => import('@codemirror/lang-html').then((m) => m.html()) },
  { id: 'css', label: 'CSS', extensions: ['css', 'scss', 'less'], load: () => import('@codemirror/lang-css').then((m) => m.css()) },
  { id: 'xml', label: 'XML', extensions: ['xml', 'xsd', 'xsl', 'svg', 'csproj', 'props', 'resx', 'config'], load: () => import('@codemirror/lang-xml').then((m) => m.xml()) },
  { id: 'yaml', label: 'YAML', extensions: ['yaml', 'yml'], load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()) },
  { id: 'python', label: 'Python', extensions: ['py', 'pyw', 'pyi'], load: () => import('@codemirror/lang-python').then((m) => m.python()) },
  { id: 'rust', label: 'Rust', extensions: ['rs'], load: () => import('@codemirror/lang-rust').then((m) => m.rust()) },
  { id: 'cpp', label: 'C / C++', extensions: ['c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'hh', 'ino'], load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()) },
  { id: 'java', label: 'Java', extensions: ['java'], load: () => import('@codemirror/lang-java').then((m) => m.java()) },
  { id: 'php', label: 'PHP', extensions: ['php', 'phtml'], load: () => import('@codemirror/lang-php').then((m) => m.php()) },
  { id: 'sql', label: 'SQL', extensions: ['sql'], load: () => import('@codemirror/lang-sql').then((m) => m.sql()) },
  { id: 'csharp', label: 'C#', extensions: ['cs'], load: () => legacy(import('@codemirror/legacy-modes/mode/clike').then((m) => m.csharp as StreamParser<unknown>)) },
  { id: 'shell', label: 'Shell', extensions: ['sh', 'bash', 'zsh'], names: ['.bashrc', '.zshrc', '.profile'], load: () => legacy(import('@codemirror/legacy-modes/mode/shell').then((m) => m.shell as StreamParser<unknown>)) },
  { id: 'powershell', label: 'PowerShell', extensions: ['ps1', 'psm1', 'psd1'], load: () => legacy(import('@codemirror/legacy-modes/mode/powershell').then((m) => m.powerShell as StreamParser<unknown>)) },
  { id: 'ini', label: 'INI / Properties', extensions: ['ini', 'cfg', 'conf', 'properties', 'editorconfig', 'env'], names: ['.gitconfig', '.editorconfig'], load: () => legacy(import('@codemirror/legacy-modes/mode/properties').then((m) => m.properties as StreamParser<unknown>)) },
  { id: 'toml', label: 'TOML', extensions: ['toml'], load: () => legacy(import('@codemirror/legacy-modes/mode/toml').then((m) => m.toml as StreamParser<unknown>)) },
  { id: 'diff', label: 'Diff', extensions: ['diff', 'patch'], load: () => legacy(import('@codemirror/legacy-modes/mode/diff').then((m) => m.diff as StreamParser<unknown>)) },
  { id: 'dockerfile', label: 'Dockerfile', extensions: ['dockerfile'], names: ['Dockerfile', 'Containerfile'], load: () => legacy(import('@codemirror/legacy-modes/mode/dockerfile').then((m) => m.dockerFile as StreamParser<unknown>)) },
  { id: 'batch', label: 'Batch', extensions: ['bat', 'cmd'], load: async () => [] },
];

const byId = new Map(LANGUAGES.map((l) => [l.id, l]));

export function getLanguage(id: string | null | undefined): LangDef {
  return byId.get(id ?? 'plain') ?? byId.get('plain')!;
}

/** Pick a language from a file name. */
export function detectLanguage(fileName: string | null | undefined): string {
  if (!fileName) return 'plain';
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  for (const l of LANGUAGES) if (l.names?.includes(base)) return l.id;
  const dot = base.lastIndexOf('.');
  const ext = (dot >= 0 ? base.slice(dot + 1) : base).toLowerCase();
  for (const l of LANGUAGES) if (l.extensions.includes(ext)) return l.id;
  return 'plain';
}
