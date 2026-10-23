//! Tests for saving and resuming an unfinished session.
//!
//! Leaving practice used to discard the queue and the position, so there was
//! no way back to the words that had not been answered yet.

use lexiflow_lib::testing::{Db, PendingSession};

/// A temporary directory that is removed when it goes out of scope.
mod tempdir {
    use std::path::{Path, PathBuf};

    /// A temporary directory that is deleted on drop.
    pub struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        /// Create a uniquely named directory under the system temp folder.
        pub fn new(prefix: &str) -> std::io::Result<Self> {
            let unique = format!(
                "{prefix}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            );
            let path = std::env::temp_dir().join(unique);
            std::fs::create_dir_all(&path)?;
            Ok(TempDir { path })
        }

        /// The directory's path.
        pub fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

fn sample_session(answered: usize) -> PendingSession {
    PendingSession {
        ids: (0..20).map(|i| format!("cet4:word-{i}")).collect(),
        answered,
        book_id: "cet4".into(),
        scope: "mix".into(),
        mode: "spelling".into(),
        limit: 20,
        updated_at: 1_700_000_000_000,
    }
}

#[test]
fn a_session_survives_the_round_trip_through_the_database() {
    let dir = tempdir::TempDir::new("lexiflow-session").unwrap();
    let db = Db::open(dir.path().join("test.db")).unwrap();

    assert!(db.pending_session().unwrap().is_none());

    let session = sample_session(6);
    db.save_pending_session(&serde_json::to_string(&session).unwrap()).unwrap();

    let stored = db.pending_session().unwrap().unwrap();
    let restored: PendingSession = serde_json::from_str(&stored).unwrap();

    assert_eq!(restored.answered, 6);
    assert_eq!(restored.ids.len(), 20);
    assert_eq!(restored.book_id, "cet4");
    assert_eq!(restored.current().map(|id| id.as_str()), Some("cet4:word-6"));
    assert_eq!(restored.remaining(), 14);
    assert!(!restored.finished());
}

#[test]
fn a_finished_session_reports_no_remaining_words() {
    let session = sample_session(20);
    assert!(session.finished());
    assert_eq!(session.remaining(), 0);
    assert_eq!(session.current(), None);
}

#[test]
fn saving_again_replaces_the_previous_position() {
    let dir = tempdir::TempDir::new("lexiflow-session2").unwrap();
    let db = Db::open(dir.path().join("test.db")).unwrap();

    db.save_pending_session(&serde_json::to_string(&sample_session(3)).unwrap())
        .unwrap();
    db.save_pending_session(&serde_json::to_string(&sample_session(11)).unwrap())
        .unwrap();

    let restored: PendingSession =
        serde_json::from_str(&db.pending_session().unwrap().unwrap()).unwrap();
    assert_eq!(restored.answered, 11);
    assert_eq!(restored.remaining(), 9);
}

#[test]
fn clearing_the_session_removes_it() {
    let dir = tempdir::TempDir::new("lexiflow-session3").unwrap();
    let db = Db::open(dir.path().join("test.db")).unwrap();

    db.save_pending_session(&serde_json::to_string(&sample_session(4)).unwrap())
        .unwrap();
    assert!(db.pending_session().unwrap().is_some());

    db.clear_pending_session().unwrap();
    assert!(db.pending_session().unwrap().is_none());
}
