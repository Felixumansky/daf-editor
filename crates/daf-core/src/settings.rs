//! User settings: a JSONC file of flat dotted keys layered over built-in defaults.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::Result;
use crate::fsio::write_small_atomic;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// "auto" | "he" | "en"
    #[serde(rename = "ui.language")]
    pub ui_language: String,
    /// "auto" | "light" | "dark"
    #[serde(rename = "ui.theme")]
    pub ui_theme: String,
    #[serde(rename = "editor.fontFamily")]
    pub font_family: String,
    #[serde(rename = "editor.fontSize")]
    pub font_size: f32,
    /// Steps of 10% relative to the font size.
    #[serde(rename = "editor.zoom")]
    pub zoom: i32,
    #[serde(rename = "editor.wordWrap")]
    pub word_wrap: bool,
    #[serde(rename = "editor.tabSize")]
    pub tab_size: u32,
    #[serde(rename = "editor.insertSpaces")]
    pub insert_spaces: bool,
    #[serde(rename = "editor.lineNumbers")]
    pub line_numbers: bool,
    #[serde(rename = "editor.showWhitespace")]
    pub show_whitespace: bool,
    /// Pick each line's direction from its content (plain text and Markdown).
    #[serde(rename = "editor.rtl.autoDirection")]
    pub rtl_auto_direction: bool,
    /// "isolate" | "off": isolate RTL comments and strings inside left-to-right code.
    #[serde(rename = "editor.rtl.codeComments")]
    pub rtl_code_comments: String,
    /// "highlight" | "off": flag invisible bidi control characters (Trojan Source).
    #[serde(rename = "editor.bidiControls")]
    pub bidi_controls: String,
    /// Strip invisible direction marks and zero-width characters from pasted text.
    #[serde(rename = "editor.cleanPaste")]
    pub clean_paste: bool,
    /// In-file search ignores niqqud and final-letter forms.
    #[serde(rename = "search.ignoreNiqqud")]
    pub search_ignore_niqqud: bool,
    /// Encoding for new files and for pure-ASCII files.
    #[serde(rename = "files.defaultEncoding")]
    pub default_encoding: String,
    /// Country hint for guessing legacy encodings ("il" favours Windows-1255).
    #[serde(rename = "files.encodingHint")]
    pub encoding_hint: String,
    /// "auto" | "lf" | "crlf"
    #[serde(rename = "files.defaultEol")]
    pub default_eol: String,
    #[serde(rename = "files.largeThresholdMB")]
    pub large_threshold_mb: u64,
    #[serde(rename = "files.hugeThresholdMB")]
    pub huge_threshold_mb: u64,
    #[serde(rename = "files.reloadCleanOnExternalChange")]
    pub reload_clean_on_external_change: bool,
    #[serde(rename = "session.restore")]
    pub session_restore: bool,
    /// "notepad++" | "vscode"
    #[serde(rename = "keymap.preset")]
    pub keymap_preset: String,
    /// AI is off by default; nothing leaves the machine unless the user turns it on.
    #[serde(rename = "ai.enabled")]
    pub ai_enabled: bool,
    /// Start Daf when the user signs in (it reopens the last session's tabs).
    #[serde(rename = "startup.launchAtLogin")]
    pub launch_at_login: bool,
    /// The first-run "start with Windows?" question was answered.
    #[serde(rename = "startup.prompted")]
    pub startup_prompted: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ui_language: "en".into(),
            ui_theme: "auto".into(),
            // The two Plex faces ship with the app: the Hebrew one is drawn to match the mono Latin.
            font_family:
                "'IBM Plex Mono', 'IBM Plex Sans Hebrew', Cascadia Mono, Consolas, monospace".into(),
            font_size: 14.0,
            zoom: 0,
            word_wrap: false,
            tab_size: 4,
            insert_spaces: true,
            line_numbers: true,
            show_whitespace: false,
            rtl_auto_direction: true,
            rtl_code_comments: "isolate".into(),
            bidi_controls: "highlight".into(),
            clean_paste: true,
            search_ignore_niqqud: true,
            default_encoding: "utf-8".into(),
            encoding_hint: "il".into(),
            default_eol: "auto".into(),
            large_threshold_mb: 16,
            huge_threshold_mb: 64,
            reload_clean_on_external_change: true,
            session_restore: true,
            keymap_preset: "notepad++".into(),
            ai_enabled: false,
            launch_at_login: false,
            startup_prompted: false,
        }
    }
}

/// Holds only the keys the user changed; everything else comes from the defaults.
#[derive(Debug)]
pub struct SettingsStore {
    path: PathBuf,
    user: Map<String, Value>,
}

