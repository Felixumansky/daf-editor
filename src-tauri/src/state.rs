use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;

use daf_core::dirs::AppDirs;
use daf_core::fsio::{Fingerprint, ReadOptions};
use daf_core::recent::RecentList;
use daf_core::session::SessionStore;
use daf_core::settings::{Settings, SettingsStore};
use daf_core::text::{DocKind, Eol, encoding};
use daf_core::{DafError, ErrorCode};
use encoding_rs::Encoding;

use crate::events::OpenRequest;
use crate::grants::Grants;

/// What Rust knows about an open document. The text itself lives in the editor.
pub struct DocEntry {
    pub path: Option<PathBuf>,
    pub encoding: &'static Encoding,
    pub bom: bool,
    pub eol: Eol,
    pub eol_mixed: bool,
    pub kind: DocKind,
    pub readonly: bool,
    /// The last read had invalid bytes; saving would silently change them.
    pub lossy: bool,
    pub confidence: daf_core::text::Confidence,
    /// The file as of the last load/save.
    pub fingerprint: Option<Fingerprint>,
    /// Text decoded during open, handed to the UI by the next `file_read_text`.
    pub pending_text: Option<String>,
}

pub struct AppState {
    pub dirs: AppDirs,
    pub docs: Mutex<HashMap<String, DocEntry>>,
    pub grants: Grants,
    pub settings: Mutex<SettingsStore>,
    pub session: SessionStore,
    pub recent: Mutex<RecentList>,
    /// Files requested before the UI was ready (command line).
    pub pending_open: Mutex<Vec<OpenRequest>>,
    pub shown: AtomicBool,
    pub quitting: AtomicBool,
    /// OS locale, e.g. "he-IL".
    pub locale: String,
}

impl AppState {
    pub fn new(dirs: AppDirs, pending_open: Vec<OpenRequest>) -> Self {
        let settings = SettingsStore::load(&dirs.settings_file());
        let recent = RecentList::load(&dirs.recent_file());
        let session = SessionStore::new(&dirs.session_dir());
        let grants = Grants::default();
        for r in &pending_open {
            grants.grant(std::path::Path::new(&r.path));
        }
        Self {
            dirs,
            docs: Mutex::new(HashMap::new()),
            grants,
            settings: Mutex::new(settings),
            session,
            recent: Mutex::new(recent),
            pending_open: Mutex::new(pending_open),
            shown: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
            locale: sys_locale::get_locale().unwrap_or_else(|| "en-US".into()),
        }
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().effective()
    }

    pub fn read_options(
        &self,
        force: Option<&'static Encoding>,
        allow_binary: bool,
    ) -> ReadOptions {
        let s = self.settings();
        ReadOptions {
            default_ascii: encoding::for_label(&s.default_encoding).unwrap_or(encoding_rs::UTF_8),
            tld_hint: (!s.encoding_hint.is_empty())
                .then(|| s.encoding_hint.to_ascii_lowercase().into_bytes()),
            force_encoding: force,
            default_eol: self.default_eol(),
            large_bytes: s.large_threshold_mb.max(1) << 20,
            huge_bytes: s.huge_threshold_mb.max(1) << 20,
            allow_binary,
        }
    }

    pub fn default_eol(&self) -> Eol {
        match self.settings().default_eol.as_str() {
            "lf" => Eol::Lf,
            "crlf" => Eol::Crlf,
            _ => Eol::platform_default(),
        }
    }

    pub fn with_doc<T>(
        &self,
        doc_id: &str,
        f: impl FnOnce(&mut DocEntry) -> T,
    ) -> Result<T, DafError> {
        let mut docs = self.docs.lock().unwrap();
        let entry = docs.get_mut(doc_id).ok_or_else(|| {
            DafError::new(ErrorCode::NotFound, format!("unknown document {doc_id}"))
        })?;
        Ok(f(entry))
    }
}
