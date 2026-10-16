use std::collections::HashSet;

use daf_core::session::SessionMeta;
use daf_core::{DafError, ErrorCode};
use tauri::State;
use tauri::ipc::{InvokeBody, Request, Response};

use crate::state::AppState;

type CmdResult<T> = Result<T, DafError>;

#[tauri::command]
pub async fn session_put_meta(state: State<'_, AppState>, meta: SessionMeta) -> CmdResult<()> {
    state.session.save_meta(&meta)
}

/// Body: the unsaved text (UTF-8). Header: `x-daf-doc-id`.
#[tauri::command]
pub async fn session_put_buffer(state: State<'_, AppState>, request: Request<'_>) -> CmdResult<()> {
    let doc_id = request
        .headers()
        .get("x-daf-doc-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| DafError::new(ErrorCode::Invalid, "missing x-daf-doc-id"))?;
    match request.body() {
        InvokeBody::Raw(bytes) => state.session.put_buffer(doc_id, bytes),
        _ => Err(DafError::new(ErrorCode::Invalid, "expected a raw body")),
    }
}

#[tauri::command]
pub async fn session_get_buffer(state: State<'_, AppState>, doc_id: String) -> CmdResult<Response> {
    Ok(Response::new(
        state.session.get_buffer(&doc_id)?.unwrap_or_default(),
    ))
}

#[tauri::command]
pub async fn session_drop_buffer(state: State<'_, AppState>, doc_id: String) -> CmdResult<()> {
    state.session.drop_buffer(&doc_id)
}

/// Delete every buffer except those of the given (still open, dirty) docs.
#[tauri::command]
pub async fn session_prune(state: State<'_, AppState>, keep: Vec<String>) -> CmdResult<()> {
    state
        .session
        .prune_buffers(&keep.into_iter().collect::<HashSet<_>>())
}
