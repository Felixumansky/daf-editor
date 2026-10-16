use std::path::Path;
use std::sync::atomic::Ordering;

use daf_core::DafError;
use daf_core::recent::RecentItem;
use daf_core::session::LoadedSession;
use daf_core::settings::Settings;
use serde::Serialize;
use tauri::{AppHandle, State, WebviewWindow};

use crate::events::OpenRequest;
use crate::state::AppState;

type CmdResult<T> = Result<T, DafError>;

/// Everything the UI needs at boot, in one round trip.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Startup {
    pub version: String,
    pub platform: &'static str,
    pub locale: String,
    pub settings: Settings,
    pub settings_path: String,
    pub session: LoadedSession,
    pub pending_open: Vec<OpenRequest>,
    pub recent: Vec<RecentItem>,
    pub portable: bool,
}

#[tauri::command]
pub async fn app_ready(app: AppHandle, state: State<'_, AppState>) -> CmdResult<Startup> {
    let settings = state.settings();
    let session = if settings.session_restore {
        state.session.load()
    } else {
        LoadedSession::default()
    };
    if let Some(meta) = &session.meta {
        for tab in meta.tabs.iter().chain(&meta.closed_tabs) {
            if let Some(p) = &tab.path {
                state.grants.grant(Path::new(p));
            }
        }
    }
    let recent = state.recent.lock().unwrap().items().to_vec();
    for r in &recent {
        state.grants.grant(Path::new(&r.path));
    }
    let pending_open = std::mem::take(&mut *state.pending_open.lock().unwrap());
    Ok(Startup {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
        locale: state.locale.clone(),
        settings,
        settings_path: state.dirs.settings_file().to_string_lossy().into_owned(),
        session,
        pending_open,
        recent,
        portable: state.dirs.portable,
    })
}

/// The UI painted its first frame: show the window (it starts hidden to avoid a white flash).
#[tauri::command]
pub async fn app_shown(window: WebviewWindow, state: State<'_, AppState>) -> CmdResult<()> {
    if !state.shown.swap(true, Ordering::SeqCst) {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

/// The UI has persisted everything after a flush request; exit now.
#[tauri::command]
pub async fn app_quit_ready(app: AppHandle) -> CmdResult<()> {
    app.exit(0);
    Ok(())
}
