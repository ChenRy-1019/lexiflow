//! Integration tests for the storage layer.
//!
//! These live outside the crate so they exercise the public API exactly the
//! way the Tauri commands do.

use lexiflow_lib::testing::{Card, Db, NotebookItem, ReviewLog};

/// A tiny scope guard that removes a directory when it goes out of scope.
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

fn temp_db() -> (tempdir::TempDir, Db) {
    let dir = tempdir::TempDir::new("lexiflow-db-test").unwrap();
    let db = Db::open(dir.path().join("test.db")).unwrap();
    (dir, db)
}

fn sample_card(entry_id: &str) -> Card {
    Card {
        entry_id: entry_id.to_string(),
        card: Some("{\"due\":1}".to_string()),
        state: 2,
        due: 1_700_000_000_000,
        first_seen_at: 1_699_000_000_000,
        last_seen_at: 1_699_500_000_000,
        correct_count: 2,
        lapse_count: 1,
        mastered: true,
    }
}

#[test]
fn cards_round_trip_through_the_database() {
    let (_dir, db) = temp_db();
    let card = sample_card("cet4:abandon");
    db.upsert_card(&card).unwrap();

    let loaded = db.card("cet4:abandon").unwrap().unwrap();
    assert_eq!(loaded.entry_id, "cet4:abandon");
    assert_eq!(loaded.correct_count, 2);
    assert!(loaded.mastered);
    assert_eq!(loaded.due, card.due);

    let all = db.all_cards().unwrap();
    assert_eq!(all.len(), 1);
}

#[test]
fn upserting_the_same_card_updates_rather_than_duplicates() {
    let (_dir, db) = temp_db();
    let mut card = sample_card("cet4:abandon");
    db.upsert_card(&card).unwrap();

    card.correct_count = 5;
    db.upsert_card(&card).unwrap();

    let all = db.all_cards().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all["cet4:abandon"].correct_count, 5);
}

#[test]
fn logs_are_filtered_by_the_requested_window() {
    let (_dir, db) = temp_db();
    let now = 1_700_000_000_000i64;

    db.add_log(&ReviewLog {
        entry_id: "a".into(),
        at: now - 1_000,
        rating: 3,
        duration_ms: 500,
        mode: "spelling".into(),
    })
    .unwrap();
    db.add_log(&ReviewLog {
        entry_id: "b".into(),
        at: now - 60_000,
        rating: 1,
        duration_ms: 900,
        mode: "choice".into(),
    })
    .unwrap();

    let recent = db.logs_since(now - 10_000).unwrap();
    assert_eq!(recent.len(), 1);
    assert_eq!(recent[0].entry_id, "a");

    assert_eq!(db.logs_since(0).unwrap().len(), 2);
}

#[test]
fn notebook_entries_are_idempotent() {
    let (_dir, db) = temp_db();
    db.add_to_notebook("cet4:abandon", 1000).unwrap();
    db.add_to_notebook("cet4:abandon", 2000).unwrap();

    assert!(db.in_notebook("cet4:abandon").unwrap());
    assert_eq!(db.notebook().unwrap().len(), 1);

    db.increment_notebook_wrong("cet4:abandon").unwrap();
    db.increment_notebook_wrong("cet4:abandon").unwrap();
    let notebook: Vec<NotebookItem> = db.notebook().unwrap();
    assert_eq!(notebook[0].wrong_count, 2);

    db.remove_from_notebook("cet4:abandon").unwrap();
    assert!(!db.in_notebook("cet4:abandon").unwrap());
}

#[test]
fn settings_are_written_and_read_back() {
    let (_dir, db) = temp_db();
    assert_eq!(db.setting("dailyGoal").unwrap(), None);

    db.set_setting("dailyGoal", "30").unwrap();
    assert_eq!(db.setting("dailyGoal").unwrap().as_deref(), Some("30"));

    db.set_setting("dailyGoal", "40").unwrap();
    assert_eq!(db.setting("dailyGoal").unwrap().as_deref(), Some("40"));
}

#[test]
fn resetting_progress_keeps_the_notebook() {
    let (_dir, db) = temp_db();
    db.upsert_card(&sample_card("cet4:abandon")).unwrap();
    db.add_to_notebook("cet4:abandon", 1000).unwrap();

    db.reset_progress().unwrap();

    assert!(db.all_cards().unwrap().is_empty());
    assert_eq!(db.notebook().unwrap().len(), 1);

    db.reset_all().unwrap();
    assert!(db.notebook().unwrap().is_empty());
}
