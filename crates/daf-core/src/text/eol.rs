//! Line endings. The editor always works with `\n`; the file's style is re-applied on save.

use serde::{Deserialize, Serialize};
use std::borrow::Cow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
    Cr,
}

impl Eol {
    pub fn as_str(self) -> &'static str {
        match self {
            Eol::Lf => "\n",
            Eol::Crlf => "\r\n",
            Eol::Cr => "\r",
        }
    }

    pub fn platform_default() -> Self {
        if cfg!(windows) { Eol::Crlf } else { Eol::Lf }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EolInfo {
    pub eol: Eol,
    /// More than one style appears in the scanned prefix.
    pub mixed: bool,
}

/// How much text is scanned to pick the dominant style.
const SCAN_LEN: usize = 1 << 20;

/// The dominant line ending of `text`, or `default` when it has no line breaks.
pub fn detect(text: &str, default: Eol) -> EolInfo {
    let mut end = text.len().min(SCAN_LEN);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let bytes = &text.as_bytes()[..end];
    let (mut lf, mut crlf, mut cr) = (0usize, 0usize, 0usize);
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\r' if bytes.get(i + 1) == Some(&b'\n') => {
                crlf += 1;
                i += 1;
            }
            b'\r' => cr += 1,
            b'\n' => lf += 1,
            _ => {}
        }
        i += 1;
    }
    let kinds = [lf, crlf, cr].iter().filter(|&&n| n > 0).count();
    let eol = if kinds == 0 {
        default
    } else if crlf >= lf && crlf >= cr {
        Eol::Crlf
    } else if lf >= cr {
        Eol::Lf
    } else {
        Eol::Cr
    };
    EolInfo {
        eol,
        mixed: kinds > 1,
    }
}

/// Convert every `\r\n` and lone `\r` to `\n`.
pub fn normalize(text: &str) -> Cow<'_, str> {
    if !text.contains('\r') {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push('\n');
        } else {
            out.push(c);
        }
    }
    Cow::Owned(out)
}

/// Convert `\n`-normalized text to the given line ending.
pub fn apply(text: &str, eol: Eol) -> Cow<'_, str> {
    match eol {
        Eol::Lf => Cow::Borrowed(text),
        _ if !text.contains('\n') => Cow::Borrowed(text),
        _ => Cow::Owned(text.replace('\n', eol.as_str())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_dominant_and_mixed() {
        assert_eq!(
            detect("a\r\nb\r\nc\n", Eol::Lf),
            EolInfo {
                eol: Eol::Crlf,
                mixed: true
            }
        );
        assert_eq!(
            detect("a\nb", Eol::Crlf),
            EolInfo {
                eol: Eol::Lf,
                mixed: false
            }
        );
        assert_eq!(
            detect("a\rb\r", Eol::Lf),
            EolInfo {
                eol: Eol::Cr,
                mixed: false
            }
        );
        assert_eq!(
            detect("no breaks", Eol::Crlf),
            EolInfo {
                eol: Eol::Crlf,
                mixed: false
            }
        );
    }

    #[test]
    fn normalize_then_apply_round_trips() {
        for eol in [Eol::Lf, Eol::Crlf, Eol::Cr] {
            let original = ["שורה", "line", "", "end"].join(eol.as_str());
            assert_eq!(apply(&normalize(&original), eol), original);
        }
    }
}
