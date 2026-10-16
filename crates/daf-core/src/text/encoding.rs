//! Encoding detection, decoding and encoding.
//!
//! Order of detection: BOM → strict UTF-8 → chardetng (with a TLD hint so Hebrew legacy files
//! resolve to Windows-1255). encoding_rs never *encodes* UTF-16, so that path is done by hand.

use encoding_rs::{EncoderResult, Encoding, UTF_8, UTF_16BE, UTF_16LE};
use serde::Serialize;

/// How sure we are about a detected encoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    /// BOM present, or the bytes are valid non-ASCII UTF-8.
    Certain,
    /// Pure ASCII: any ASCII-compatible encoding fits; the configured default was used.
    Ascii,
    /// Statistical guess.
    Guessed,
}

#[derive(Debug, Clone, Copy)]
pub struct Detected {
    pub encoding: &'static Encoding,
    pub bom: bool,
    pub confidence: Confidence,
}

/// Characters that the target encoding cannot represent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Unmappable {
    pub count: usize,
    /// 1-based line of the first unmappable character.
    pub first_line: usize,
    /// 1-based column (in chars) of the first unmappable character.
    pub first_col: usize,
}

/// How many bytes chardetng looks at. Enough for a confident guess, cheap on big files.
const SNIFF_LEN: usize = 1 << 20;

/// Look up an encoding by WHATWG label ("utf-8", "windows-1255", "UTF-16LE", ...).
pub fn for_label(label: &str) -> Option<&'static Encoding> {
    Encoding::for_label(label.trim().as_bytes())
}

/// The BOM at the start of `bytes`, if any.
pub fn bom_of(bytes: &[u8]) -> Option<(&'static Encoding, usize)> {
    Encoding::for_bom(bytes)
}

/// Detect the encoding of `bytes`. `tld_hint` (e.g. `b"il"`) biases legacy guesses toward a locale.
pub fn detect(bytes: &[u8], default_ascii: &'static Encoding, tld_hint: Option<&[u8]>) -> Detected {
    if let Some((encoding, _)) = bom_of(bytes) {
        return Detected {
            encoding,
            bom: true,
            confidence: Confidence::Certain,
        };
    }
    if bytes.is_ascii() {
        let encoding = if default_ascii.is_ascii_compatible() {
            default_ascii
        } else {
            UTF_8
        };
        return Detected {
            encoding,
            bom: false,
            confidence: Confidence::Ascii,
        };
    }
    if std::str::from_utf8(bytes).is_ok() {
        return Detected {
            encoding: UTF_8,
            bom: false,
            confidence: Confidence::Certain,
        };
    }
    let sample = &bytes[..bytes.len().min(SNIFF_LEN)];
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(sample, sample.len() == bytes.len());
    let encoding = detector.guess(tld_hint, false);
    Detected {
        encoding,
        bom: false,
        confidence: Confidence::Guessed,
    }
}

/// Decode `bytes` (including any BOM) as `encoding`. Returns the text and whether any byte was
/// malformed (replaced by U+FFFD) — a lossy decode must not be saved back silently.
pub fn decode(bytes: &[u8], encoding: &'static Encoding) -> (String, bool) {
    let body = match bom_of(bytes) {
        Some((bom_enc, len)) if bom_enc == encoding => &bytes[len..],
        _ => bytes,
    };
    let (text, had_errors) = encoding.decode_without_bom_handling(body);
    (text.into_owned(), had_errors)
}

