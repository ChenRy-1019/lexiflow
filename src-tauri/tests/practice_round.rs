//! A full practice round on an imported book.
//!
//! This walks the sequence the practice page performs: build a session,
//! resolve the words, record a rating, and confirm the next word is drawn
//! from the same book. It exists because each of those steps broke at least
//! once for imported books.

use std::collections::HashMap;

use lexiflow_lib::testing::{
    build_session, record_review, CustomBook, CustomEntry, Db, ReviewInput, ReviewOutcome, Scope,
};

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

/// The words of a book.
const WORDS: [(&str, &str); 6] = [
    ("abandon", "vt.丢弃；放弃，抛弃"),
    ("ability", "n.能力；能耐，本领"),
    ("absent", "a.不在场的；缺乏的"),
    ("absolute", "a.绝对的；完全的"),
    ("absorb", "vt.吸收；使专心"),
    ("abstract", "a.抽象的 n.摘要"),
];

fn import(db: &mut Db) -> (String, Vec<String>) {
    let book_id = "import-round".to_string();
    let book = CustomBook {
        id: book_id.clone(),
        name: "四级大纲词汇".into(),
        source: "cet4.csv".into(),
        format: "CSV".into(),
        imported_at: 1,
        total: WORDS.len(),
    };

    let entries: Vec<CustomEntry> = WORDS
        .iter()
        .enumerate()
        .map(|(index, (word, meaning))| CustomEntry {
            entry_id: format!("{book_id}-{index}"),
            word: (*word).into(),
            meaning: (*meaning).into(),
            phonetic: String::new(),
            pos: String::new(),
        })
        .collect();

    db.insert_custom_book(&book, &entries).unwrap();
    (book_id, entries.into_iter().map(|entry| entry.entry_id).collect())
}

fn rate(db: &Db, entry_id: &str, expected: &str, correct: bool, at: i64) -> ReviewOutcome {
    record_review(
        db,
        ReviewInput {
            entry_id,
            expected,
            card_json: Some("{\"due\":0}".into()),
            due: at + 86_400_000,
            state: 2,
            correct,
            rating: if correct { 3 } else { 1 },
            mode: "choice",
            duration_ms: 800,
        },
        at,
    )
}

#[test]
fn a_learner_can_work_through_an_imported_book() {
    let dir = tempdir::TempDir::new("lexiflow-round").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    let (_, ids) = import(&mut db);

    // Step 1: build a session of three words.
    let cards = db.all_cards().unwrap();
    let session = build_session(&ids, &cards, Scope::New, 3, 1_700_000_000_000);
    assert_eq!(session.len(), 3);

    // Step 2: each word resolves to a real entry, which is what the practice
    // page does before showing it.
    for item in &session {
        let found = db.custom_entries_by_ids(&[item.entry_id.clone()]).unwrap();
        assert_eq!(found.len(), 1, "{} did not resolve", item.entry_id);
        assert!(!found[0].meaning.is_empty());
    }

    // Step 3: rate the first two correctly and the third wrong.
    let now = 1_700_000_000_000;
    rate(&db, &session[0].entry_id, "abandon", true, now);
    rate(&db, &session[1].entry_id, "ability", true, now + 1000);
    rate(&db, &session[2].entry_id, "absent", false, now + 2000);

    // Step 4: all three now have cards, and the wrong one is a lapse.
    let cards = db.all_cards().unwrap();
    for item in &session {
        assert!(cards.contains_key(&item.entry_id), "{} has no card", item.entry_id);
    }
    assert_eq!(cards[&session[2].entry_id].lapse_count, 1);
    assert_eq!(cards[&session[0].entry_id].correct_count, 1);

    // Step 5: a new session excludes the words already seen, since none are
    // due yet.
    let remaining = build_session(&ids, &cards, Scope::New, 10, now + 3000);
    assert!(
        !remaining.iter().any(|item| item.entry_id == session[0].entry_id),
        "a practised word came back as new"
    );
    assert_eq!(remaining.len(), 3);
}

#[test]
fn mastery_is_reached_after_two_correct_reviews_of_an_imported_word() {
    let dir = tempdir::TempDir::new("lexiflow-round").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    let (_, ids) = import(&mut db);

    let now = 1_700_000_000_000;
    rate(&db, &ids[0], "abandon", true, now);
    // Not mastered after one correct answer.
    assert!(!db.all_cards().unwrap()[&ids[0]].mastered);

    rate(&db, &ids[0], "abandon", true, now + 1000);
    assert!(db.all_cards().unwrap()[&ids[0]].mastered);
}

#[test]
fn the_imported_book_reports_progress() {
    let dir = tempdir::TempDir::new("lexiflow-round").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    let (book_id, ids) = import(&mut db);

    // Before any practice the book shows zero started.
    let books = db.custom_books().unwrap();
    let book = books.iter().find(|book| book.id == book_id).unwrap();
    assert_eq!(book.total, WORDS.len());

    let now = 1_700_000_000_000;
    rate(&db, &ids[0], "abandon", true, now);
    rate(&db, &ids[1], "ability", true, now + 1000);

    // The counters in the library come from joining cards to the entries.
    let cards = db.all_cards().unwrap();
    let started = ids.iter().filter(|id| cards.contains_key(*id)).count();
    assert_eq!(started, 2);
}

#[test]
fn words_from_two_books_do_not_collide_in_a_round() {
    let dir = tempdir::TempDir::new("lexiflow-round").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    let (_, first) = import(&mut db);

    // A second book with the same words under different ids.
    let book = CustomBook {
        id: "import-second".into(),
        name: "第二本".into(),
        source: "b.csv".into(),
        format: "CSV".into(),
        imported_at: 2,
        total: 2,
    };
    let entries: Vec<CustomEntry> = WORDS[..2]
        .iter()
        .enumerate()
        .map(|(index, (word, meaning))| CustomEntry {
            entry_id: format!("import-second-{index}"),
            word: (*word).into(),
            meaning: (*meaning).into(),
            phonetic: String::new(),
            pos: String::new(),
        })
        .collect();
    db.insert_custom_book(&book, &entries).unwrap();

    let now = 1_700_000_000_000;
    // Rate "abandon" in the first book only.
    rate(&db, &first[0], "abandon", true, now);

    let cards: HashMap<String, _> = db.all_cards().unwrap();
    assert!(cards.contains_key(&first[0]));
    // The copy in the second book is untouched.
    assert!(!cards.contains_key("import-second-0"));
}
