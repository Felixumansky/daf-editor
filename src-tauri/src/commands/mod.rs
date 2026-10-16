pub mod app;
pub mod file;
pub mod image;
pub mod session;
pub mod settings;

use daf_core::fsio::Fingerprint;
use daf_core::text::{Confidence, DocKind, Eol};
use serde::Serialize;

use crate::state::DocEntry;

/// The UI's view of a document (everything except its text).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocMeta {
    pub doc_id: String,
    pub path: Option<String>,
    pub name: String,
    /// WHATWG encoding name, e.g. "UTF-8", "windows-1255".
    pub encoding: String,
    pub bom: bool,
    pub eol: Eol,
    pub eol_mixed: bool,
    pub kind: DocKind,
    pub readonly: bool,
    pub lossy: bool,
    pub confidence: Confidence,
    pub disk: Option<Fingerprint>,
}

pub fn meta_of(doc_id: &str, e: &DocEntry) -> DocMeta {
    DocMeta {
        doc_id: doc_id.to_string(),
        path: e.path.as_ref().map(|p| p.to_string_lossy().into_owned()),
        name: e
            .path
            .as_ref()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        encoding: e.encoding.name().to_string(),
        bom: e.bom,
        eol: e.eol,
        eol_mixed: e.eol_mixed,
        kind: e.kind,
        readonly: e.readonly,
        lossy: e.lossy,
        confidence: e.confidence,
        disk: e.fingerprint,
    }
}
