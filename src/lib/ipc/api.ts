/**
 * Typed wrappers over Daf's Tauri commands. Document text travels as raw UTF-8 bytes in both
 * directions (no JSON string escaping). The UI never sends a path to write to: it names documents
 * by `docId`, and Rust owns the paths.
 */
import { invoke } from '@tauri-apps/api/core';

export type Eol = 'lf' | 'crlf' | 'cr';
export type DocKind = 'text' | 'large' | 'huge' | 'binary';
export type Confidence = 'certain' | 'ascii' | 'guessed';

export interface Fingerprint {
  mtimeMs: number | null;
  size: number;
  hash: string;
}

export interface DocMeta {
  docId: string;
  path: string | null;
  name: string;
  encoding: string;
  bom: boolean;
  eol: Eol;
  eolMixed: boolean;
  kind: DocKind;
  readonly: boolean;
  lossy: boolean;
  confidence: Confidence;
  disk: Fingerprint | null;
}

export type ErrorCode =
  | 'NotFound' | 'PermissionDenied' | 'NotGranted' | 'Conflict' | 'Unmappable'
  | 'Binary' | 'TooLarge' | 'ReadOnly' | 'Io' | 'Invalid' | 'Cancelled';

export interface DafError {
  code: ErrorCode;
  message: string;
}

export function isDafError(e: unknown): e is DafError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}

export function errorMessage(e: unknown): string {
  if (isDafError(e)) return e.message;
  return e instanceof Error ? e.message : String(e);
}

export interface OpenRequest {
  path: string;
  line?: number | null;
  col?: number | null;
}

export interface OpenResult {
  path: string;
  line: number | null;
  col: number | null;
  meta: DocMeta | null;
  error: DafError | null;
}

export type SaveResult =
  | { status: 'saved'; meta: DocMeta }
  | { status: 'conflict'; disk: Fingerprint }
  | { status: 'readOnly' }
  | { status: 'unmappable'; count: number; firstLine: number; firstCol: number }
  | { status: 'lossy' }
  | { status: 'cancelled' };

export interface Settings {
  'ui.language': 'auto' | 'he' | 'en';
  'ui.theme': 'auto' | 'light' | 'dark';
  'editor.fontFamily': string;
  'editor.fontSize': number;
  'editor.zoom': number;
  'editor.wordWrap': boolean;
  'editor.tabSize': number;
  'editor.insertSpaces': boolean;
  'editor.lineNumbers': boolean;
  'editor.showWhitespace': boolean;
  'editor.rtl.autoDirection': boolean;
  'editor.rtl.codeComments': 'isolate' | 'off';
  'editor.bidiControls': 'highlight' | 'off';
  'editor.cleanPaste': boolean;
  'search.ignoreNiqqud': boolean;
  'files.defaultEncoding': string;
  'files.encodingHint': string;
  'files.defaultEol': 'auto' | 'lf' | 'crlf';
  'files.largeThresholdMB': number;
  'files.hugeThresholdMB': number;
  'files.reloadCleanOnExternalChange': boolean;
  'session.restore': boolean;
  'keymap.preset': 'notepad++' | 'vscode';
  'ai.enabled': boolean;
  'startup.launchAtLogin': boolean;
  'startup.prompted': boolean;
}

export interface Sel {
  anchor: number;
  head: number;
}

export interface TabMeta {
  docId: string;
  kind: 'file' | 'untitled';
  path: string | null;
  title: string;
  dirty: boolean;
  encoding: string;
  bom: boolean;
  eol: Eol;
  lang: string | null;
  disk: Fingerprint | null;
  sel: Sel[];
  scrollLine: number;
  wrap: boolean | null;
  dirOverride: 'rtl' | 'ltr' | null;
  pinned: boolean;
}

export interface SessionMeta {
  version: number;
  untitledCounter: number;
  window: null | { x: number; y: number; w: number; h: number; maximized: boolean };
  activeDocId: string | null;
  commandMru: string[];
  tabs: TabMeta[];
  closedTabs: TabMeta[];
}

export interface RecentItem {
  path: string;
  lastOpenedMs: number;
}

export interface Startup {
  version: string;
  homepage: string | null;
  platform: string;
  locale: string;
  settings: Settings;
  settingsPath: string;
  session: { meta: SessionMeta | null; orphans: string[]; usedBackup: boolean };
  pendingOpen: OpenRequest[];
  recent: RecentItem[];
  portable: boolean;
  /** Windows 11 Mica backdrop is on: the chrome may be see-through. */
  mica: boolean;
}

export interface RestoreResult {
  meta: DocMeta;
  diskChanged: boolean;
  missing: boolean;
}

