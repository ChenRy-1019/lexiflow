//! Rating an imported word must be recorded.
//!
//! The blocking bug: `record_review` resolved the entry in the bundled lexicon
//! only, so rating an imported word failed with "unknown entry" and the
//! practice page could not advance past the first word. These tests pin the
//! behaviour that the rating is stored and the card gets a schedule.

use lexiflow_lib::testing::{record_review, CustomBook, CustomEntry, Db, ReviewInput};

mod tempdir {
    use std::path::{Path, PathBuf};

    pub struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
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

/// Import one book and return the entry ids.
fn import(db: &mut Db, book_id: &str) -> Vec<String> {
    let book = CustomBook {
        id: book_id.into(),
        name: "测试".into(),
        source: "t.csv".into(),
        format: "CSV".into(),
        imported_at: 1,
        total: 2,
    };

    let entries = vec![
        CustomEntry {
            entry_id: format!("{book_id}-0"),
            word: "abandon".into(),
            meaning: "放弃".into(),
            phonetic: String::new(),
            pos: String::new(),
        },
        CustomEntry {
            entry_id: format!("{book_id}-1"),
            word: "ability".into(),
            meaning: "能力".into(),
            phonetic: String::new(),
            pos: String::new(),
        },
    ];

    db.insert_custom_book(&book, &entries).unwrap();
    entries.into_iter().map(|entry| entry.entry_id).collect()
}

#[test]
fn an_imported_word_can_be_rated() {
    let dir = tempdir::TempDir::new("lexiflow-review").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    let ids = import(&mut db, "import-r1");

    let outcome = record_review(
        &db,
        ReviewInput {
            entry_id: &ids[0],
            expected: "abandon",
            card_json: Some("{\"due\":1,\"stability\":1.0}".into()),
            due: 1_700_086_400_000,
            state: 2,
            correct: true,
            rating: 3,
            mode: "choice",
            duration_ms: 900,
        },
        1_700_000_000_000,
    );

    // The answer is graded, and the word now has a card.
    assert!(outcome.correct);
    assert_eq!(outcome.expected, "abandon");

    let cards = db.all_cards().unwrap();
    assert!(
        cards.contains_key(&ids[0]),
        "the imported word should have a card after rating"
    );
}

#[test]
fn rating_the_same_imported_word_twice_counts_toward_mastery() {
    let dir = tempdir::TempDir::new("lexiflow-review").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    let ids = import(&mut db, "import-r2");

    for attempt in 0..2 {
        record_review(
            &db,
            ReviewInput {
                entry_id: &ids[0],
                expected: "abandon",
                card_json: None,
                due: 1_700_086_400_000 + attempt,
                state: 2,
                correct: true,
                rating: 3,
                mode: "spelling",
                duration_ms: 500,
            },
            1_700_000_000_000 + attempt,
        );
    }

    let cards = db.all_cards().unwrap();
    let card = cards.get(&ids[0]).expect("card should exist");
    assert_eq!(card.correct_count, 2);
    // Two correct reviews is the mastery threshold.
    assert!(card.mastered);
}

#[test]
fn a_wrong_answer_on_an_imported_word_is_recorded_as_a_lapse() {
    let dir = tempdir::TempDir::new("lexiflow-review").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    let ids = import(&mut db, "import-r3");

    record_review(
        &db,
        ReviewInput {
            entry_id: &ids[1],
            expected: "ability",
            card_json: None,
            due: 1_700_000_000_000,
            state: 1,
            correct: false,
            rating: 1,
            mode: "dictation",
            duration_ms: 300,
        },
        1_700_000_000_000,
    );

    let cards = db.all_cards().unwrap();
    let card = cards.get(&ids[1]).expect("card should exist");
    // A wrong answer is a lapse, not a success.
    assert_eq!(card.lapse_count, 1);
    assert_eq!(card.correct_count, 0);
    assert!(!card.mastered);
}

#[test]
fn rating_leaves_a_log_entry() {
    let dir = tempdir::TempDir::new("lexiflow-review").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    let ids = import(&mut db, "import-r4");

    record_review(
        &db,
        ReviewInput {
            entry_id: &ids[0],
            expected: "abandon",
            card_json: None,
            due: 1_700_000_000_000,
            state: 2,
            correct: true,
            rating: 4,
            mode: "choice",
            duration_ms: 1200,
        },
        1_700_000_000_000,
    );

    // The statistics page counts reviews, so the imported word must appear
    // there too.
    let logs = db.logs_since(0).unwrap_or_default();
    let logged = logs.iter().any(|log| log.entry_id == ids[0]);
    assert!(logged, "no log for the imported word");
}
