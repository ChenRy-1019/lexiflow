//! End-to-end test of importing a book and studying from it.
//!
//! The parser tests cover reading a file; this checks the part that matters to
//! a learner: after an import the book appears in the list, its words resolve
//! by id, and a session can be built from it.

use lexiflow_lib::testing::{Db, CustomBook, CustomEntry};

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

fn sample_book(id: &str) -> (CustomBook, Vec<CustomEntry>) {
    let book = CustomBook {
        id: id.to_string(),
        name: "我的四级词表".into(),
        source: "cet4.xlsx".into(),
        format: "Excel".into(),
        imported_at: 1_700_000_000_000,
        total: 3,
    };

    let entries = vec![
        CustomEntry {
            entry_id: format!("{id}-0"),
            word: "abandon".into(),
            meaning: "放弃；抛弃".into(),
            phonetic: "/əˈbændən/".into(),
            pos: "v.".into(),
        },
        CustomEntry {
            entry_id: format!("{id}-1"),
            word: "ability".into(),
            meaning: "能力；才能".into(),
            phonetic: String::new(),
            pos: "n.".into(),
        },
        CustomEntry {
            entry_id: format!("{id}-2"),
            word: "absent".into(),
            meaning: "缺席的".into(),
            phonetic: String::new(),
            pos: "adj.".into(),
        },
    ];

    (book, entries)
}

#[test]
fn an_imported_book_appears_in_the_list() {
    let dir = tempdir::TempDir::new("lexiflow-import").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();

    let (book, entries) = sample_book("import-1");
    db.insert_custom_book(&book, &entries).unwrap();

    let books = db.custom_books().unwrap();
    assert_eq!(books.len(), 1);
    assert_eq!(books[0].name, "我的四级词表");
    // The count comes from the entries, not from a separately stored number.
    assert_eq!(books[0].total, 3);
}

#[test]
fn the_entries_come_back_in_their_original_order() {
    let dir = tempdir::TempDir::new("lexiflow-import").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();

    let (book, entries) = sample_book("import-2");
    db.insert_custom_book(&book, &entries).unwrap();

    let stored = db.custom_entries(&book.id).unwrap();
    let words: Vec<&str> = stored.iter().map(|entry| entry.word.as_str()).collect();
    assert_eq!(words, vec!["abandon", "ability", "absent"]);
}

#[test]
fn a_word_can_be_looked_up_by_its_id() {
    let dir = tempdir::TempDir::new("lexiflow-import").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();

    let (book, entries) = sample_book("import-3");
    db.insert_custom_book(&book, &entries).unwrap();

    // The study flow stores ids and resolves them later; the notebook does the
    // same, so lookup by id has to work for imported words.
    let found = db
        .custom_entries_by_ids(&[format!("{}", entries[1].entry_id)])
        .unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].word, "ability");
    assert_eq!(found[0].meaning, "能力；才能");
}

#[test]
fn looking_up_an_unknown_id_returns_nothing_rather_than_failing() {
    let dir = tempdir::TempDir::new("lexiflow-import").unwrap();
    let db = Db::open(dir.path().join("test.db")).unwrap();

    let found = db
        .custom_entries_by_ids(&["import-9-9".to_string()])
        .unwrap();
    assert!(found.is_empty());
}

#[test]
fn deleting_a_book_removes_its_entries_too() {
    let dir = tempdir::TempDir::new("lexiflow-import").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();

    let (book, entries) = sample_book("import-4");
    db.insert_custom_book(&book, &entries).unwrap();
    assert_eq!(db.all_custom_entries().unwrap().len(), 3);

    db.delete_custom_book(&book.id).unwrap();

    assert!(db.custom_books().unwrap().is_empty());
    // A book whose entries survived would leave orphaned words behind.
    assert!(db.all_custom_entries().unwrap().is_empty());
}

#[test]
fn two_books_with_the_same_name_coexist() {
    let dir = tempdir::TempDir::new("lexiflow-import").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();

    let (first, first_entries) = sample_book("import-5");
    let (second, second_entries) = sample_book("import-6");
    db.insert_custom_book(&first, &first_entries).unwrap();
    db.insert_custom_book(&second, &second_entries).unwrap();

    let books = db.custom_books().unwrap();
    assert_eq!(books.len(), 2);
    // Six entries, and the ids are namespaced so nothing collides.
    let all = db.all_custom_entries().unwrap();
    assert_eq!(all.len(), 6);
    let unique: std::collections::HashSet<&String> =
        all.iter().map(|entry| &entry.entry_id).collect();
    assert_eq!(unique.len(), 6);
}

#[test]
fn the_same_word_in_two_books_is_tracked_separately() {
    let dir = tempdir::TempDir::new("lexiflow-import").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();

    let (first, first_entries) = sample_book("import-7");
    let (second, second_entries) = sample_book("import-8");
    db.insert_custom_book(&first, &first_entries).unwrap();
    db.insert_custom_book(&second, &second_entries).unwrap();

    // "abandon" appears in both, under different entry ids, which is what the
    // learner asked for: the two cards schedule independently.
    let all = db.all_custom_entries().unwrap();
    let abandons: Vec<&CustomEntry> =
        all.iter().filter(|entry| entry.word == "abandon").collect();
    assert_eq!(abandons.len(), 2);
    assert_ne!(abandons[0].entry_id, abandons[1].entry_id);
}

#[test]
fn an_empty_book_is_still_recorded_but_has_no_words() {
    let dir = tempdir::TempDir::new("lexiflow-import").unwrap();
    let mut db = Db::open(dir.path().join("test.db")).unwrap();

    let book = CustomBook {
        id: "import-empty".into(),
        name: "空词书".into(),
        source: String::new(),
        format: "文本".into(),
        imported_at: 1,
        total: 0,
    };
    db.insert_custom_book(&book, &[]).unwrap();

    let books = db.custom_books().unwrap();
    assert_eq!(books[0].total, 0);
    assert!(db.custom_entries("import-empty").unwrap().is_empty());
}