/// Encode `text` as `encoding`, optionally with a BOM (only meaningful for UTF-8/16).
pub fn encode(text: &str, encoding: &'static Encoding, bom: bool) -> Result<Vec<u8>, Unmappable> {
    if encoding == UTF_8 {
        let mut out = Vec::with_capacity(text.len() + 3);
        if bom {
            out.extend_from_slice(b"\xEF\xBB\xBF");
        }
        out.extend_from_slice(text.as_bytes());
        return Ok(out);
    }
    if encoding == UTF_16LE || encoding == UTF_16BE {
        let le = encoding == UTF_16LE;
        let mut out = Vec::with_capacity(text.len() * 2 + 2);
        if bom {
            out.extend_from_slice(if le { b"\xFF\xFE" } else { b"\xFE\xFF" });
        }
        for unit in text.encode_utf16() {
            out.extend_from_slice(&if le {
                unit.to_le_bytes()
            } else {
                unit.to_be_bytes()
            });
        }
        return Ok(out);
    }

    let mut encoder = encoding.new_encoder();
    let capacity = encoder
        .max_buffer_length_from_utf8_without_replacement(text.len())
        .unwrap_or(text.len() * 4);
    let mut out = Vec::with_capacity(capacity);
    let mut rest = text;
    let mut consumed = 0usize;
    let mut count = 0usize;
    let mut first: Option<usize> = None;
    loop {
        let (result, read) =
            encoder.encode_from_utf8_to_vec_without_replacement(rest, &mut out, true);
        match result {
            EncoderResult::InputEmpty => break,
            EncoderResult::Unmappable(c) => {
                count += 1;
                first.get_or_insert(consumed + read - c.len_utf8());
                consumed += read;
                rest = &rest[read..];
            }
            EncoderResult::OutputFull => {
                consumed += read;
                rest = &rest[read..];
                out.reserve(rest.len() * 4 + 16);
            }
        }
    }
    match first {
        None => Ok(out),
        Some(offset) => {
            let (first_line, first_col) = line_col(text, offset);
            Err(Unmappable {
                count,
                first_line,
                first_col,
            })
        }
    }
}

/// 1-based line/column (in chars) of a byte offset.
fn line_col(text: &str, offset: usize) -> (usize, usize) {
    let before = &text[..offset];
    let line = before.bytes().filter(|&b| b == b'\n').count() + 1;
    let line_start = before.rfind('\n').map_or(0, |i| i + 1);
    (line, before[line_start..].chars().count() + 1)
}

/// Whether a BOM makes sense for this encoding.
pub fn supports_bom(encoding: &'static Encoding) -> bool {
    encoding == UTF_8 || encoding == UTF_16LE || encoding == UTF_16BE
}

#[cfg(test)]
mod tests {
    use super::*;
    use encoding_rs::WINDOWS_1255;

    #[test]
    fn hebrew_windows_1255_detected_and_round_trips() {
        let text = "שלום עולם, זהו קובץ בקידוד ישן של חלונות. ";
        let bytes = WINDOWS_1255.encode(&text.repeat(20)).0.into_owned();
        let d = detect(&bytes, UTF_8, Some(b"il"));
        assert_eq!(d.encoding, WINDOWS_1255);
        assert_eq!(d.confidence, Confidence::Guessed);
        let (decoded, lossy) = decode(&bytes, d.encoding);
        assert!(!lossy);
        assert_eq!(encode(&decoded, d.encoding, false).unwrap(), bytes);
    }

    #[test]
    fn utf16_round_trips_with_bom() {
        for enc in [UTF_16LE, UTF_16BE] {
            let bytes = encode("שלום\nhello 🎉", enc, true).unwrap();
            let d = detect(&bytes, UTF_8, None);
            assert_eq!(d.encoding, enc);
            assert!(d.bom);
            let (text, lossy) = decode(&bytes, enc);
            assert!(!lossy);
            assert_eq!(text, "שלום\nhello 🎉");
        }
    }

    #[test]
    fn unmappable_reports_first_position() {
        let err = encode("abc\nde🎉f🎉", WINDOWS_1255, false).unwrap_err();
        assert_eq!(
            err,
            Unmappable {
                count: 2,
                first_line: 2,
                first_col: 3
            }
        );
    }

    #[test]
    fn ascii_uses_default() {
        let d = detect(b"plain ascii", WINDOWS_1255, None);
        assert_eq!(d.encoding, WINDOWS_1255);
        assert_eq!(d.confidence, Confidence::Ascii);
    }
}
