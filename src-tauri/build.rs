/// App commands are deny-by-default: each one must be granted in `capabilities/main.json`.
const COMMANDS: &[&str] = &[
    "app_ready",
    "app_shown",
    "app_quit_ready",
    "app_open_homepage",
    "window_snap_rect",
    "file_new",
    "file_open_dialog",
    "file_open_paths",
    "file_open_binary",
    "file_read_text",
    "file_peek_disk",
    "file_pick_text",
    "file_save",
    "file_save_as",
    "file_reopen",
    "file_reload",
    "file_set_format",
    "file_check_disk",
    "file_close",
    "file_reveal",
    "doc_restore",
    "image_save",
    "image_read",
    "session_put_meta",
    "session_put_buffer",
    "session_get_buffer",
    "session_drop_buffer",
    "session_prune",
    "settings_get",
    "settings_update",
    "settings_open_file",
    "recent_list",
    "recent_clear",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
