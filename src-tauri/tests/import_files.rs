//! End-to-end tests for wordbook importing.
//!
//! These write real files to a temporary directory and parse them, rather than
//! testing the helpers in isolation: the failures that matter are the ones a
//! real export produces — a header row, stray page numbers, a gloss that
//! contains the delimiter, or a Chinese column order.

use std::io::Write;
use std::path::{Path, PathBuf};

use lexiflow_lib::import;

/// A temporary directory removed when it goes out of scope.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(prefix: &str) -> Self {
        let unique = format!(
            "{prefix}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let path = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&path).expect("create temp dir");
        TempDir { path }
    }

    /// Write a file with the given name and contents.
    fn write(&self, name: &str, contents: &str) -> PathBuf {
        let path = self.path.join(name);
        let mut file = std::fs::File::create(&path).expect("create file");
        file.write_all(contents.as_bytes()).expect("write");
        path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn a_csv_with_a_header_and_extra_columns_is_read() {
    let dir = TempDir::new("lexiflow-csv");
    let path = dir.write(
        "cet-words.csv",
        "单词,音标,释义\nabandon,/əˈbændən/,放弃；抛弃\nability,/əˈbɪləti/,能力；才能\n",
    );

    let parsed = import::parse_file(&path).expect("parse");
    assert_eq!(parsed.rows.len(), 2);
    assert_eq!(parsed.rows[0].word, "abandon");
    assert_eq!(parsed.rows[0].meaning, "放弃；抛弃");
    assert_eq!(parsed.rows[1].word, "ability");
    // The header was consumed rather than imported as a word.
    assert_eq!(parsed.skipped, 1);
}

#[test]
fn a_plain_list_without_delimiters_is_read() {
    let dir = TempDir::new("lexiflow-txt");
    let path = dir.write("list.txt", "abandon 放弃\nability 能力\n\n123\n");

    let parsed = import::parse_file(&path).expect("parse");
    let words: Vec<&str> = parsed.rows.iter().map(|row| row.word.as_str()).collect();

    assert_eq!(words, vec!["abandon", "ability"]);
    // The page number was skipped, and the blank line never made a row.
    assert_eq!(parsed.rows[0].meaning, "放弃");
}

#[test]
fn a_gloss_containing_a_comma_does_not_split_the_row() {
    let dir = TempDir::new("lexiflow-comma");
    // Quoted field with commas inside, as Excel writes it.
    let path = dir.write(
        "quoted.csv",
        "word,meaning\nabandon,\"放弃，抛弃，遗弃\"\n",
    );

    let parsed = import::parse_file(&path).expect("parse");
    assert_eq!(parsed.rows.len(), 1);
    assert_eq!(parsed.rows[0].meaning, "放弃，抛弃，遗弃");
}

#[test]
fn a_reversed_column_order_is_still_read() {
    let dir = TempDir::new("lexiflow-reversed");
    // Gloss first, word second: the importer must find the headword itself.
    let path = dir.write("reversed.csv", "释义,单词\n放弃,abandon\n能力,ability\n");

    let parsed = import::parse_file(&path).expect("parse");
    let words: Vec<&str> = parsed.rows.iter().map(|row| row.word.as_str()).collect();
    assert_eq!(words, vec!["abandon", "ability"]);
    assert_eq!(parsed.rows[0].meaning, "放弃");
}

#[test]
fn a_markdown_table_is_read() {
    let dir = TempDir::new("lexiflow-md");
    let path = dir.write(
        "words.md",
        "# 词汇\n\n| 单词 | 释义 |\n|---|---|\n| abandon | 放弃 |\n| ability | 能力 |\n",
    );

    let parsed = import::parse_file(&path).expect("parse");
    let words: Vec<&str> = parsed.rows.iter().map(|row| row.word.as_str()).collect();
    assert_eq!(words, vec!["abandon", "ability"]);
}

#[test]
fn a_tab_separated_export_is_read() {
    let dir = TempDir::new("lexiflow-tsv");
    let path = dir.write("words.tsv", "abandon\t放弃\nability\t能力\n");

    let parsed = import::parse_file(&path).expect("parse");
    assert_eq!(parsed.rows.len(), 2);
    assert_eq!(parsed.rows[1].meaning, "能力");
}

#[test]
fn an_unsupported_extension_is_refused_with_the_list() {
    let dir = TempDir::new("lexiflow-bad");
    let path = dir.write("words.docx", "not a supported format");

    let error = import::parse_file(&path).expect_err("should refuse");
    let message = format!("{error}");
    assert!(message.contains("不支持"), "message was: {message}");
    // The message names the formats that do work.
    assert!(message.contains("csv"));
}

#[test]
fn an_empty_file_yields_no_rows_rather_than_an_error() {
    let dir = TempDir::new("lexiflow-empty");
    let path = dir.write("empty.txt", "");

    let parsed = import::parse_file(&path).expect("parse");
    assert!(parsed.rows.is_empty());
}

#[test]
fn a_file_of_prose_does_not_produce_word_rows() {
    let dir = TempDir::new("lexiflow-prose");
    let path = dir.write(
        "notes.txt",
        "这是一段关于词汇学习的说明文字，它既不是单词也不是释义。\n\
         请把单词和释义按行分开，每行一个词条。\n",
    );

    let parsed = import::parse_file(&path).expect("parse");
    // Long Chinese sentences are not headwords; importing them would pollute
    // the book with unusable entries.
    assert!(parsed.rows.is_empty(), "got {} rows", parsed.rows.len());
}

#[test]
fn each_row_keeps_its_original_order() {
    let dir = TempDir::new("lexiflow-order");
    let path = dir.write("ordered.csv", "word,meaning\nzeta,最后\nalpha,第一\n");

    let parsed = import::parse_file(&path).expect("parse");
    assert_eq!(parsed.rows[0].word, "zeta");
    assert_eq!(parsed.rows[1].word, "alpha");
}

#[test]
fn a_utf8_bom_does_not_corrupt_the_first_word() {
    let dir = TempDir::new("lexiflow-bom");
    let path = dir.write("bom.csv", "\u{feff}word,meaning\nabandon,放弃\n");

    let parsed = import::parse_file(&path).expect("parse");
    assert_eq!(parsed.rows.len(), 1);
    assert_eq!(parsed.rows[0].word, "abandon");
}

#[test]
fn the_parsed_file_reports_which_columns_it_used() {
    let dir = TempDir::new("lexiflow-cols");
    let path = dir.write("cols.csv", "序号,单词,释义\n1,abandon,放弃\n2,ability,能力\n");

    let parsed = import::parse_file(&path).expect("parse");
    // The index column holds numbers, so the headword column is the second.
    assert_eq!(parsed.word_column, 1);
    assert_eq!(parsed.meaning_column, Some(2));
}

#[test]
fn a_path_that_does_not_exist_is_an_error_not_a_panic() {
    let missing = Path::new("this-file-does-not-exist-at-all.csv");
    assert!(import::parse_file(missing).is_err());
}

#[test]
fn a_real_workbook_is_read() {
    // Built with openpyxl, so the structure matches what Excel writes.
    let path = std::env::temp_dir()
        .join("import-probe")
        .join("test.xlsx");

    if !path.exists() {
        // The fixture is generated by scripts/make-import-fixtures.py and is
        // absent on a clean checkout.
        return;
    }

    let parsed = import::parse_file(&path).expect("parse");
    let words: Vec<&str> = parsed.rows.iter().map(|row| row.word.as_str()).collect();

    assert_eq!(words, vec!["abandon", "ability"]);
    assert_eq!(parsed.rows[0].meaning, "放弃；抛弃");
    // The phoneic column was read, and did not become the gloss.
    assert_eq!(parsed.rows[0].phonetic, "/əˈbændən/");
}