//! Gate 0: opening and saving an unedited file must reproduce it byte for byte,
//! for every encoding and line-ending style Daf claims to support.

use daf_core::fsio::{ReadOptions, SaveOutcome, read_doc, save_atomic};
use daf_core::text::{Eol, encoding, eol};
use encoding_rs::{Encoding, ISO_8859_8, UTF_8, UTF_16BE, UTF_16LE, WINDOWS_1255};

const HEBREW: &[&str] = &[
    "שלום עולם — זוהי שורה ראשונה בעברית.",
    "Mixed line: hello עולם 123 ש״ח (סוגריים) and English.",
    "",
    "    הזחה עם רווחים, ניקוד: שָׁלוֹם",
    "const x = 1; // הערה בעברית",
    "סוף הקובץ",
];

fn ascii_only_for(enc: &'static Encoding, line: &str) -> String {
    // ISO-8859-8 has no niqqud or gershayim; keep the corpus encodable.
    if enc == ISO_8859_8 {
        line.chars()
            .filter(|c| !('\u{0591}'..='\u{05C7}').contains(c) && *c != '״' && *c != '—')
            .collect()
    } else {
        line.to_string()
    }
}

fn build(enc: &'static Encoding, bom: bool, style: Eol) -> Vec<u8> {
    let lines: Vec<String> = HEBREW.iter().map(|l| ascii_only_for(enc, l)).collect();
    let text = lines.join("\n") + "\n";
    let text = eol::apply(&text, style);
    encoding::encode(&text, enc, bom).expect("corpus must be encodable")
}

#[test]
fn unedited_open_save_is_byte_identical() {
    let dir = tempfile::tempdir().unwrap();
    let cases: &[(&'static Encoding, bool)] = &[
        (UTF_8, false),
        (UTF_8, true),
        (UTF_16LE, true),
        (UTF_16BE, true),
        (WINDOWS_1255, false),
        (ISO_8859_8, false),
    ];
    let opts = ReadOptions {
        tld_hint: Some(b"il".to_vec()),
        ..Default::default()
    };
    for &(enc, bom) in cases {
        for style in [Eol::Crlf, Eol::Lf, Eol::Cr] {
            let original = build(enc, bom, style);
            let path = dir
                .path()
                .join(format!("{}-{bom}-{style:?}.txt", enc.name()));
            std::fs::write(&path, &original).unwrap();

            // ISO-8859-8 and Windows-1255 share most Hebrew bytes; detection may pick either.
            // What matters for the gate is the round trip with whatever was detected.
            let doc = read_doc(&path, &opts).unwrap();
            assert!(!doc.lossy, "{path:?} decoded lossily");
            assert_eq!(doc.bom, bom, "{path:?}");
            assert_eq!(doc.eol.eol, style, "{path:?}");
            if enc != ISO_8859_8 {
                assert_eq!(doc.encoding, enc, "{path:?}");
            }
            assert!(!doc.text.contains('\r'));

            let bytes =
                encoding::encode(&eol::apply(&doc.text, doc.eol.eol), doc.encoding, doc.bom)
                    .unwrap();
            match save_atomic(&path, &bytes, Some(&doc.fingerprint), false).unwrap() {
                SaveOutcome::Saved { .. } => {}
                other => panic!("{path:?}: {other:?}"),
            }
            assert_eq!(
                std::fs::read(&path).unwrap(),
                original,
                "{path:?} changed on round trip"
            );
        }
    }
}

#[test]
fn binary_and_too_large_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("a.bin");
    std::fs::write(&bin, b"MZ\x00\x01\x02").unwrap();
    let err = read_doc(&bin, &ReadOptions::default()).unwrap_err();
    assert_eq!(err.code, daf_core::ErrorCode::Binary);
    let doc = read_doc(
        &bin,
        &ReadOptions {
            allow_binary: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(doc.readonly);

    let big = dir.path().join("big.log");
    std::fs::write(&big, vec![b'a'; 2048]).unwrap();
    let err = read_doc(
        &big,
        &ReadOptions {
            huge_bytes: 1024,
            ..Default::default()
        },
    )
    .unwrap_err();
    assert_eq!(err.code, daf_core::ErrorCode::TooLarge);
}
