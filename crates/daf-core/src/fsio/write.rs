//! Crash-safe saving: write a temp file next to the target, fsync, then atomically swap it in.
//! On Windows `ReplaceFileW` keeps the target's ACLs, attributes and creation time.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::read::{Fingerprint, mtime_ms};
use crate::error::Result;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveOutcome {
    Saved {
        fingerprint: Fingerprint,
    },
    /// The file changed on disk since we loaded it; nothing was written.
    Conflict {
        disk: Fingerprint,
    },
    ReadOnly,
}

/// Save `bytes` to `path`. When `expected` is given and `force` is false, refuse if the file on disk
/// no longer matches it (someone else changed it).
pub fn save_atomic(
    path: &Path,
    bytes: &[u8],
    expected: Option<&Fingerprint>,
    force: bool,
) -> Result<SaveOutcome> {
    // Write through symlinks to their target instead of replacing the link.
    let target: PathBuf = match std::fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => dunce::canonicalize(path)?,
        _ => path.to_path_buf(),
    };

    let existing = std::fs::metadata(&target).ok();
    if let Some(meta) = &existing {
        if meta.permissions().readonly() {
            return Ok(SaveOutcome::ReadOnly);
        }
        if let (Some(exp), false) = (expected, force)
            && !exp.same_stat(meta)
        {
            let disk = super::read::fingerprint(&target)?;
            if disk.hash != exp.hash {
                return Ok(SaveOutcome::Conflict { disk });
            }
        }
    }

    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut tmp = tempfile::Builder::new()
        .prefix(".daf-")
        .suffix(".tmp")
        .tempfile_in(dir)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;

    if existing.is_some() {
        let (file, tmp_path) = tmp.keep().map_err(|e| e.error)?;
        drop(file);
        if let Err(e) = replace(&target, &tmp_path) {
            // Network shares and some filesystems refuse the swap: fall back to an in-place write.
            tracing::warn!(
                "atomic replace failed for {}: {e}; writing in place",
                target.display()
            );
            let _ = std::fs::remove_file(&tmp_path);
            write_in_place(&target, bytes)?;
        }
    } else {
        tmp.persist(&target).map_err(|e| e.error)?;
    }

    let meta = std::fs::metadata(&target)?;
    Ok(SaveOutcome::Saved {
        fingerprint: Fingerprint {
            mtime_ms: mtime_ms(&meta),
            size: meta.len(),
            hash: xxhash_rust::xxh3::xxh3_64(bytes),
        },
    })
}

fn write_in_place(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(target)?;
    f.write_all(bytes)?;
    f.sync_all()
}

#[cfg(windows)]
fn replace(target: &Path, replacement: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{REPLACEFILE_IGNORE_MERGE_ERRORS, ReplaceFileW};
    let wide = |p: &Path| {
        p.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<u16>>()
    };
    let (t, r) = (wide(target), wide(replacement));
    // SAFETY: both buffers are NUL-terminated UTF-16 paths that outlive the call.
    let ok = unsafe {
        ReplaceFileW(
            t.as_ptr(),
            r.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_IGNORE_MERGE_ERRORS,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace(target: &Path, replacement: &Path) -> std::io::Result<()> {
    if let Ok(meta) = std::fs::metadata(target) {
        std::fs::set_permissions(replacement, meta.permissions())?;
    }
    std::fs::rename(replacement, target)
}

/// Atomically write a small app-owned file (session, settings, buffers).
pub fn write_small_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".daf-")
        .suffix(".tmp")
        .tempfile_in(dir)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| e.error)?;
    Ok(())
}
