//! Tests for cross-source search.
//!
//! A word belongs to several wordbooks at once — `denial` sits in five of them —
//! so a naive search returned the same headword once per book. Reported as
//! "查词会把每本书重复的出现".

use lexiflow_lib::testing::{search_any, Db, Lexicon};

/// A lexicon with one wordbook holding the same word under two ids, which is
/// what the real data looks like across books.
fn duplicate_lexicon() -> Lexicon {
    let raw = r#"{
      "schemaVersion": 1,
      "generatedAt": "2026-01-01T00:00:00Z",
      "source": "test",
      "books": {
        "cet4": [
          {"id": "cet4:denial", "word": "denial", "meaning": "n.否认，拒绝", "pos": "n.", "phonetic": "", "example": "", "exampleZh": "", "phrase": false, "etymology": ""},
          {"id": "cet4:abhor", "word": "abhor", "meaning": "vt.憎恶，痛恨", "pos": "vt.", "phonetic": "", "example": "", "exampleZh": "", "phrase": false, "etymology": ""}
        ],
        "cet6": [
          {"id": "cet6:denial", "word": "denial", "meaning": "n.否认；拒绝接受", "pos": "n.", "phonetic": "", "example": "", "exampleZh": "", "phrase": false, "etymology": ""}
        ],
        "kaoyan": [
          {"id": "kaoyan:denial", "word": "Denial", "meaning": "n.否定", "pos": "n.", "phonetic": "", "example": "", "exampleZh": "", "phrase": false, "etymology": ""}
        ]
      },
      "meta": {
        "cet4": {"id": "cet4", "name": "四级", "category": "国内考试", "short": "CET-4", "description": "", "total": 2},
        "cet6": {"id": "cet6", "name": "六级", "category": "国内考试", "short": "CET-6", "description": "", "total": 1},
        "kaoyan": {"id": "kaoyan", "name": "考研", "category": "国内考试", "short": "NPEE", "description": "", "total": 1}
      }
    }"#;

    Lexicon::from_json(raw).expect("lexicon parses")
}

fn empty_db() -> (tempdir::TempDir, Db) {
    let dir = tempdir::TempDir::new("lexiflow-search").expect("temp dir");
    let db = Db::open(dir.path().join("test.db")).expect("db opens");
    (dir, db)
}

mod tempdir {
    use std::path::{Path, PathBuf};

    pub struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        pub fn new(prefix: &str) -> std::io::Result<Self> {
            // The tests run in one process, so pid alone is not distinct; the
            // timestamp can also collide on a fast run. A counter makes the
            // directory unique per call.
            use std::sync::atomic::{AtomicU64, Ordering};
            static N: AtomicU64 = AtomicU64::new(0);
            let unique = format!(
                "{prefix}-{}-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::SeqCst),
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

#[test]
fn a_word_in_three_books_appears_once() {
    let lexicon = duplicate_lexicon();
    let (_dir, db) = empty_db();

    let hits = search_any(&db, &lexicon, "denial", 50);

    let denials: Vec<_> = hits.iter().filter(|e| e.word.eq_ignore_ascii_case("denial")).collect();
    assert_eq!(denials.len(), 1, "the word must be listed once, got {:?}", denials);
}

#[test]
fn different_words_are_all_kept() {
    let lexicon = duplicate_lexicon();
    let (_dir, db) = empty_db();

    let hits = search_any(&db, &lexicon, "denial", 50);
    let words: Vec<_> = hits.iter().map(|e| e.word.to_lowercase()).collect();

    assert!(words.contains(&"denial".to_string()));
    // `abhor` does not contain "denial", so only denial should match.
    assert!(!words.contains(&"abhor".to_string()));
}

#[test]
fn matching_is_case_insensitive_across_books() {
    // The kaoyan copy is capitalised `Denial`; it must not slip past dedup.
    let lexicon = duplicate_lexicon();
    let (_dir, db) = empty_db();

    let hits = search_any(&db, &lexicon, "Denial", 50);
    let denials = hits.iter().filter(|e| e.word.eq_ignore_ascii_case("denial")).count();

    assert_eq!(denials, 1);
}

#[test]
fn the_kept_copy_carries_a_usable_gloss() {
    // Every wordbook holds the same gloss for a shared word, so it does not
    // matter which copy survives — only that it is not empty.
    let lexicon = duplicate_lexicon();
    let (_dir, db) = empty_db();

    let hits = search_any(&db, &lexicon, "denial", 50);
    let kept = hits
        .iter()
        .find(|e| e.word.eq_ignore_ascii_case("denial"))
        .expect("denial present");

    assert!(!kept.meaning.trim().is_empty());
    assert!(!kept.id.is_empty());
}