export interface PickedText {
  path: string;
  name: string;
  text: string;
}

export interface DiskStatus {
  docId: string;
  changed: boolean;
  deleted: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

function bytesToText(buf: ArrayBuffer | Uint8Array | number[]): string {
  if (Array.isArray(buf)) return decoder.decode(new Uint8Array(buf));
  return decoder.decode(buf);
}

export const api = {
  appReady: () => invoke<Startup>('app_ready'),
  appShown: () => invoke<void>('app_shown'),
  appQuitReady: () => invoke<void>('app_quit_ready'),
  appOpenHomepage: () => invoke<void>('app_open_homepage'),
  /** Tell Windows where the title bar's maximize button is (for Snap Layouts). Zero size hides it. */
  windowSnapRect: (r: { x: number; y: number; w: number; h: number }) => invoke<void>('window_snap_rect', r),

  fileNew: () => invoke<DocMeta>('file_new'),
  fileOpenDialog: () => invoke<OpenResult[]>('file_open_dialog'),
  fileOpenPaths: (reqs: OpenRequest[]) => invoke<OpenResult[]>('file_open_paths', { reqs }),
  fileOpenBinary: (path: string) => invoke<DocMeta>('file_open_binary', { path }),
  fileReadText: async (docId: string) => bytesToText(await invoke<ArrayBuffer>('file_read_text', { docId })),
  filePeekDisk: async (docId: string) => bytesToText(await invoke<ArrayBuffer>('file_peek_disk', { docId })),
  filePickText: () => invoke<PickedText | null>('file_pick_text'),
  fileSave: (docId: string, text: string, force = false) =>
    invoke<SaveResult>('file_save', encoder.encode(text), {
      headers: { 'x-daf-doc-id': docId, 'x-daf-force': force ? '1' : '0' },
    }),
  fileSaveAs: (docId: string, text: string, suggestedName: string) =>
    invoke<SaveResult>('file_save_as', encoder.encode(text), {
      headers: { 'x-daf-doc-id': docId, 'x-daf-name': encodeURIComponent(suggestedName) },
    }),
  fileReopen: (docId: string, encoding: string) => invoke<DocMeta>('file_reopen', { docId, encoding }),
  fileReload: (docId: string) => invoke<DocMeta>('file_reload', { docId }),
  fileSetFormat: (docId: string, f: { encoding?: string; bom?: boolean; eol?: Eol }) =>
    invoke<DocMeta>('file_set_format', { docId, encoding: f.encoding ?? null, bom: f.bom ?? null, eol: f.eol ?? null }),
  fileCheckDisk: (docIds: string[]) => invoke<DiskStatus[]>('file_check_disk', { docIds }),
  fileClose: (docId: string) => invoke<void>('file_close', { docId }),
  fileReveal: (docId: string) => invoke<void>('file_reveal', { docId }),
  docRestore: (tab: TabMeta) => invoke<RestoreResult>('doc_restore', { tab }),

  /** Write an image into the document's `<stem>.assets/` folder; returns the link to insert. */
  imageSave: (docId: string, bytes: Uint8Array, name: string) =>
    invoke<{ link: string }>('image_save', bytes, { headers: { 'x-daf-doc-id': docId, 'x-daf-name': name } }),
  /** An image the document links to, resolved inside the document's folder. */
  imageRead: (docId: string, src: string) => invoke<ArrayBuffer>('image_read', { docId, src }),

  sessionPutMeta: (meta: SessionMeta) => invoke<void>('session_put_meta', { meta }),
  sessionPutBuffer: (docId: string, text: string) =>
    invoke<void>('session_put_buffer', encoder.encode(text), { headers: { 'x-daf-doc-id': docId } }),
  sessionGetBuffer: async (docId: string) => bytesToText(await invoke<ArrayBuffer>('session_get_buffer', { docId })),
  sessionDropBuffer: (docId: string) => invoke<void>('session_drop_buffer', { docId }),
  sessionPrune: (keep: string[]) => invoke<void>('session_prune', { keep }),

  settingsGet: () => invoke<Settings>('settings_get'),
  settingsUpdate: (patch: Partial<Record<keyof Settings, unknown>>) => invoke<Settings>('settings_update', { patch }),
  settingsOpenFile: () => invoke<DocMeta>('settings_open_file'),
  recentList: () => invoke<RecentItem[]>('recent_list'),
  recentClear: () => invoke<void>('recent_clear'),
};

export const EVENTS = {
  openFiles: 'daf://open-files',
  flushRequest: 'daf://flush-request',
  settingsChanged: 'daf://settings-changed',
} as const;
