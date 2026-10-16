//! Path grants: the webview may only name files the user handed to Daf (dialog, command line,
//! drag-and-drop, restored session, recent list). An XSS in the UI therefore cannot read or
//! overwrite arbitrary files.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use daf_core::{DafError, ErrorCode};

#[derive(Default)]
pub struct Grants {
    files: Mutex<HashSet<String>>,
}

fn key(path: &Path) -> String {
    let s = dunce::simplified(path).to_string_lossy().into_owned();
    if cfg!(any(windows, target_os = "macos")) {
        s.to_lowercase()
    } else {
        s
    }
}

/// Device and namespace paths are never valid documents.
fn is_device_path(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s.starts_with(r"\\.\") || s.starts_with(r"\\?\GLOBALROOT") || s.starts_with("//./")
}

impl Grants {
    pub fn grant(&self, path: &Path) {
        if !is_device_path(path) {
            self.files.lock().unwrap().insert(key(path));
        }
    }

    pub fn check(&self, path: &Path) -> Result<PathBuf, DafError> {
        if is_device_path(path) {
            return Err(DafError::new(
                ErrorCode::NotGranted,
                "device paths are not allowed",
            ));
        }
        if self.files.lock().unwrap().contains(&key(path)) {
            Ok(dunce::simplified(path).to_path_buf())
        } else {
            Err(DafError::new(
                ErrorCode::NotGranted,
                format!("{} was not opened through Daf", path.display()),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_granted_paths_pass() {
        let g = Grants::default();
        g.grant(Path::new("C:/work/a.txt"));
        assert!(g.check(Path::new("C:/work/a.txt")).is_ok());
        assert!(g.check(Path::new("C:/work/b.txt")).is_err());
        g.grant(Path::new(r"\\.\PhysicalDrive0"));
        assert!(g.check(Path::new(r"\\.\PhysicalDrive0")).is_err());
    }
}
