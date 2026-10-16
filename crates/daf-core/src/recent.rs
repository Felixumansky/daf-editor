use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::fsio::write_small_atomic;

const MAX_RECENT: usize = 30;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    pub path: String,
    pub last_opened_ms: i64,
}

/// Most-recently-used file list.
#[derive(Debug)]
pub struct RecentList {
    path: PathBuf,
    items: Vec<RecentItem>,
}

impl RecentList {
    pub fn load(path: &Path) -> Self {
        let items = std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Self {
            path: path.to_path_buf(),
            items,
        }
    }

    pub fn items(&self) -> &[RecentItem] {
        &self.items
    }

    pub fn touch(&mut self, file: &str) -> Result<()> {
        self.items.retain(|i| !same_path(&i.path, file));
        self.items.insert(
            0,
            RecentItem {
                path: file.to_string(),
                last_opened_ms: crate::now_ms(),
            },
        );
        self.items.truncate(MAX_RECENT);
        self.save()
    }

    pub fn clear(&mut self) -> Result<()> {
        self.items.clear();
        self.save()
    }

    fn save(&self) -> Result<()> {
        write_small_atomic(&self.path, &serde_json::to_vec_pretty(&self.items)?)
    }
}

/// Paths compare case-insensitively on Windows and macOS.
pub fn same_path(a: &str, b: &str) -> bool {
    if cfg!(any(windows, target_os = "macos")) {
        a.eq_ignore_ascii_case(b) || a.to_lowercase() == b.to_lowercase()
    } else {
        a == b
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mru_order_dedupe_and_cap() {
        let dir = tempfile::tempdir().unwrap();
        let mut list = RecentList::load(&dir.path().join("recent.json"));
        for i in 0..40 {
            list.touch(&format!("/f{i}")).unwrap();
        }
        list.touch("/f35").unwrap();
        assert_eq!(list.items().len(), MAX_RECENT);
        assert_eq!(list.items()[0].path, "/f35");
        assert_eq!(list.items().iter().filter(|i| i.path == "/f35").count(), 1);
        assert_eq!(
            RecentList::load(&dir.path().join("recent.json")).items()[0].path,
            "/f35"
        );
    }
}
