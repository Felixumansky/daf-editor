use daf_core::recent::RecentItem;
use daf_core::settings::Settings;
use daf_core::{DafError, ErrorCode};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, State};

use super::DocMeta;
use crate::events::SETTINGS_CHANGED;
use crate::state::AppState;

type CmdResult<T> = Result<T, DafError>;

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> CmdResult<Settings> {
    Ok(state.settings())
}

#[tauri::command]
pub async fn settings_update(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: Map<String, Value>,
) -> CmdResult<Settings> {
    let settings = state.settings.lock().unwrap().update(patch)?;
    crate::sync_autostart(&app, settings.launch_at_login);
    let _ = app.emit(SETTINGS_CHANGED, &settings);
    Ok(settings)
}

/// Open settings.json in the editor; saving it applies the changes live.
#[tauri::command]
pub async fn settings_open_file(state: State<'_, AppState>) -> CmdResult<DocMeta> {
    let path = state.dirs.settings_file();
    if !path.exists() {
        state.settings.lock().unwrap().update(Map::new())?;
    }
    state.grants.grant(&path);
    let results = super::file::file_open_paths(
        state,
        vec![crate::events::OpenRequest {
            path: path.to_string_lossy().into_owned(),
            line: None,
            col: None,
        }],
    )
    .await?;
    let first = results
        .into_iter()
        .next()
        .ok_or_else(|| DafError::new(ErrorCode::Io, "could not open settings"))?;
    match (first.meta, first.error) {
        (Some(m), _) => Ok(m),
        (None, Some(e)) => Err(e),
        _ => Err(DafError::new(ErrorCode::Io, "could not open settings")),
    }
}

#[tauri::command]
pub async fn recent_list(state: State<'_, AppState>) -> CmdResult<Vec<RecentItem>> {
    Ok(state.recent.lock().unwrap().items().to_vec())
}

#[tauri::command]
pub async fn recent_clear(state: State<'_, AppState>) -> CmdResult<()> {
    state.recent.lock().unwrap().clear()
}
