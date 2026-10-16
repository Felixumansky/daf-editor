//! Daf editor core.
//!
//! Everything here is pure Rust with no Tauri dependency, so it can be tested headless.
//! The Tauri shell (`src-tauri`) is a thin adapter over these modules.

pub mod dirs;
pub mod error;
pub mod fsio;
pub mod recent;
pub mod session;
pub mod settings;
pub mod text;

pub use error::{DafError, ErrorCode, Result};

/// Milliseconds since the Unix epoch.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// A new time-ordered document id.
pub fn new_doc_id() -> String {
    uuid::Uuid::now_v7().to_string()
}
