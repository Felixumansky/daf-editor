use serde::Serialize;

/// How the editor should treat a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DocKind {
    /// Normal: fully loaded into the editor with all features.
    Text,
    /// Loaded fully, but the editor turns off costly features.
    Large,
    /// Too big for the in-memory editor; needs the windowed huge-file mode (phase 2).
    Huge,
    /// Looks like binary data.
    Binary,
}

const BINARY_SNIFF_LEN: usize = 8192;

/// A NUL byte in the first 8 KB means binary — unless a UTF-16 BOM explains the zeros.
pub fn looks_binary(bytes: &[u8]) -> bool {
    if bytes.starts_with(b"\xFF\xFE") || bytes.starts_with(b"\xFE\xFF") {
        return false;
    }
    memchr::memchr(0, &bytes[..bytes.len().min(BINARY_SNIFF_LEN)]).is_some()
}

pub fn classify_size(size: u64, large_bytes: u64, huge_bytes: u64) -> DocKind {
    if size >= huge_bytes {
        DocKind::Huge
    } else if size >= large_bytes {
        DocKind::Large
    } else {
        DocKind::Text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_detection() {
        assert!(looks_binary(b"MZ\x90\x00\x03"));
        assert!(!looks_binary(b"plain text"));
        assert!(!looks_binary(b"\xFF\xFEa\x00b\x00"));
    }
}
