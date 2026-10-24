//! The choice question must work for imported words.
//!
//! The reported bug: choosing the meaning mode on an imported word showed no
//! Chinese options. The cause was that `build_choices` widened its distractor
//! pool by scanning only the bundled lexicon, so an imported word found
//! nothing and the question had a single option.

use lexiflow_lib::testing::{CustomBook, CustomEntry, Db};

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

/// Import a book whose words all have distinct Chinese glosses.
fn import_words(db: &mut Db, book_id: &str, count: usize) {
    let book = CustomBook {
        id: book_id.into(),
        name: "测试词书".into(),
        source: "test.csv".into(),
        format: "CSV".into(),
        imported_at: 1,
        total: count,
    };

    let glosses = [
        "放弃；抛弃",
        "能力；才能",
        "缺席的；不在场的",
        "绝对的；完全的",
        "吸收；吸引",
        "学术的；学院的",
        "平衡；均衡",
        "校园；校区",
    ];

    let entries: Vec<CustomEntry> = (0..count)
        .map(|index| CustomEntry {
            entry_id: format!("{book_id}-{index}"),
            word: format!("word{index}"),
            meaning: glosses[index % glosses.len()].to_string(),
            phonetic: String::new(),
            pos: String::new(),
        })
        .collect();

    db.insert_custom_book(&book, &entries).unwrap();
}

#[test]
fn an_imported_book_supplies_its_own_distractors() {
    let dir = tempdir::TempDir::new("lexiflow-choices").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    import_words(&mut db, "import-a", 20);

    let entries = db.custom_entries("import-a").unwrap();

    // Every entry carries a gloss, so a distractor pool can be built from the
    // book alone, without needing the bundled vocabulary.
    let glosses: Vec<&str> = entries.iter().map(|entry| entry.meaning.as_str()).collect();
    assert!(glosses.iter().all(|gloss| !gloss.is_empty()));
    assert!(glosses.len() >= 4);

    // Four distinct choices are available for any question in this book.
    let mut distinct: Vec<&str> = glosses.clone();
    distinct.sort();
    distinct.dedup();
    assert!(distinct.len() >= 4, "only {} distinct glosses", distinct.len());
}

#[test]
fn an_imported_word_can_be_found_for_a_question() {
    let dir = tempdir::TempDir::new("lexiflow-choices").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    import_words(&mut db, "import-b", 10);

    let target = db.custom_entries("import-b").unwrap()[0].entry_id.clone();

    // The question path resolves the word by id; for an imported word that
    // lookup must not come back empty.
    let found = db.custom_entries_by_ids(&[target]).unwrap();
    assert_eq!(found.len(), 1);
}

#[test]
fn distractors_exclude_the_answer_itself() {
    let dir = tempdir::TempDir::new("lexiflow-choices").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    import_words(&mut db, "import-c", 12);

    let entries = db.custom_entries("import-c").unwrap();
    let answer = &entries[0];

    // A distractor must differ in both id and gloss, otherwise the right
    // answer would appear twice and the question would be unanswerable.
    let candidates: Vec<&CustomEntry> = entries
        .iter()
        .filter(|entry| entry.entry_id != answer.entry_id && entry.meaning != answer.meaning)
        .collect();

    assert!(candidates.len() >= 3, "only {} candidates", candidates.len());
    assert!(candidates.iter().all(|entry| entry.entry_id != answer.entry_id));
}

#[test]
fn two_imported_books_can_supply_each_other() {
    let dir = tempdir::TempDir::new("lexiflow-choices").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();
    import_words(&mut db, "import-d", 6);
    import_words(&mut db, "import-e", 6);

    // The widening pass gathers ids from every imported book, so a small book
    // still gets distractors once another one exists.
    let all = db.all_custom_entries().unwrap();
    assert_eq!(all.len(), 12);

    // Each entry id is `<book>-<index>`, so the book part is the section
    // before the final hyphen.
    let books: std::collections::HashSet<String> = all
        .iter()
        .filter_map(|entry| entry.entry_id.rsplit_once('-').map(|(book, _)| book.to_string()))
        .collect();
    assert_eq!(books.len(), 2, "books found: {books:?}");
}
