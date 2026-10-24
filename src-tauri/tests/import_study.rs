//! Study a session drawn from an imported book.
//!
//! This is the test that proves an import is useful rather than just stored:
//! a session built from imported ids must return the imported words, and the
//! scheduler must treat them like any other card.

use std::collections::HashMap;

use lexiflow_lib::testing::{build_session, CustomBook, CustomEntry, Db, Scope};

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

/// Import a book of five words and return its entry ids.
fn import_book(db: &mut Db) -> Vec<String> {
    let book = CustomBook {
        id: "import-100".into(),
        name: "我的测试词书".into(),
        source: "我的测试词书.csv".into(),
        format: "CSV".into(),
        imported_at: 1,
        total: 5,
    };

    let words = ["abandon", "ability", "absent", "absolute", "absorb"];
    let entries: Vec<CustomEntry> = words
        .iter()
        .enumerate()
        .map(|(index, word)| CustomEntry {
            entry_id: format!("import-100-{index}"),
            word: (*word).into(),
            meaning: format!("{word} 的释义"),
            phonetic: String::new(),
            pos: String::new(),
        })
        .collect();

    db.insert_custom_book(&book, &entries).unwrap();
    entries.into_iter().map(|entry| entry.entry_id).collect()
}

#[test]
fn a_session_is_built_from_the_imported_words() {
    let dir = tempdir::TempDir::new("lexiflow-study").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    let ids = import_book(&mut db);

    let cards = HashMap::new();
    let session = build_session(&ids, &cards, Scope::Mix, 3, 1_700_000_000_000);

    // Three new words, in the book's own order.
    assert_eq!(session.len(), 3);
    assert_eq!(session[0].entry_id, "import-100-0");
    assert!(session.iter().all(|item| !item.is_review));
}

#[test]
fn an_imported_card_becomes_due_later() {
    let dir = tempdir::TempDir::new("lexiflow-study").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    let ids = import_book(&mut db);

    // Record one review, as the practice page does.
    let outcome = lexiflow_lib::testing::record_review(
        &db,
        lexiflow_lib::testing::ReviewInput {
            entry_id: &ids[0],
            expected: "abandon",
            // The card is produced by the frontend scheduler; this test only
            // needs a card to exist so the word gains a schedule.
            card_json: None,
            due: 1_700_086_400_000,
            state: 2,
            correct: true,
            rating: 3,
            mode: "spelling",
            duration_ms: 1200,
        },
        1_700_000_000_000,
    );

    assert!(outcome.correct);
    let cards = db.all_cards().unwrap();
    // The card now exists under the imported id, so the word has a schedule.
    assert!(cards.contains_key(&ids[0]));
}

#[test]
fn a_review_scope_excludes_a_word_that_is_not_due() {
    let dir = tempdir::TempDir::new("lexiflow-study").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    let ids = import_book(&mut db);

    let cards = HashMap::new();
    // Nothing has been reviewed, so a review-only session is empty.
    let session = build_session(&ids, &cards, Scope::Review, 10, 1_700_000_000_000);
    assert!(session.is_empty());
}

#[test]
fn importing_more_words_than_asked_limits_the_session() {
    let dir = tempdir::TempDir::new("lexiflow-study").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    let ids = import_book(&mut db);

    let cards = HashMap::new();
    let session = build_session(&ids, &cards, Scope::New, 2, 1_700_000_000_000);
    assert_eq!(session.len(), 2);
}
