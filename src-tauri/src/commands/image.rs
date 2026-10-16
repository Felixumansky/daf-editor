//! Pictures that live next to a document. A pasted screenshot is written to `<stem>.assets/`
//! beside the file, and the editor shows the images a document links to by relative path.
//! The UI still never names a file on its own: every path is resolved inside the document's
//! own folder, and only real image files (checked by their first bytes) are written or read.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use daf_core::{DafError, ErrorCode};
use serde::Serialize;
use tauri::State;
use tauri::ipc::{InvokeBody, Request, Response};

use super::file::header;
use crate::state::AppState;

type CmdResult<T> = Result<T, DafError>;

const MAX_IMAGE: u64 = 32 * 1024 * 1024;

/// The file extension for an image's bytes, or `None` if they are not a supported image.
fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(b"BM") {
        Some("bmp")
    } else {
        None
    }
}

/// `notes.md` keeps its pictures in `notes.assets`.
fn assets_dir_name(doc: &Path) -> String {
    let stem = doc
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    format!("{}.assets", if stem.is_empty() { "images" } else { &stem })
}

/// Keep only characters that are safe in a file name and in a Markdown link.
fn clean_stem(name: &str) -> String {
    let s: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    if s.is_empty() { "image".into() } else { s }
}

fn doc_dir(state: &AppState, doc_id: &str) -> CmdResult<(PathBuf, PathBuf)> {
    let path = state
        .with_doc(doc_id, |e| e.path.clone())?
        .ok_or_else(|| DafError::new(ErrorCode::Invalid, "untitled document: save it first"))?;
    let dir = path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| DafError::new(ErrorCode::Invalid, "the document has no folder"))?;
    Ok((path, dir))
}

#[derive(Debug, Serialize)]
pub struct SavedImage {
    /// Path relative to the document, with `/` separators, ready for a Markdown link.
    pub link: String,
}

/// Body: the image bytes. Headers: `x-daf-doc-id`, `x-daf-name` (a suggested file stem).
#[tauri::command]
pub async fn image_save(state: State<'_, AppState>, request: Request<'_>) -> CmdResult<SavedImage> {
    let doc_id = header(&request, "x-daf-doc-id")
        .ok_or_else(|| DafError::new(ErrorCode::Invalid, "missing x-daf-doc-id"))?;
    let stem = clean_stem(header(&request, "x-daf-name").unwrap_or_default());
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(DafError::new(
            ErrorCode::Invalid,
            "expected raw image bytes",
        ));
    };
    if bytes.len() as u64 > MAX_IMAGE {
        return Err(DafError::new(ErrorCode::TooLarge, "the image is too large"));
    }
    let ext = image_ext(bytes).ok_or_else(|| DafError::new(ErrorCode::Invalid, "not an image"))?;
    let (doc, dir) = doc_dir(&state, doc_id)?;
    let dir_name = assets_dir_name(&doc);
    let assets = dir.join(&dir_name);
    std::fs::create_dir_all(&assets)?;
    for n in 1..1000 {
        let file = if n == 1 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem}-{n}.{ext}")
        };
        let target = assets.join(&file);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(mut f) => {
                if let Err(e) = f.write_all(bytes).and_then(|()| f.sync_all()) {
                    drop(f);
                    let _ = std::fs::remove_file(&target);
                    return Err(e.into());
                }
                return Ok(SavedImage {
                    link: format!("{dir_name}/{file}"),
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(DafError::new(
        ErrorCode::Io,
        "too many images with the same name",
    ))
}

/// Resolve a link from the document's text to a file inside the document's folder.
/// Absolute paths, URLs and `..` are refused.
fn resolve_link(dir: &Path, src: &str) -> Option<PathBuf> {
    if src.is_empty() || src.contains(':') || src.starts_with(['/', '\\']) {
        return None;
    }
    let mut p = dir.to_path_buf();
    for part in src.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => return None,
            _ => p.push(part),
        }
    }
    // A symlink or junction may not lead outside the folder either.
    let real = dunce::canonicalize(&p).ok()?;
    let base = dunce::canonicalize(dir).ok()?;
    real.starts_with(&base).then_some(real)
}

/// The bytes of an image the document links to (`src` is the link, already percent-decoded).
#[tauri::command]
pub async fn image_read(
    state: State<'_, AppState>,
    doc_id: String,
    src: String,
) -> CmdResult<Response> {
    let (_, dir) = doc_dir(&state, &doc_id)?;
    let path = resolve_link(&dir, &src).ok_or_else(|| {
        DafError::new(
            ErrorCode::NotGranted,
            "the image is outside the document's folder",
        )
    })?;
    if std::fs::metadata(&path)?.len() > MAX_IMAGE {
        return Err(DafError::new(ErrorCode::TooLarge, "the image is too large"));
    }
    let bytes = std::fs::read(&path)?;
    if image_ext(&bytes).is_none() {
        return Err(DafError::new(ErrorCode::Invalid, "not an image"));
    }
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_images_by_bytes() {
        assert_eq!(image_ext(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(image_ext(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(image_ext(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(image_ext(b"<svg>"), None);
    }

    #[test]
    fn names() {
        assert_eq!(assets_dir_name(Path::new("C:/w/notes.md")), "notes.assets");
        assert_eq!(clean_stem("screenshot-2026 10/16"), "screenshot-20261016");
        assert_eq!(clean_stem("../"), "image");
    }

    #[test]
    fn links_stay_inside_the_folder() {
        let dir = std::env::temp_dir().join(format!("daf-img-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("a.assets")).unwrap();
        std::fs::write(dir.join("a.assets/x.png"), b"\x89PNG\r\n\x1a\n").unwrap();
        assert!(resolve_link(&dir, "a.assets/x.png").is_some());
        assert!(resolve_link(&dir, "./a.assets\\x.png").is_some());
        assert!(resolve_link(&dir, "../x.png").is_none());
        assert!(resolve_link(&dir, "C:/x.png").is_none());
        assert!(resolve_link(&dir, "/x.png").is_none());
        assert!(resolve_link(&dir, "https://e.com/x.png").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
