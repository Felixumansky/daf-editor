use serde::{Deserialize, Serialize};

/// Files to open, from a second instance, drag-and-drop or the command line.
pub const OPEN_FILES: &str = "daf://open-files";
/// The window is closing: the UI must persist everything, then call `app_quit_ready`.
pub const FLUSH_REQUEST: &str = "daf://flush-request";
pub const SETTINGS_CHANGED: &str = "daf://settings-changed";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenRequest {
    pub path: String,
    pub line: Option<u32>,
    pub col: Option<u32>,
}
