//! Daf's Tauri shell: wires plugins, window events and IPC commands to `daf-core`.

mod cli;
mod commands;
mod events;
mod grants;
mod state;

use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;

use daf_core::dirs::AppDirs;
use tauri::{DragDropEvent, Emitter, Manager, WindowEvent};

use crate::events::{FLUSH_REQUEST, OPEN_FILES, OpenRequest};
use crate::state::AppState;

/// How long the UI gets to persist unsaved work when the window closes.
const FLUSH_TIMEOUT: Duration = Duration::from_millis(1500);
/// If the UI never reports its first paint (e.g. a script error), show the window anyway.
const SHOW_FALLBACK: Duration = Duration::from_secs(3);

fn deliver_open(app: &tauri::AppHandle, reqs: Vec<OpenRequest>) {
    if reqs.is_empty() {
        return;
    }
    let state = app.state::<AppState>();
    for r in &reqs {
        state.grants.grant(Path::new(&r.path));
    }
    let _ = app.emit(OPEN_FILES, reqs);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn init_logging(dirs: &AppDirs) {
    use tracing_subscriber::EnvFilter;
    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("daf")
        .filename_suffix("log")
        .max_log_files(5)
        .build(dirs.logs_dir());
    let filter = EnvFilter::try_from_env("DAF_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    match appender {
        Ok(a) => {
            let _ = tracing_subscriber::fmt()
                .with_env_filter(filter)
                .with_ansi(false)
                .with_writer(a)
                .try_init();
        }
        Err(_) => {
            let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
        }
    }
}

/// Passed when the OS starts Daf at sign-in.
const AUTOSTART_FLAG: &str = "--autostart";

/// Make the OS sign-in entry match the `startup.launchAtLogin` setting.
/// Development builds never register themselves (the entry would point at a debug binary).
pub(crate) fn sync_autostart(app: &tauri::AppHandle, want: bool) {
    use tauri_plugin_autostart::ManagerExt;
    if cfg!(debug_assertions) {
        tracing::info!(want, "development build: not changing the sign-in entry");
        return;
    }
    let manager = app.autolaunch();
    let result = match manager.is_enabled() {
        Ok(on) if on == want => Ok(()),
        _ if want => manager.enable(),
        _ => manager.disable(),
    };
    if let Err(e) = result {
        tracing::warn!("could not update the sign-in entry: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch hands its files to this instance and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            deliver_open(app, cli::parse(&argv, Path::new(&cwd)));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .setup(|app| {
            let paths = app.path();
            let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
            let dirs = AppDirs::resolve(exe_dir.as_deref(), paths.app_config_dir()?, paths.app_local_data_dir()?, paths.app_cache_dir()?);
            dirs.ensure()?;
            init_logging(&dirs);
            tracing::info!(version = %app.package_info().version, portable = dirs.portable, "Daf starting");

            let argv: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            app.manage(AppState::new(dirs, cli::parse(&argv, &cwd)));
            let launch_at_login = app.state::<AppState>().settings().launch_at_login;
            sync_autostart(app.handle(), launch_at_login);

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                let state = handle.state::<AppState>();
                if !state.shown.swap(true, Ordering::SeqCst)
                    && let Some(w) = handle.get_webview_window("main")
                {
                    tracing::warn!("UI did not report ready; showing window anyway");
                    let _ = w.show();
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                let app = window.app_handle().clone();
                let state = app.state::<AppState>();
                if !state.quitting.swap(true, Ordering::SeqCst) {
                    // Let the UI write unsaved buffers first; never block exit for long.
                    api.prevent_close();
                    let _ = app.emit(FLUSH_REQUEST, ());
                    std::thread::spawn(move || {
                        std::thread::sleep(FLUSH_TIMEOUT);
                        tracing::warn!("flush timed out; exiting");
                        app.exit(0);
                    });
                }
            }
            WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                let reqs = paths
                    .iter()
                    .filter(|p| p.is_file())
                    .map(|p| OpenRequest { path: p.to_string_lossy().into_owned(), line: None, col: None })
                    .collect();
                deliver_open(window.app_handle(), reqs);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_ready,
            commands::app::app_shown,
            commands::app::app_quit_ready,
            commands::file::file_new,
            commands::file::file_open_dialog,
            commands::file::file_open_paths,
            commands::file::file_open_binary,
            commands::file::file_read_text,
            commands::file::file_save,
            commands::file::file_save_as,
            commands::file::file_reopen,
            commands::file::file_reload,
            commands::file::file_set_format,
            commands::file::file_check_disk,
            commands::file::file_close,
            commands::file::file_reveal,
            commands::file::doc_restore,
            commands::session::session_put_meta,
            commands::session::session_put_buffer,
            commands::session::session_get_buffer,
            commands::session::session_drop_buffer,
            commands::session::session_prune,
            commands::settings::settings_get,
            commands::settings::settings_update,
            commands::settings::settings_open_file,
            commands::settings::recent_list,
            commands::settings::recent_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Daf");
}
