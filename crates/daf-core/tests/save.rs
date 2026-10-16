use daf_core::fsio::{ReadOptions, SaveOutcome, read_doc, save_atomic};

#[test]
fn conflict_when_disk_changed_and_force_overrides() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.txt");
    std::fs::write(&path, "one").unwrap();
    let doc = read_doc(&path, &ReadOptions::default()).unwrap();

    // Someone else edits the file.
    std::thread::sleep(std::time::Duration::from_millis(20));
    std::fs::write(&path, "someone else").unwrap();

    match save_atomic(&path, b"mine", Some(&doc.fingerprint), false).unwrap() {
        SaveOutcome::Conflict { disk } => assert_eq!(disk.size, 12),
        other => panic!("expected conflict, got {other:?}"),
    }
    assert_eq!(std::fs::read(&path).unwrap(), b"someone else");

    assert!(matches!(
        save_atomic(&path, b"mine", Some(&doc.fingerprint), true).unwrap(),
        SaveOutcome::Saved { .. }
    ));
    assert_eq!(std::fs::read(&path).unwrap(), b"mine");
}

#[test]
fn touch_without_content_change_is_not_a_conflict() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.txt");
    std::fs::write(&path, "same").unwrap();
    let doc = read_doc(&path, &ReadOptions::default()).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    std::fs::write(&path, "same").unwrap();
    assert!(matches!(
        save_atomic(&path, b"new", Some(&doc.fingerprint), false).unwrap(),
        SaveOutcome::Saved { .. }
    ));
}

#[test]
fn readonly_is_reported_not_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ro.txt");
    std::fs::write(&path, "locked").unwrap();
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&path, perms.clone()).unwrap();
    assert!(matches!(
        save_atomic(&path, b"x", None, false).unwrap(),
        SaveOutcome::ReadOnly
    ));
    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    std::fs::set_permissions(&path, perms).unwrap();
}

#[test]
fn new_file_is_created_and_no_temp_files_left() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("new.txt");
    assert!(matches!(
        save_atomic(&path, "שלום".as_bytes(), None, false).unwrap(),
        SaveOutcome::Saved { .. }
    ));
    save_atomic(&path, b"again", None, false).unwrap();
    let names: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names, vec![std::ffi::OsString::from("new.txt")]);
    assert_eq!(std::fs::read(&path).unwrap(), b"again");
}
