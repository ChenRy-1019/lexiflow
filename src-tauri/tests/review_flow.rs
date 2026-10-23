//! End-to-end test of the review pipeline.
//!
//! This mirrors what the frontend does when the learner answers a word:
//! record the review with an FSRS card, then read the counters back. It is
//! the closest thing to a real user action that can run without a window.

use lexiflow_lib::testing::{record_review, Db, ReviewInput};

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

/// The card the frontend would send after an FSRS review.
const FSRS_CARD: &str = r#"{"due":1700000000000,"stability":3.2,"difficulty":5.1,"lastReview":1699990000000,"scheduledDays":3,"reps":1,"lapses":0}"#;

fn review(db: &Db, entry_id: &str, correct: bool, rating: i64, now: i64) -> lexiflow_lib::testing::ReviewOutcome {
    record_review(
        db,
        ReviewInput {
            entry_id,
            expected: "abandon",
            card_json: Some(FSRS_CARD.to_string()),
            due: 1_700_000_000_000,
            state: 2,
            correct,
            rating,
            mode: "spelling",
            duration_ms: 1_200,
        },
        now,
    )
}

#[test]
fn a_correct_review_is_written_and_counted() {
    let dir = tempdir::TempDir::new("lexiflow-review").unwrap();
    let db = Db::open(dir.path().join("test.db")).unwrap();

    let outcome = review(&db, "cet4:abandon", true, 3, 1_699_990_000_000);
    assert!(outcome.correct);
    assert!(!outcome.mastered);
    assert_eq!(outcome.correct_count, 1);

    let card = db.card("cet4:abandon").unwrap().unwrap();
    assert_eq!(card.correct_count, 1);
    assert_eq!(card.lapse_count, 0);
    assert!(!card.mastered);
    assert_eq!(card.first_seen_at, 1_699_990_000_000);
    assert_eq!(card.last_seen_at, 1_699_990_000_000);

    let logs = db.logs_since(0).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].rating, 3);
    assert_eq!(logs[0].mode, "spelling");
}

#[test]
fn a_second_correct_review_masters_the_word() {
    let dir = tempdir::TempDir::new("lexiflow-mastery").unwrap();
    let db = Db::open(dir.path().join("test.db")).unwrap();

    let first = review(&db, "cet4:abandon", true, 3, 1_699_990_000_000);
    assert!(!first.mastered);

    let second = review(&db, "cet4:abandon", true, 3, 1_700_000_000_000);
    assert!(second.mastered);
    assert_eq!(second.correct_count, 2);

    let card = db.card("cet4:abandon").unwrap().unwrap();
    assert!(card.mastered);
    // The first-seen timestamp must not move once the word is known.
    assert_eq!(card.first_seen_at, 1_699_990_000_000);
}

#[test]
fn a_wrong_answer_is_recorded_as_a_lapse() {
    let dir = tempdir::TempDir::new("lexiflow-lapse").unwrap();
    let db = Db::open(dir.path().join("test.db")).unwrap();

    review(&db, "cet4:abandon", true, 3, 1_699_990_000_000);
    let outcome = review(&db, "cet4:abandon", false, 1, 1_700_000_000_000);

    assert!(!outcome.correct);
    assert!(!outcome.mastered);
    // The earlier success still counts towards the total.
    assert_eq!(outcome.correct_count, 1);

    let card = db.card("cet4:abandon").unwrap().unwrap();
    assert_eq!(card.correct_count, 1);
    assert_eq!(card.lapse_count, 1);
}

#[test]
fn the_notebook_counter_tracks_mistakes() {
    let dir = tempdir::TempDir::new("lexiflow-notebook").unwrap();
    let db = Db::open(dir.path().join("test.db")).unwrap();

    db.add_to_notebook("cet4:abandon", 1_000).unwrap();
    review(&db, "cet4:abandon", false, 1, 1_700_000_000_000);
    review(&db, "cet4:abandon", false, 1, 1_700_100_000_000);
    review(&db, "cet4:abandon", false, 1, 1_700_200_000_000);

    let notebook = db.notebook().unwrap();
    assert_eq!(notebook.len(), 1);
    assert_eq!(notebook[0].wrong_count, 3);
}

#[test]
fn the_dashboard_counters_follow_the_reviews() {
    let dir = tempdir::TempDir::new("lexiflow-dashboard").unwrap();
    let db = Db::open(dir.path().join("test.db")).unwrap();

    // Two words, one of them mastered.
    review(&db, "cet4:abandon", true, 3, 1_699_990_000_000);
    review(&db, "cet4:abandon", true, 3, 1_700_000_000_000);
    review(&db, "cet4:ability", true, 3, 1_700_000_000_000);

    let cards = db.all_cards().unwrap();
    assert_eq!(cards.len(), 2);

    let started = cards.values().filter(|c| c.first_seen_at > 0).count();
    let mastered = cards.values().filter(|c| c.mastered).count();
    assert_eq!(started, 2);
    assert_eq!(mastered, 1);
}
