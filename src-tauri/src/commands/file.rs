use std::path::{Path, PathBuf};

use daf_core::fsio::{self, Fingerprint, LoadedDoc, SaveOutcome};
use daf_core::session::TabMeta;
use daf_core::text::{Confidence, DocKind, Eol, encoding, eol};
use daf_core::{DafError, ErrorCode};
use encoding_rs::Encoding;
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use super::{DocMeta, meta_of};
use crate::events::{OpenRequest, SETTINGS_CHANGED};
use crate::state::{AppState, DocEntry};

type CmdResult<T> = Result<T, DafError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    pub path: String,
    pub line: Option<u32>,
    pub col: Option<u32>,
    pub meta: Option<DocMeta>,
    pub error: Option<DafError>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveResult {
    Saved {
        meta: DocMeta,
    },
    /// Changed on disk since it was loaded. Nothing was written.
    Conflict {
        disk: Fingerprint,
    },
    ReadOnly,
    /// The encoding cannot represent some characters. Nothing was written.
    #[serde(rename_all = "camelCase")]
    Unmappable {
        count: usize,
        first_line: usize,
        first_col: usize,
    },
    /// The file was decoded with errors; saving would change those bytes. Nothing was written.
    Lossy,
    Cancelled,
}

fn entry_from_loaded(path: PathBuf, doc: LoadedDoc) -> DocEntry {
    DocEntry {
        path: Some(path),
        encoding: doc.encoding,
        bom: doc.bom,
        eol: doc.eol.eol,
        eol_mixed: doc.eol.mixed,
        kind: doc.kind,
        readonly: doc.readonly,
        lossy: doc.lossy,
        confidence: doc.confidence,
        fingerprint: Some(doc.fingerprint),
        pending_text: Some(doc.text),
    }
}

fn label_to_encoding(label: &str) -> CmdResult<&'static Encoding> {
    encoding::for_label(label)
        .ok_or_else(|| DafError::new(ErrorCode::Invalid, format!("unknown encoding {label}")))
}

/// Open a granted path as a new document.
fn open_granted(state: &AppState, path: &Path, allow_binary: bool) -> CmdResult<DocMeta> {
    let opts = state.read_options(None, allow_binary);
    let doc = fsio::read_doc(path, &opts)?;
    let doc_id = daf_core::new_doc_id();
    let entry = entry_from_loaded(path.to_path_buf(), doc);
    let meta = meta_of(&doc_id, &entry);
    state.docs.lock().unwrap().insert(doc_id, entry);
    if let Err(e) = state.recent.lock().unwrap().touch(&path.to_string_lossy()) {
        tracing::warn!("recent list: {e}");
    }
    Ok(meta)
}

