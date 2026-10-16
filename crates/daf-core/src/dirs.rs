use std::path::{Path, PathBuf};

/// Where Daf keeps its files.
#[derive(Debug, Clone)]
pub struct AppDirs {
    /// Roaming config: settings.json, keybindings, macros.
    pub config: PathBuf,
    /// Local data: session, unsaved buffers, recent files, history.
    pub data: PathBuf,
    /// Disposable: logs.
    pub cache: PathBuf,
    pub portable: bool,
}

impl AppDirs {
    /// Portable mode: a `daf.portable` marker next to the executable puts everything under `<exe>/data`.
    pub fn resolve(exe_dir: Option<&Path>, config: PathBuf, data: PathBuf, cache: PathBuf) -> Self {
        if let Some(dir) = exe_dir
            && dir.join("daf.portable").exists()
        {
            let root = dir.join("data");
            return Self {
                config: root.join("config"),
                data: root.join("data"),
                cache: root.join("cache"),
                portable: true,
            };
        }
        Self {
            config,
            data,
            cache,
            portable: false,
        }
    }

    pub fn ensure(&self) -> std::io::Result<()> {
        for d in [
            &self.config,
            &self.data,
            &self.cache,
            &self.session_dir(),
            &self.buffers_dir(),
            &self.logs_dir(),
        ] {
            std::fs::create_dir_all(d)?;
        }
        Ok(())
    }

    pub fn settings_file(&self) -> PathBuf {
        self.config.join("settings.json")
    }
    pub fn session_dir(&self) -> PathBuf {
        self.data.join("session")
    }
    pub fn buffers_dir(&self) -> PathBuf {
        self.session_dir().join("buffers")
    }
    pub fn recent_file(&self) -> PathBuf {
        self.data.join("recent.json")
    }
    pub fn logs_dir(&self) -> PathBuf {
        self.cache.join("logs")
    }
}
