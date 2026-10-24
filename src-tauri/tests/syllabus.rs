//! Verify the generated syllabus CSV imports correctly.
//!
//! The file is produced by scripts/make-cet4-csv.py from an MIT-licensed open
//! wordbook; this checks the parser handles its three-column shape and that
//! the phonetic column is not mistaken for the gloss.

use std::path::Path;

use lexiflow_lib::import;

#[test]
fn the_cet4_syllabus_imports() {
    let path = Path::new("../data/wordbooks/cet4-syllabus.csv");
    if !path.exists() {
        println!("fixture missing, run scripts/make-cet4-csv.py");
        return;
    }

    let parsed = import::parse_file(path).expect("parse");

    // The syllabus is 4540 words; one is dropped as the header.
    assert!(
        parsed.rows.len() > 4500,
        "expected over 4500 rows, got {}",
        parsed.rows.len()
    );

    // Words and glosses must be paired the right way round, not swapped with
    // the phonetic column.
    let abandon = parsed
        .rows
        .iter()
        .find(|row| row.word == "abandon")
        .expect("abandon should be present");
    assert!(
        abandon.meaning.contains("放弃"),
        "gloss was {:?}",
        abandon.meaning
    );
    assert_eq!(abandon.phonetic, "əˈbændən");

    // A header labelled 单词 must not become a word.
    assert!(!parsed.rows.iter().any(|row| row.word == "单词"));
}

#[test]
fn the_syllabus_covers_common_exam_words() {
    let path = Path::new("../data/wordbooks/cet4-syllabus.csv");
    if !path.exists() {
        return;
    }

    let parsed = import::parse_file(path).expect("parse");
    let words: std::collections::HashSet<&str> =
        parsed.rows.iter().map(|row| row.word.as_str()).collect();

    // A sample of words a CET-4 list is expected to include.
    for expected in ["abandon", "ability", "absorb", "academic", "balance", "campus"] {
        assert!(words.contains(expected), "{expected} is missing");
    }
}

#[test]
fn every_row_in_the_syllabus_has_a_gloss() {
    let path = Path::new("../data/wordbooks/cet4-syllabus.csv");
    if !path.exists() {
        return;
    }

    let parsed = import::parse_file(path).expect("parse");
    let empty: Vec<&str> = parsed
        .rows
        .iter()
        .filter(|row| row.meaning.trim().is_empty())
        .map(|row| row.word.as_str())
        .collect();

    // A word with no gloss cannot be practised in a Chinese-to-English mode,
    // so the generated file should not contain any.
    assert!(empty.is_empty(), "words without a gloss: {empty:?}");
}