fn open_many(state: &AppState, reqs: Vec<OpenRequest>) -> Vec<OpenResult> {
    reqs.into_iter()
        .map(|r| {
            let res = state
                .grants
                .check(Path::new(&r.path))
                .and_then(|p| open_granted(state, &p, false));
            let (meta, error) = match res {
                Ok(m) => (Some(m), None),
                Err(e) => (None, Some(e)),
            };
            OpenResult {
                path: r.path,
                line: r.line,
                col: r.col,
                meta,
                error,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn file_new(state: State<'_, AppState>) -> CmdResult<DocMeta> {
    let s = state.settings();
    let entry = DocEntry {
        path: None,
        encoding: encoding::for_label(&s.default_encoding).unwrap_or(encoding_rs::UTF_8),
        bom: false,
        eol: state.default_eol(),
        eol_mixed: false,
        kind: DocKind::Text,
        readonly: false,
        lossy: false,
        confidence: Confidence::Certain,
        fingerprint: None,
        pending_text: None,
    };
    let doc_id = daf_core::new_doc_id();
    let meta = meta_of(&doc_id, &entry);
    state.docs.lock().unwrap().insert(doc_id, entry);
    Ok(meta)
}

#[tauri::command]
pub async fn file_open_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<Vec<OpenResult>> {
    let Some(picked) = app.dialog().file().blocking_pick_files() else {
        return Ok(Vec::new());
    };
    let reqs = picked
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .map(|p| {
            state.grants.grant(&p);
            OpenRequest {
                path: p.to_string_lossy().into_owned(),
                line: None,
                col: None,
            }
        })
        .collect();
    Ok(open_many(&state, reqs))
}

#[tauri::command]
pub async fn file_open_paths(
    state: State<'_, AppState>,
    reqs: Vec<OpenRequest>,
) -> CmdResult<Vec<OpenResult>> {
    Ok(open_many(&state, reqs))
}

/// "Open anyway": a binary-looking file, read-only.
#[tauri::command]
pub async fn file_open_binary(state: State<'_, AppState>, path: String) -> CmdResult<DocMeta> {
    let p = state.grants.check(Path::new(&path))?;
    open_granted(&state, &p, true)
}

#[tauri::command]
pub async fn file_read_text(state: State<'_, AppState>, doc_id: String) -> CmdResult<Response> {
    let pending = state.with_doc(&doc_id, |e| e.pending_text.take())?;
    let text = match pending {
        Some(t) => t,
        None => {
            let (path, enc) = state.with_doc(&doc_id, |e| (e.path.clone(), e.encoding))?;
            let Some(path) = path else {
                return Ok(Response::new(Vec::new()));
            };
            let doc = fsio::read_doc(&path, &state.read_options(Some(enc), true))?;
            let text = doc.text.clone();
            state.with_doc(&doc_id, |e| {
                *e = DocEntry {
                    pending_text: None,
                    ..entry_from_loaded(path, doc)
                }
            })?;
            text
        }
    };
    Ok(Response::new(text.into_bytes()))
}

/// The file's current contents on disk, without touching the open document (its fingerprint
/// still drives "changed on disk" detection).
#[tauri::command]
pub async fn file_peek_disk(state: State<'_, AppState>, doc_id: String) -> CmdResult<Response> {
    let (path, enc) = state.with_doc(&doc_id, |e| (e.path.clone(), e.encoding))?;
    let Some(path) = path else {
        return Err(DafError::new(
            ErrorCode::NotFound,
            "the document has no file",
        ));
    };
    let doc = fsio::read_doc(&path, &state.read_options(Some(enc), true))?;
    Ok(Response::new(doc.text.into_bytes()))
}

#[derive(Debug, Serialize)]
pub struct PickedText {
    pub path: String,
    pub name: String,
    pub text: String,
}

/// Pick one file and return its text without opening it as a document (used by Compare).
#[tauri::command]
pub async fn file_pick_text(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<Option<PickedText>> {
    let Some(picked) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| DafError::new(ErrorCode::Invalid, e.to_string()))?;
    state.grants.grant(&path);
    let doc = fsio::read_doc(&path, &state.read_options(None, false))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(Some(PickedText {
        path: path.to_string_lossy().into_owned(),
        name,
        text: doc.text,
    }))
}

pub(super) fn header<'a>(request: &'a Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

fn body_text(request: &Request<'_>) -> CmdResult<String> {
    match request.body() {
        InvokeBody::Raw(bytes) => String::from_utf8(bytes.clone())
            .map_err(|_| DafError::new(ErrorCode::Invalid, "editor text must be UTF-8")),
        InvokeBody::Json(serde_json::Value::String(s)) => Ok(s.clone()),
        _ => Err(DafError::new(
            ErrorCode::Invalid,
            "expected a raw text body",
        )),
    }
}

fn save_to(
    app: &AppHandle,
    state: &AppState,
    doc_id: &str,
    text: &str,
    force: bool,
) -> CmdResult<SaveResult> {
    let (path, enc, bom, eol_style, expected, lossy) = state.with_doc(doc_id, |e| {
        (
            e.path.clone(),
            e.encoding,
            e.bom,
            e.eol,
            e.fingerprint,
            e.lossy,
        )
    })?;
    let Some(path) = path else {
        return Err(DafError::new(
            ErrorCode::Invalid,
            "untitled document: use Save As",
        ));
    };
    if lossy && !force {
        return Ok(SaveResult::Lossy);
    }
    let bytes = match encoding::encode(
        &eol::apply(text, eol_style),
        enc,
        bom && encoding::supports_bom(enc),
    ) {
        Ok(b) => b,
        Err(u) => {
            return Ok(SaveResult::Unmappable {
                count: u.count,
                first_line: u.first_line,
                first_col: u.first_col,
            });
        }
    };
    match fsio::save_atomic(&path, &bytes, expected.as_ref(), force)? {
        SaveOutcome::Saved { fingerprint } => {
            let meta = state.with_doc(doc_id, |e| {
                e.fingerprint = Some(fingerprint);
                e.lossy = false;
                e.readonly = false;
                e.eol_mixed = false;
                meta_of(doc_id, e)
            })?;
            if same_file(&path, &state.dirs.settings_file()) {
                let settings = state.settings.lock().unwrap().reload();
                crate::sync_autostart(app, settings.launch_at_login);
                let _ = app.emit(SETTINGS_CHANGED, settings);
            }
            Ok(SaveResult::Saved { meta })
        }
        SaveOutcome::Conflict { disk } => Ok(SaveResult::Conflict { disk }),
        SaveOutcome::ReadOnly => Ok(SaveResult::ReadOnly),
    }
}

fn same_file(a: &Path, b: &Path) -> bool {
    daf_core::recent::same_path(
        &dunce::simplified(a).to_string_lossy(),
        &dunce::simplified(b).to_string_lossy(),
    )
}

/// Body: the document text as UTF-8 with `\n` line endings. Headers: `x-daf-doc-id`, `x-daf-force`.
#[tauri::command]
pub async fn file_save(
    app: AppHandle,
    state: State<'_, AppState>,
    request: Request<'_>,
) -> CmdResult<SaveResult> {
    let doc_id = header(&request, "x-daf-doc-id")
        .ok_or_else(|| DafError::new(ErrorCode::Invalid, "missing x-daf-doc-id"))?
        .to_string();
    let force = header(&request, "x-daf-force") == Some("1");
    let text = body_text(&request)?;
    save_to(&app, &state, &doc_id, &text, force)
}

/// Same body and headers as `file_save`; Rust asks for the target path.
#[tauri::command]
pub async fn file_save_as(
    app: AppHandle,
    state: State<'_, AppState>,
    request: Request<'_>,
) -> CmdResult<SaveResult> {
    let doc_id = header(&request, "x-daf-doc-id")
        .ok_or_else(|| DafError::new(ErrorCode::Invalid, "missing x-daf-doc-id"))?
        .to_string();
    let suggested = header(&request, "x-daf-name")
        .map(percent_decode)
        .unwrap_or_default();
    let text = body_text(&request)?;
    let current = state.with_doc(&doc_id, |e| e.path.clone())?;

    let mut dialog = app.dialog().file();
    if let Some(dir) = current.as_ref().and_then(|p| p.parent()) {
        dialog = dialog.set_directory(dir);
    }
    let name = current
        .as_ref()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(if suggested.is_empty() {
            "untitled.txt".into()
        } else {
            suggested
        });
    let Some(target) = dialog
        .set_file_name(name)
        .blocking_save_file()
        .and_then(|f| f.into_path().ok())
    else {
        return Ok(SaveResult::Cancelled);
    };
    state.grants.grant(&target);
    state.with_doc(&doc_id, |e| {
        e.path = Some(target.clone());
        e.fingerprint = None;
        e.readonly = false;
    })?;
    let result = save_to(&app, &state, &doc_id, &text, true)?;
    if matches!(result, SaveResult::Saved { .. }) {
        let _ = state
            .recent
            .lock()
            .unwrap()
            .touch(&target.to_string_lossy());
    }
    Ok(result)
}

/// Header values are ASCII; the UI percent-encodes names.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16)
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Re-read the file with another encoding ("Reopen with encoding"). The UI then calls `file_read_text`.
#[tauri::command]
pub async fn file_reopen(
    state: State<'_, AppState>,
    doc_id: String,
    encoding: String,
) -> CmdResult<DocMeta> {
    let enc = label_to_encoding(&encoding)?;
    let path = state
        .with_doc(&doc_id, |e| e.path.clone())?
        .ok_or_else(|| {
            DafError::new(
                ErrorCode::Invalid,
                "untitled document has no file to reopen",
            )
        })?;
    let doc = fsio::read_doc(&path, &state.read_options(Some(enc), true))?;
    state.with_doc(&doc_id, |e| {
        *e = entry_from_loaded(path, doc);
        meta_of(&doc_id, e)
    })
}

/// Discard the editor's text and load the file from disk again with its current encoding.
#[tauri::command]
pub async fn file_reload(state: State<'_, AppState>, doc_id: String) -> CmdResult<DocMeta> {
    let (path, enc) = state.with_doc(&doc_id, |e| (e.path.clone(), e.encoding))?;
    let path = path.ok_or_else(|| DafError::new(ErrorCode::Invalid, "untitled document"))?;
    let doc = fsio::read_doc(&path, &state.read_options(Some(enc), true))?;
    state.with_doc(&doc_id, |e| {
        *e = entry_from_loaded(path, doc);
        meta_of(&doc_id, e)
    })
}

/// Change how the document will be written on the next save ("Convert to ...").
#[tauri::command]
pub async fn file_set_format(
    state: State<'_, AppState>,
    doc_id: String,
    encoding: Option<String>,
    bom: Option<bool>,
    eol: Option<Eol>,
) -> CmdResult<DocMeta> {
    let enc = encoding.as_deref().map(label_to_encoding).transpose()?;
    state.with_doc(&doc_id, |e| {
        if let Some(enc) = enc {
            e.encoding = enc;
            e.lossy = false;
            if !encoding::supports_bom(enc) {
                e.bom = false;
            }
        }
        if let Some(b) = bom {
            e.bom = b && encoding::supports_bom(e.encoding);
        }
        if let Some(style) = eol {
            e.eol = style;
            e.eol_mixed = false;
        }
        meta_of(&doc_id, e)
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskStatus {
    pub doc_id: String,
    pub changed: bool,
    pub deleted: bool,
}

/// Called when the window regains focus: which open files changed on disk?
#[tauri::command]
pub async fn file_check_disk(
    state: State<'_, AppState>,
    doc_ids: Vec<String>,
) -> CmdResult<Vec<DiskStatus>> {
    let targets: Vec<(String, PathBuf, Option<Fingerprint>)> = {
        let docs = state.docs.lock().unwrap();
        doc_ids
            .into_iter()
            .filter_map(|id| {
                let e = docs.get(&id)?;
                Some((id, e.path.clone()?, e.fingerprint))
            })
            .collect()
    };
    let mut out = Vec::new();
    for (doc_id, path, fp) in targets {
        let status = match std::fs::metadata(&path) {
            Err(_) => DiskStatus {
                doc_id,
                changed: false,
                deleted: fp.is_some(),
            },
            Ok(meta) => {
                let changed = match fp {
                    None => false,
                    Some(fp) if fp.same_stat(&meta) => false,
                    Some(fp) => fsio::fingerprint(&path)
                        .map(|d| d.hash != fp.hash)
                        .unwrap_or(false),
                };
                DiskStatus {
                    doc_id,
                    changed,
                    deleted: false,
                }
            }
        };
        if status.changed || status.deleted {
            out.push(status);
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn file_close(state: State<'_, AppState>, doc_id: String) -> CmdResult<()> {
    state.docs.lock().unwrap().remove(&doc_id);
    Ok(())
}

#[tauri::command]
pub async fn file_reveal(
    app: AppHandle,
    state: State<'_, AppState>,
    doc_id: String,
) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    if let Some(path) = state.with_doc(&doc_id, |e| e.path.clone())? {
        app.opener()
            .reveal_item_in_dir(&path)
            .map_err(|e| DafError::new(ErrorCode::Io, e.to_string()))?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub meta: DocMeta,
    /// The file changed on disk while the tab held unsaved edits.
    pub disk_changed: bool,
    /// The tab's file no longer exists.
    pub missing: bool,
}

/// Re-register a tab from the saved session under its old doc id.
/// Clean file tabs are re-read from disk; dirty tabs keep their buffer and old fingerprint
/// so that saving still detects edits made elsewhere.
#[tauri::command]
pub async fn doc_restore(state: State<'_, AppState>, tab: TabMeta) -> CmdResult<RestoreResult> {
    let enc = encoding::for_label(&tab.encoding).unwrap_or(encoding_rs::UTF_8);
    let blank = |path: Option<PathBuf>| DocEntry {
        path,
        encoding: enc,
        bom: tab.bom,
        eol: tab.eol,
        eol_mixed: false,
        kind: DocKind::Text,
        readonly: false,
        lossy: false,
        confidence: Confidence::Certain,
        fingerprint: tab.disk,
        pending_text: None,
    };
    let path = tab.path.as_ref().map(PathBuf::from);
    let (entry, disk_changed, missing) = match &path {
        None => (blank(None), false, false),
        Some(p) => {
            state.grants.grant(p);
            if !p.exists() {
                (blank(Some(p.clone())), false, true)
            } else if tab.dirty {
                let current = fsio::fingerprint(p).ok();
                let changed = matches!((current, tab.disk), (Some(c), Some(d)) if c.hash != d.hash);
                (blank(Some(p.clone())), changed, false)
            } else {
                match fsio::read_doc(p, &state.read_options(Some(enc), true)) {
                    Ok(doc) => (entry_from_loaded(p.clone(), doc), false, false),
                    Err(_) => (blank(Some(p.clone())), false, true),
                }
            }
        }
    };
    let meta = meta_of(&tab.doc_id, &entry);
    state.docs.lock().unwrap().insert(tab.doc_id.clone(), entry);
    Ok(RestoreResult {
        meta,
        disk_changed,
        missing,
    })
}
