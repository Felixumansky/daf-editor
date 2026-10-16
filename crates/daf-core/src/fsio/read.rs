use std::path::Path;

use encoding_rs::{Encoding, WINDOWS_1252};
use serde::{Deserialize, Serialize};

use crate::error::{DafError, ErrorCode, Result};
use crate::text::{Confidence, DocKind, Eol, EolInfo, encoding, eol, sniff};

/// What a file looked like on disk when we last read or wrote it. Used to detect external changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    pub mtime_ms: Option<i64>,
    pub size: u64,
    /// xxh3 of the raw bytes, serialized as a string so JavaScript keeps all 64 bits.
    #[serde(with = "hash_str")]
    pub hash: u64,
}

impl Fingerprint {
    pub fn of_bytes(bytes: &[u8], meta: &std::fs::Metadata) -> Self {
        Self {
            mtime_ms: mtime_ms(meta),
            size: meta.len(),
            hash: xxhash_rust::xxh3::xxh3_64(bytes),
        }
    }

    /// Cheap check: same size and mtime means unchanged without reading the file.
    pub fn same_stat(&self, meta: &std::fs::Metadata) -> bool {
        self.size == meta.len() && self.mtime_ms == mtime_ms(meta)
    }
}

mod hash_str {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&format!("{v:016x}"))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        let s = String::deserialize(d)?;
        u64::from_str_radix(&s, 16).map_err(serde::de::Error::custom)
    }
}

pub fn mtime_ms(meta: &std::fs::Metadata) -> Option<i64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

/// The current fingerprint of a file (reads it fully to hash).
pub fn fingerprint(path: &Path) -> Result<Fingerprint> {
    let bytes = std::fs::read(path)?;
    let meta = std::fs::metadata(path)?;
    Ok(Fingerprint::of_bytes(&bytes, &meta))
}

#[derive(Debug, Clone)]
pub struct ReadOptions {
    /// Encoding assumed for pure-ASCII files.
    pub default_ascii: &'static Encoding,
    /// Locale hint for legacy-encoding guesses, e.g. `b"il"`.
    pub tld_hint: Option<Vec<u8>>,
    /// Skip detection and decode with this encoding ("Reopen with encoding").
    pub force_encoding: Option<&'static Encoding>,
    /// Used for files without any line break.
    pub default_eol: Eol,
    pub large_bytes: u64,
    pub huge_bytes: u64,
    /// Open a binary-looking file anyway (as read-only Windows-1252).
    pub allow_binary: bool,
}

impl Default for ReadOptions {
    fn default() -> Self {
        Self {
            default_ascii: encoding_rs::UTF_8,
            tld_hint: None,
            force_encoding: None,
            default_eol: Eol::platform_default(),
            large_bytes: 16 << 20,
            huge_bytes: 64 << 20,
            allow_binary: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LoadedDoc {
    /// Text with `\n` line endings and no BOM.
    pub text: String,
    pub encoding: &'static Encoding,
    pub bom: bool,
    pub confidence: Confidence,
    pub eol: EolInfo,
    /// Some bytes were invalid for the encoding and replaced by U+FFFD.
    pub lossy: bool,
    pub kind: DocKind,
    pub readonly: bool,
    pub fingerprint: Fingerprint,
}

pub fn read_doc(path: &Path, opts: &ReadOptions) -> Result<LoadedDoc> {
    let meta = std::fs::metadata(path)?;
    if meta.is_dir() {
        return Err(DafError::new(
            ErrorCode::Invalid,
            format!("{} is a folder", path.display()),
        ));
    }
    let mut kind = sniff::classify_size(meta.len(), opts.large_bytes, opts.huge_bytes);
    if kind == DocKind::Huge {
        return Err(DafError::new(
            ErrorCode::TooLarge,
            format!(
                "{} is {} MB; huge-file mode arrives in phase 2",
                path.display(),
                meta.len() >> 20
            ),
        ));
    }
    let bytes = std::fs::read(path)?;
    let fingerprint = Fingerprint::of_bytes(&bytes, &meta);
    let mut readonly = meta.permissions().readonly();

    let detected = if let Some(forced) = opts.force_encoding {
        let bom = encoding::bom_of(&bytes).is_some_and(|(e, _)| e == forced);
        encoding::Detected {
            encoding: forced,
            bom,
            confidence: Confidence::Certain,
        }
    } else if sniff::looks_binary(&bytes) {
        if !opts.allow_binary {
            return Err(DafError::new(
                ErrorCode::Binary,
                format!("{} looks like a binary file", path.display()),
            ));
        }
        kind = DocKind::Binary;
        readonly = true;
        encoding::Detected {
            encoding: WINDOWS_1252,
            bom: false,
            confidence: Confidence::Guessed,
        }
    } else {
        encoding::detect(&bytes, opts.default_ascii, opts.tld_hint.as_deref())
    };

    let (decoded, lossy) = encoding::decode(&bytes, detected.encoding);
    let eol_info = eol::detect(&decoded, opts.default_eol);
    let text = eol::normalize(&decoded).into_owned();
    Ok(LoadedDoc {
        text,
        encoding: detected.encoding,
        bom: detected.bom,
        confidence: detected.confidence,
        eol: eol_info,
        lossy,
        kind,
        readonly,
        fingerprint,
    })
}
