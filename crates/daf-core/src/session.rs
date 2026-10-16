//! "Tabs that are never lost": the open-tab list plus every unsaved buffer, kept on disk at all times.
//!
//! Buffers are plain UTF-8 files named by doc id so a user can recover them by hand even if Daf
//! itself is broken. session.json keeps a `.bak` of the previous good version.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{DafError, ErrorCode, Result};
use crate::fsio::{Fingerprint, write_small_atomic};
use crate::text::Eol;

pub const SESSION_VERSION: u32 = 1;
const MAX_CLOSED: usize = 20;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SessionMeta {
    pub version: u32,
    pub untitled_counter: u32,
    pub window: Option<WindowState>,
    pub active_doc_id: Option<String>,
    pub command_mru: Vec<String>,
    pub tabs: Vec<TabMeta>,
    /// Recently closed file tabs, newest first (Ctrl+Shift+T).
    pub closed_tabs: Vec<TabMeta>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub maximized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TabMeta {
    pub doc_id: String,
    /// "file" | "untitled"
    pub kind: String,
    pub path: Option<String>,
    pub title: String,
    pub dirty: bool,
    pub encoding: String,
    pub bom: bool,
    pub eol: Eol,
    pub lang: Option<String>,
    /// The file as it was when last loaded/saved; detects edits made elsewhere while Daf was closed.
    pub disk: Option<Fingerprint>,
    pub sel: Vec<Sel>,
    pub scroll_line: u32,
    pub wrap: Option<bool>,
    /// "rtl" | "ltr" | null (automatic)
    pub dir_override: Option<String>,
    pub pinned: bool,
}

impl Default for TabMeta {
    fn default() -> Self {
        Self {
            doc_id: String::new(),
            kind: "untitled".into(),
            path: None,
            title: String::new(),
            dirty: false,
            encoding: "UTF-8".into(),
            bom: false,
            eol: Eol::platform_default(),
            lang: None,
            disk: None,
            sel: Vec::new(),
            scroll_line: 0,
            wrap: None,
            dir_override: None,
            pinned: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct Sel {
    pub anchor: u32,
    pub head: u32,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSession {
    pub meta: Option<SessionMeta>,
    /// Buffers on disk that no tab refers to (e.g. a crash between writes). Restored as "Recovered".
    pub orphans: Vec<String>,
    /// True when session.json was unreadable and the backup was used.
    pub used_backup: bool,
}

#[derive(Debug, Clone)]
pub struct SessionStore {
    dir: PathBuf,
}

impl SessionStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            dir: dir.to_path_buf(),
        }
    }

    fn meta_path(&self) -> PathBuf {
        self.dir.join("session.json")
    }
    fn backup_path(&self) -> PathBuf {
        self.dir.join("session.json.bak")
    }
    fn buffers_dir(&self) -> PathBuf {
        self.dir.join("buffers")
    }
    fn buffer_path(&self, doc_id: &str) -> Result<PathBuf> {
        // Doc ids are UUIDs; anything else could escape the buffers folder.
        if doc_id.is_empty()
            || doc_id.len() > 64
            || !doc_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
        {
            return Err(DafError::new(
                ErrorCode::Invalid,
                format!("bad doc id {doc_id:?}"),
            ));
        }
        Ok(self.buffers_dir().join(format!("{doc_id}.txt")))
    }

    pub fn load(&self) -> LoadedSession {
        let parse = |p: PathBuf| -> Option<SessionMeta> {
            let bytes = std::fs::read(p).ok()?;
            serde_json::from_slice::<SessionMeta>(&bytes).ok()
        };
        let (meta, used_backup) = match parse(self.meta_path()) {
            Some(m) => (Some(m), false),
            None => match parse(self.backup_path()) {
                Some(m) => (Some(m), true),
                None => (None, false),
            },
        };
        let known: HashSet<&str> = meta
            .iter()
            .flat_map(|m| m.tabs.iter().map(|t| t.doc_id.as_str()))
            .collect();
        let mut orphans: Vec<String> = std::fs::read_dir(self.buffers_dir())
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().into_string().ok()?;
                let id = name.strip_suffix(".txt")?;
                (!known.contains(id) && self.buffer_path(id).is_ok()).then(|| id.to_string())
            })
            .collect();
        orphans.sort();
        LoadedSession {
            meta,
            orphans,
            used_backup,
        }
    }

    pub fn save_meta(&self, meta: &SessionMeta) -> Result<()> {
        let mut meta = meta.clone();
        meta.version = SESSION_VERSION;
        meta.closed_tabs.truncate(MAX_CLOSED);
        let bytes = serde_json::to_vec_pretty(&meta)?;
        let path = self.meta_path();
        if path.exists() {
            // Keep the previous good copy; a torn write can then never lose the tab list.
            let _ = std::fs::copy(&path, self.backup_path());
        }
        write_small_atomic(&path, &bytes)
    }

    pub fn put_buffer(&self, doc_id: &str, utf8: &[u8]) -> Result<()> {
        write_small_atomic(&self.buffer_path(doc_id)?, utf8)
    }

    pub fn get_buffer(&self, doc_id: &str) -> Result<Option<Vec<u8>>> {
        match std::fs::read(self.buffer_path(doc_id)?) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn drop_buffer(&self, doc_id: &str) -> Result<()> {
        match std::fs::remove_file(self.buffer_path(doc_id)?) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    /// Delete buffers that no tab refers to any more (after the UI has adopted the orphans).
    pub fn prune_buffers(&self, keep: &HashSet<String>) -> Result<()> {
        for entry in std::fs::read_dir(self.buffers_dir())?.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(id) = name.strip_suffix(".txt")
                && !keep.contains(id)
            {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        Ok(())
    }
}
