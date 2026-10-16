use std::collections::HashSet;

use daf_core::session::{SessionMeta, SessionStore, TabMeta};

fn store() -> (tempfile::TempDir, SessionStore) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("buffers")).unwrap();
    let s = SessionStore::new(dir.path());
    (dir, s)
}

#[test]
fn round_trip_and_orphans() {
    let (_dir, s) = store();
    let id = daf_core::new_doc_id();
    let meta = SessionMeta {
        tabs: vec![TabMeta {
            doc_id: id.clone(),
            title: "new 1".into(),
            dirty: true,
            ..Default::default()
        }],
        untitled_counter: 1,
        ..Default::default()
    };
    s.save_meta(&meta).unwrap();
    s.put_buffer(&id, "טקסט שלא נשמר".as_bytes()).unwrap();
    let orphan = daf_core::new_doc_id();
    s.put_buffer(&orphan, b"crashed before meta write").unwrap();

    let loaded = s.load();
    let m = loaded.meta.unwrap();
    assert_eq!(m.tabs[0].doc_id, id);
    assert_eq!(loaded.orphans, vec![orphan.clone()]);
    assert_eq!(
        s.get_buffer(&id).unwrap().unwrap(),
        "טקסט שלא נשמר".as_bytes()
    );

    s.prune_buffers(&HashSet::from([id.clone()])).unwrap();
    assert!(s.get_buffer(&orphan).unwrap().is_none());
    assert!(s.get_buffer(&id).unwrap().is_some());
}

#[test]
fn corrupt_session_falls_back_to_backup() {
    let (dir, s) = store();
    let meta = SessionMeta {
        untitled_counter: 7,
        ..Default::default()
    };
    s.save_meta(&meta).unwrap();
    s.save_meta(&meta).unwrap(); // creates the .bak
    std::fs::write(dir.path().join("session.json"), b"{ torn wri").unwrap();
    let loaded = s.load();
    assert!(loaded.used_backup);
    assert_eq!(loaded.meta.unwrap().untitled_counter, 7);
}

#[test]
fn path_traversal_ids_are_rejected() {
    let (_dir, s) = store();
    assert!(s.put_buffer("../../evil", b"x").is_err());
    assert!(s.get_buffer("..\\x").is_err());
}