impl SettingsStore {
    pub fn load(path: &Path) -> Self {
        let user = std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&strip_jsonc(&s)).ok())
            .and_then(|v| match v {
                Value::Object(m) => Some(m),
                _ => None,
            })
            .unwrap_or_default();
        Self {
            path: path.to_path_buf(),
            user,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn effective(&self) -> Settings {
        let mut merged = match serde_json::to_value(Settings::default()) {
            Ok(Value::Object(m)) => m,
            _ => Map::new(),
        };
        for (k, v) in &self.user {
            merged.insert(k.clone(), v.clone());
        }
        // A bad value for one key must not reset all settings: drop keys that fail to parse.
        serde_json::from_value(Value::Object(merged.clone())).unwrap_or_else(|_| {
            let defaults = serde_json::to_value(Settings::default()).unwrap_or(Value::Null);
            let mut good = defaults.as_object().cloned().unwrap_or_default();
            for (k, v) in &self.user {
                let mut probe = good.clone();
                probe.insert(k.clone(), v.clone());
                if serde_json::from_value::<Settings>(Value::Object(probe.clone())).is_ok() {
                    good = probe;
                }
            }
            serde_json::from_value(Value::Object(good)).unwrap_or_default()
        })
    }

    /// Merge `patch` into the user's file. A `null` value resets a key to its default.
    pub fn update(&mut self, patch: Map<String, Value>) -> Result<Settings> {
        for (k, v) in patch {
            if v.is_null() {
                self.user.remove(&k);
            } else {
                self.user.insert(k, v);
            }
        }
        let mut doc = Map::new();
        doc.insert(
            "$comment".into(),
            Value::String("Daf settings. Delete a key to restore its default.".into()),
        );
        for (k, v) in &self.user {
            if k != "$comment" {
                doc.insert(k.clone(), v.clone());
            }
        }
        write_small_atomic(
            &self.path,
            serde_json::to_string_pretty(&Value::Object(doc))?.as_bytes(),
        )?;
        Ok(self.effective())
    }

    /// Re-read the file after an external edit.
    pub fn reload(&mut self) -> Settings {
        *self = Self::load(&self.path);
        self.effective()
    }
}

/// Remove `//` and `/* */` comments and trailing commas, leaving strings intact.
pub fn strip_jsonc(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut chars = src.chars().peekable();
    let mut in_str = false;
    while let Some(c) = chars.next() {
        if in_str {
            out.push(c);
            match c {
                '\\' => {
                    if let Some(n) = chars.next() {
                        out.push(n);
                    }
                }
                '"' => in_str = false,
                _ => {}
            }
            continue;
        }
        match c {
            '"' => {
                in_str = true;
                out.push(c);
            }
            '/' if chars.peek() == Some(&'/') => {
                for n in chars.by_ref() {
                    if n == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut prev = '\0';
                for n in chars.by_ref() {
                    if prev == '*' && n == '/' {
                        break;
                    }
                    prev = n;
                }
            }
            ',' => {
                // Drop the comma if only whitespace separates it from a closing bracket.
                let rest: String = chars.clone().take_while(|c| c.is_whitespace()).collect();
                let next = chars.clone().nth(rest.chars().count());
                if !matches!(next, Some('}') | Some(']')) {
                    out.push(c);
                }
            }
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonc_is_stripped() {
        let src = "{\n // note\n \"a\": \"x // not a comment\", /* block */\n \"b\": [1, 2,],\n}";
        let v: Value = serde_json::from_str(&strip_jsonc(src)).unwrap();
        assert_eq!(v["a"], "x // not a comment");
        assert_eq!(v["b"], serde_json::json!([1, 2]));
    }

    #[test]
    fn user_values_override_and_bad_values_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{ "editor.fontSize": 18, "editor.wordWrap": "yes" }"#,
        )
        .unwrap();
        let s = SettingsStore::load(&path).effective();
        assert_eq!(s.font_size, 18.0);
        assert!(!s.word_wrap);
    }

    #[test]
    fn update_persists_and_null_resets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut store = SettingsStore::load(&path);
        let patch = serde_json::json!({ "editor.zoom": 3 })
            .as_object()
            .unwrap()
            .clone();
        assert_eq!(store.update(patch).unwrap().zoom, 3);
        assert_eq!(SettingsStore::load(&path).effective().zoom, 3);
        let reset = serde_json::json!({ "editor.zoom": null })
            .as_object()
            .unwrap()
            .clone();
        assert_eq!(store.update(reset).unwrap().zoom, 0);
    }
}
