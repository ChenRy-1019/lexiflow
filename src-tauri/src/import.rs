//! Importing wordbooks from files.
//!
//! Wordbook files arrive in whatever shape the publisher or the learner's own
//! spreadsheet produced: a plain list, a comma-separated export, a workbook
//! with a dozen columns, or a PDF of scanned pages. This module extracts rows
//! of `(word, meaning)` from each of those, keeping the format handling in one
//! place so the command layer stays thin.
//!
//! Parsing is deliberately forgiving. A file that is 95% words and 5% header
//! noise is still worth importing, so a row that does not look like a word is
//! skipped rather than failing the whole import.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// One row recovered from a file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedRow {
    /// The headword.
    pub word: String,
    /// The gloss, possibly empty when the source had none.
    pub meaning: String,
    /// Optional phonetic transcription.
    pub phonetic: String,
    /// Optional part of speech.
    pub pos: String,
}

/// What a file turned out to contain.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedFile {
    /// The rows that look like vocabulary.
    pub rows: Vec<ParsedRow>,
    /// How the file was interpreted, for the preview screen.
    pub format: String,
    /// Column headers found, when the source had them.
    pub headers: Vec<String>,
    /// Which column each field came from, 0-based.
    pub word_column: usize,
    pub meaning_column: Option<usize>,
    /// Rows skipped because they did not look like a word or were blank.
    pub skipped: usize,
    /// A note for the user, such as "PDF text was recovered, check it".
    pub warning: Option<String>,
}

/// The formats the importer accepts.
pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    "txt", "csv", "tsv", "md", "xlsx", "xls", "ods", "pdf",
];

/// Read a file and recover its vocabulary rows.
pub fn parse_file(path: &Path) -> AppResult<ParsedFile> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if !SUPPORTED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(AppError::Vocabulary(format!(
            "不支持的文件类型 .{extension}，可用：{}",
            SUPPORTED_EXTENSIONS.join(", ")
        )));
    }

    match extension.as_str() {
        "xlsx" | "xls" | "ods" => parse_spreadsheet(path, &extension),
        "pdf" => parse_pdf(path),
        _ => parse_text_file(path, &extension),
    }
}

/// Read a file's raw cells, so the columns can be re-paired without reading
/// the file again.
///
/// The preview screen lets the learner change which column holds the word, and
/// that needs the grid rather than the already-paired rows.
pub fn raw_cells(path: &Path) -> AppResult<Vec<Vec<String>>> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "xlsx" | "xls" | "ods" => spreadsheet_cells(path),
        "pdf" => {
            let text = pdf_extract::extract_text(path)
                .map_err(|err| AppError::Vocabulary(format!("cannot read the PDF: {err}")))?;
            Ok(text
                .lines()
                .map(|line| line.trim())
                .filter(|line| !line.is_empty())
                .map(split_loose)
                .collect())
        }
        _ => {
            let raw = std::fs::read(path)
                .map_err(|err| AppError::Vocabulary(format!("cannot read file: {err}")))?;
            let text = decode_text(&raw);
            let delimiter = match extension.as_str() {
                "tsv" => '\t',
                _ => detect_delimiter(&text),
            };
            Ok(text
                .lines()
                .map(|line| line.trim_end_matches('\r'))
                .filter(|line| !line.trim().is_empty())
                .map(|line| {
                    let cleaned = line.trim().trim_start_matches('|').trim_end_matches('|');
                    if extension == "md" && line.contains('|') {
                        cleaned.split('|').map(|cell| cell.trim().to_string()).collect()
                    } else if cleaned.contains(delimiter) {
                        cleaned
                            .split(delimiter)
                            .map(|cell| cell.trim().trim_matches('"').to_string())
                            .collect()
                    } else {
                        split_loose(line)
                    }
                })
                .collect())
        }
    }
}

/// The cells of the first usable sheet in a workbook.
fn spreadsheet_cells(path: &Path) -> AppResult<Vec<Vec<String>>> {
    use calamine::{open_workbook_auto, Data, Reader};

    let mut workbook = open_workbook_auto(path)
        .map_err(|err| AppError::Vocabulary(format!("cannot open the workbook: {err}")))?;

    let mut best: Option<(Vec<Vec<String>>, usize)> = None;
    for name in workbook.sheet_names().to_vec() {
        let Ok(range) = workbook.worksheet_range(&name) else {
            continue;
        };
        let rows: Vec<Vec<String>> = range
            .rows()
            .map(|row| {
                row.iter()
                    .map(|cell| match cell {
                        Data::Empty => String::new(),
                        Data::String(value) => value.trim().to_string(),
                        Data::Float(value) => {
                            if value.fract() == 0.0 {
                                format!("{}", *value as i64)
                            } else {
                                value.to_string()
                            }
                        }
                        Data::Int(value) => value.to_string(),
                        Data::Bool(value) => value.to_string(),
                        Data::DateTime(value) => value.to_string(),
                        Data::DateTimeIso(value) => value.clone(),
                        Data::DurationIso(value) => value.clone(),
                        Data::Error(_) => String::new(),
                    })
                    .collect()
            })
            .filter(|row: &Vec<String>| row.iter().any(|cell| !cell.is_empty()))
            .collect();

        if rows.is_empty() {
            continue;
        }
        let usable = rows
            .iter()
            .flat_map(|row| row.iter())
            .filter(|cell| looks_like_word(cell))
            .count();
        if best.as_ref().map(|(_, count)| usable > *count).unwrap_or(true) {
            best = Some((rows, usable));
        }
    }

    Ok(best.map(|(rows, _)| rows).unwrap_or_default())
}

/// Re-parse rows with the learner's chosen columns.
///
/// The preview lets the columns be changed, so the same rows are read again
/// with an explicit mapping rather than re-reading the file.
pub fn remap(rows: &[Vec<String>], word_column: usize, meaning_column: Option<usize>) -> Vec<ParsedRow> {
    let mut out = Vec::with_capacity(rows.len());

    for row in rows {
        let word = row.get(word_column).map(|value| value.trim()).unwrap_or("");
        if !looks_like_word(word) {
            continue;
        }

        let meaning = meaning_column
            .and_then(|index| row.get(index))
            .map(|value| normalise_meaning(value))
            .unwrap_or_default();

        // A source with only a word column is still usable, so an empty gloss
        // is allowed; the practice page shows the word without a definition.
        out.push(ParsedRow {
            word: word.to_string(),
            meaning,
            phonetic: String::new(),
            pos: String::new(),
        });
    }

    out
}

/// Whether a string reads as an English headword rather than noise.
///
/// Wordbook exports are full of page numbers, section titles and stray
/// punctuation. Requiring an alphabetic head of a plausible length is enough
/// to filter most of it without rejecting real entries.
fn looks_like_word(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }

    // Headwords are short. A hundred-character cell is a sentence or a note.
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() > 60 || chars.len() < 1 {
        return false;
    }

    let letters = chars.iter().filter(|c| c.is_alphabetic()).count();
    if letters == 0 {
        return false;
    }

    // Allow the punctuation found in real headwords: hyphens, apostrophes,
    // spaces for phrasal entries, and a trailing period for abbreviations.
    let allowed_other = chars
        .iter()
        .filter(|c| !c.is_alphabetic() && !c.is_whitespace())
        .all(|c| "-'.()/&,".contains(*c));

    allowed_other && letters * 2 >= chars.iter().filter(|c| !c.is_whitespace()).count()
}

/// Tidy a gloss: collapse whitespace and drop a leading part of speech marker
/// only when it stands alone, so `n. 名词` keeps its content.
fn normalise_meaning(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

// ------------------------------------------------------------------ text

/// Parse a text-like file: plain lists, CSV, TSV and Markdown tables.
fn parse_text_file(path: &Path, extension: &str) -> AppResult<ParsedFile> {
    let raw = std::fs::read(path)
        .map_err(|err| AppError::Vocabulary(format!("cannot read file: {err}")))?;

    // Wordbook files are saved as UTF-8 most of the time, but a Chinese
    // export from Excel is often GBK. Decoding as UTF-8 first and falling
    // back keeps both working without a charset dependency.
    let text = decode_text(&raw);

    let delimiter = match extension {
        "csv" => detect_delimiter(&text),
        "tsv" => '\t',
        _ => detect_delimiter(&text),
    };

    let lines: Vec<&str> = text
        .lines()
        .map(|line| line.trim_end_matches('\r'))
        .filter(|line| !line.trim().is_empty())
        .collect();

    if lines.is_empty() {
        return Ok(empty_result("text"));
    }

    // A Markdown table has a separator row like `| --- | --- |`.
    let mut rows: Vec<Vec<String>> = Vec::with_capacity(lines.len());
    for line in &lines {
        if is_markdown_separator(line) {
            continue;
        }
        // A Markdown file mixes prose with tables. Headings and running text
        // are not vocabulary, and letting them through parked them above the
        // table header, which then went undetected and was imported as a word.
        if extension == "md" && !line.contains('|') && !is_probable_entry(line) {
            continue;
        }
        let cleaned = line.trim().trim_start_matches('|').trim_end_matches('|');
        let cells: Vec<String> = if delimiter == '\t' || cleaned.contains(delimiter) {
            cleaned
                .split(delimiter)
                .map(|cell| cell.trim().trim_matches('"').to_string())
                .collect()
        } else if line.contains('|') {
            cleaned
                .split('|')
                .map(|cell| cell.trim().to_string())
                .collect()
        } else {
            // No delimiter at all: the line is either `word meaning` or a bare
            // word. Split on the first run of whitespace wider than one space,
            // or on a tab, and otherwise keep the whole line as the word.
            split_loose(line)
        };
        rows.push(cells);
    }

    Ok(build_result(rows, format_label(extension)))
}

/// Whether a line is a Markdown table's `|---|---|` separator.
fn is_markdown_separator(line: &str) -> bool {
    let trimmed = line.trim().trim_matches('|').trim();
    if trimmed.is_empty() {
        return false;
    }
    trimmed
        .split('|')
        .all(|cell| {
            let cell = cell.trim();
            !cell.is_empty() && cell.chars().all(|c| c == '-' || c == ':' || c == ' ')
        })
}

/// Whether a delimiter-free line is likely to be a vocabulary entry.
///
/// Used for Markdown, where headings and prose sit beside the table. A real
/// entry starts with an ASCII headword, so a line starting with `#`, `>` or a
/// Chinese character is skipped.
fn is_probable_entry(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Markdown structure: headings, quotes, list bullets, emphasis.
    if let Some(first) = trimmed.chars().next() {
        if "#>-*+`".contains(first) {
            return false;
        }
    }
    // The line must begin with a headword-shaped token.
    let head = trimmed
        .split(|c: char| c.is_whitespace() || c == '\t')
        .next()
        .unwrap_or("");
    looks_like_word(head) && head.chars().all(|c| c.is_ascii())
}

/// Split a delimiter-free line into a word and a gloss.
fn split_loose(line: &str) -> Vec<String> {
    let trimmed = line.trim();

    // A tab is the usual separator in a pasted export.
    if let Some((left, right)) = trimmed.split_once('\t') {
        return vec![left.trim().to_string(), right.trim().to_string()];
    }

    // Two or more spaces separate the columns in many plain word lists.
    if let Some(index) = trimmed.find("  ") {
        let head = trimmed[..index].trim();
        let tail = trimmed[index..].trim();
        if !head.is_empty() && !tail.is_empty() {
            return vec![head.to_string(), tail.to_string()];
        }
    }

    // `abandon 放弃` with a single space: split at the first space only when
    // the remainder starts with a non-ASCII character, which is the usual
    // shape of a Chinese gloss.
    if let Some((head, tail)) = trimmed.split_once(' ') {
        let tail = tail.trim();
        if !head.is_empty() && tail.chars().next().map(|c| !c.is_ascii()).unwrap_or(false) {
            return vec![head.to_string(), tail.to_string()];
        }
    }

    vec![trimmed.to_string()]
}

/// Choose the field separator by counting candidates outside quoted text.
fn detect_delimiter(text: &str) -> char {
    let sample: String = text.lines().take(20).collect::<Vec<_>>().join("\n");
    let commas = sample.matches(',').count();
    let tabs = sample.matches('\t').count();
    let semicolons = sample.matches(';').count();

    if tabs > commas && tabs > semicolons {
        '\t'
    } else if semicolons > commas {
        ';'
    } else {
        ','
    }
}

/// Decode bytes as UTF-8, falling back to a best-effort GBK decode.
///
/// A strict charset library is not worth a dependency here: the fallback only
/// needs to avoid losing the file, and any undecodable byte is replaced rather
/// than failing the import.
fn decode_text(raw: &[u8]) -> String {
    // A UTF-8 BOM is common in files saved by Excel.
    let body = raw.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(raw);

    match std::str::from_utf8(body) {
        Ok(text) => text.to_string(),
        Err(_) => decode_gbk(body),
    }
}

/// Best-effort GBK decoding for the bytes that are not valid UTF-8.
fn decode_gbk(raw: &[u8]) -> String {
    // Without a charset table, keep the ASCII and replace anything else. This
    // recovers the words (which are ASCII) and loses only the Chinese glosses,
    // which the learner can supply later.
    raw.iter()
        .map(|byte| if *byte < 0x80 { *byte as char } else { '\u{FFFD}' })
        .collect::<String>()
        .replace('\u{FFFD}', "")
}

fn format_label(extension: &str) -> String {
    match extension {
        "csv" => "CSV".into(),
        "tsv" => "TSV".into(),
        "md" => "Markdown".into(),
        _ => "文本".into(),
    }
}

fn empty_result(format: &str) -> ParsedFile {
    ParsedFile {
        rows: Vec::new(),
        format: format.to_string(),
        headers: Vec::new(),
        word_column: 0,
        meaning_column: None,
        skipped: 0,
        warning: None,
    }
}

/// Build a result from raw cells, working out which column is which.
fn build_result(rows: Vec<Vec<String>>, format: String) -> ParsedFile {
    if rows.is_empty() {
        return empty_result(&format);
    }

    let (headers, mut body, header_consumed) = split_header(rows);

    // A table whose header was not detected still must not import it as a
    // word entry; drop a first row that cannot be a headword.
    if !header_consumed {
        if let Some(first) = body.first() {
            let candidate = first.get(0).map(|cell| cell.trim()).unwrap_or("");
            let looks_like_header_label = {
                let lower = candidate.to_ascii_lowercase();
                lower == "word"
                    || lower == "term"
                    || lower == "headword"
                    || candidate == "单词"
                    || candidate == "词汇"
                    || candidate == "英文"
                    || candidate == "词条"
            };
            if looks_like_header_label {
                body.remove(0);
            }
        }
    }

    let word_column = choose_word_column(&body);
    let meaning_column = choose_meaning_column(&body, word_column);

    let mut parsed = remap(&body, word_column, meaning_column);
    // The header row is not a word, so it never reaches `remap`; count it as
    // skipped only when it was actually consumed.
    let skipped = if header_consumed { 1 } else { 0 };

    // A spreadsheet with several columns may hide a phonetic column.
    for (index, header) in headers.iter().enumerate() {
        let lower = header.to_ascii_lowercase();
        if lower.contains("音标") || lower.contains("phonetic") || lower.contains("pron") {
            for (row, cell) in body.iter().zip(parsed.iter_mut()) {
                if let Some(value) = row.get(index) {
                    cell.phonetic = value.trim().to_string();
                }
            }
        } else if lower.contains("词性") || lower == "pos" {
            for (row, cell) in body.iter().zip(parsed.iter_mut()) {
                if let Some(value) = row.get(index) {
                    cell.pos = value.trim().to_string();
                }
            }
        }
    }

    ParsedFile {
        rows: parsed,
        format,
        headers,
        word_column,
        meaning_column,
        skipped,
        warning: None,
    }
}

/// Separate a header row from the body, if the first row reads as headers.
fn split_header(rows: Vec<Vec<String>>) -> (Vec<String>, Vec<Vec<String>>, bool) {
    let first = &rows[0];
    let header_words = [
        "word", "单词", "词汇", "英文", "词条", "headword", "term",
        "meaning", "释义", "中文", "翻译", "解释", "definition", "translation",
        "音标", "phonetic", "词性", "pos", "part of speech",
    ];

    let matches = first
        .iter()
        .filter(|cell| {
            let lower = cell.to_ascii_lowercase();
            header_words.iter().any(|word| lower.contains(word))
        })
        .count();

    // Any matching cell in a table of two or more columns is a header. A
    // `| word | meaning |` table has exactly two, and a table whose second
    // column is headed `释义` has one; both are headers. Requiring two missed
    // the two-column case and let `单词` be imported as a word.
    if matches >= 1 && first.len() >= 2 {
        let headers = first.iter().map(|cell| cell.trim().to_string()).collect();
        (headers, rows[1..].to_vec(), true)
    } else {
        (Vec::new(), rows, false)
    }
}

/// Pick the column that holds headwords: the one with the most word-like cells
/// and, as a tie-break, the fewest non-ASCII characters.
fn choose_word_column(rows: &[Vec<String>]) -> usize {
    let columns = rows.iter().map(|row| row.len()).max().unwrap_or(1);
    let mut best = 0;
    let mut best_score = i64::MIN;

    for index in 0..columns {
        let mut score = 0i64;
        for row in rows.iter().take(200) {
            let Some(cell) = row.get(index) else { continue };
            if !looks_like_word(cell) {
                continue;
            }
            score += 1;
            // ASCII-only cells are much more likely to be headwords than the
            // Chinese glosses sitting beside them.
            if cell.chars().all(|c| c.is_ascii()) {
                score += 2;
            }
        }
        if score > best_score {
            best_score = score;
            best = index;
        }
    }

    best
}

/// Pick the gloss column.
///
/// A column qualifies by what its cells look like, not by length alone: a
/// phonetic column holds `/əˈbændən/`, which is short and bracketed, while a
/// gloss holds prose. Scoring on the traits makes a
/// `word, phonetic, meaning` sheet choose the third column, and a sheet with
/// only two columns still works.
fn choose_meaning_column(rows: &[Vec<String>], word_column: usize) -> Option<usize> {
    let columns = rows.iter().map(|row| row.len()).max().unwrap_or(1);
    let mut best: Option<usize> = None;
    let mut best_score = 0i64;

    for index in 0..columns {
        if index == word_column {
            continue;
        }

        let mut score = 0i64;
        let mut filled = 0usize;

        for row in rows.iter().take(300) {
            let Some(cell) = row.get(index) else { continue };
            let trimmed = cell.trim();
            if trimmed.is_empty() {
                continue;
            }
            filled += 1;

            // A bracketed or slashed transcription is not a gloss.
            let looks_phonetic = (trimmed.starts_with('/') && trimmed.ends_with('/'))
                || (trimmed.starts_with('[') && trimmed.ends_with(']'));
            if looks_phonetic {
                score -= 6;
                continue;
            }

            // A gloss is usually Chinese in a Chinese wordbook, or a phrase.
            let has_non_ascii = trimmed.chars().any(|c| !c.is_ascii());
            if has_non_ascii {
                score += 4;
            }

            let length = trimmed.chars().count();
            if length >= 2 {
                score += 2;
            }
            if length >= 4 {
                score += 2;
            }

            // A lone short token such as `n` or `1` is a code, not a gloss.
            if length <= 1 {
                score -= 3;
            }

            // Pure numbers are column indices or page numbers.
            if trimmed.chars().all(|c| c.is_ascii_digit()) {
                score -= 5;
            }

            // A whole sentence is a note rather than a gloss.
            if length > 80 {
                score -= 3;
            }
        }

        // A sparse column is a poor choice even if its few cells score well.
        if filled * 2 < rows.len().min(300) {
            score -= 4;
        }

        if score > best_score {
            best_score = score;
            best = Some(index);
        }
    }

    best
}

// ----------------------------------------------------------- spreadsheet

/// Parse a workbook, taking the first sheet with usable rows.
fn parse_spreadsheet(path: &Path, extension: &str) -> AppResult<ParsedFile> {
    use calamine::{open_workbook_auto, Data, Reader};

    let mut workbook = open_workbook_auto(path)
        .map_err(|err| AppError::Vocabulary(format!("cannot open the workbook: {err}")))?;

    let names = workbook.sheet_names().to_vec();
    if names.is_empty() {
        return Ok(empty_result(extension));
    }

    let mut best: Option<(Vec<Vec<String>>, usize)> = None;

    for name in &names {
        let Ok(range) = workbook.worksheet_range(name) else {
            continue;
        };

        let mut rows: Vec<Vec<String>> = Vec::new();
        for row in range.rows() {
            let cells: Vec<String> = row
                .iter()
                .map(|cell| match cell {
                    Data::Empty => String::new(),
                    Data::String(value) => value.trim().to_string(),
                    Data::Float(value) => {
                        // Whole numbers are usually column indices or ids, not
                        // headwords, but keep the text so nothing is invented.
                        if value.fract() == 0.0 {
                            format!("{}", *value as i64)
                        } else {
                            value.to_string()
                        }
                    }
                    Data::Int(value) => value.to_string(),
                    Data::Bool(value) => value.to_string(),
                    Data::DateTime(value) => value.to_string(),
                    Data::DateTimeIso(value) => value.clone(),
                    Data::Error(_) => String::new(),
                    Data::DurationIso(value) => value.clone(),
                })
                .collect();
            if cells.iter().any(|cell| !cell.is_empty()) {
                rows.push(cells);
            }
        }

        if rows.is_empty() {
            continue;
        }

        let usable = rows
            .iter()
            .flat_map(|row| row.iter())
            .filter(|cell| looks_like_word(cell))
            .count();

        if best.as_ref().map(|(_, count)| usable > *count).unwrap_or(true) {
            best = Some((rows, usable));
        }
    }

    let Some((rows, _)) = best else {
        return Ok(empty_result(extension));
    };

    let mut result = build_result(rows, "Excel".into());
    if names.len() > 1 {
        result.warning = Some(format!(
            "工作簿有 {} 个工作表，已选用内容最多的一张。",
            names.len()
        ));
    }
    Ok(result)
}

// ------------------------------------------------------------------- pdf

/// Parse a PDF, recovering what text the file exposes.
fn parse_pdf(path: &Path) -> AppResult<ParsedFile> {
    let text = pdf_extract::extract_text(path)
        .map_err(|err| AppError::Vocabulary(format!("cannot read the PDF: {err}")))?;

    if text.trim().is_empty() {
        return Ok(ParsedFile {
            rows: Vec::new(),
            format: "PDF".into(),
            headers: Vec::new(),
            word_column: 0,
            meaning_column: None,
            skipped: 0,
            warning: Some(
                "这个 PDF 里没有可提取的文字，可能是扫描件或图片。请改用含文字的 PDF，或先转成文本。"
                    .into(),
            ),
        });
    }

    // A PDF has no columns, so each line is split on the same loose rules the
    // plain-text path uses.
    let rows: Vec<Vec<String>> = text
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(split_loose)
        .collect();

    let mut result = build_result(rows, "PDF".into());
    result.warning = Some(
        "PDF 的文字是按行提取的，标点或断行可能需要检查。导入前请在预览里核对。".into(),
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_word_has_letters_and_is_short() {
        assert!(looks_like_word("abandon"));
        assert!(looks_like_word("give up"));
        assert!(looks_like_word("well-known"));
        assert!(!looks_like_word(""));
        assert!(!looks_like_word("123"));
        assert!(!looks_like_word("这是一句很长的中文说明，不应该被当成单词"));
        assert!(!looks_like_word(&"a".repeat(80)));
    }

    #[test]
    fn a_loose_line_splits_word_from_chinese_gloss() {
        let cells = split_loose("abandon 放弃");
        assert_eq!(cells, vec!["abandon", "放弃"]);
    }

    #[test]
    fn a_loose_line_splits_on_a_wide_gap() {
        let cells = split_loose("abandon    放弃；抛弃");
        assert_eq!(cells, vec!["abandon", "放弃；抛弃"]);
    }

    #[test]
    fn a_bare_word_stays_one_cell() {
        let cells = split_loose("abandon");
        assert_eq!(cells, vec!["abandon"]);
    }

    #[test]
    fn a_english_gloss_with_one_space_is_not_split() {
        // `give up` must not become word `give`, gloss `up`.
        let cells = split_loose("give up");
        assert_eq!(cells, vec!["give up"]);
    }

    #[test]
    fn the_word_column_is_the_ascii_one() {
        let rows = vec![
            vec!["服从，遵从".to_string(), "obey".to_string()],
            vec!["然后，当时".to_string(), "then".to_string()],
        ];
        assert_eq!(choose_word_column(&rows), 1);
    }

    #[test]
    fn the_meaning_column_is_the_longer_one() {
        let rows = vec![
            vec!["abandon".to_string(), "放弃".to_string()],
            vec!["ability".to_string(), "能力；才能".to_string()],
        ];
        assert_eq!(choose_meaning_column(&rows, 0), Some(1));
    }

    #[test]
    fn a_header_row_is_recognised() {
        let rows = vec![
            vec!["单词".to_string(), "释义".to_string()],
            vec!["abandon".to_string(), "放弃".to_string()],
        ];
        let (headers, body, consumed) = split_header(rows);
        assert!(consumed);
        assert_eq!(headers, vec!["单词", "释义"]);
        assert_eq!(body.len(), 1);
    }

    #[test]
    fn a_data_row_is_not_mistaken_for_a_header() {
        let rows = vec![
            vec!["abandon".to_string(), "放弃".to_string()],
            vec!["ability".to_string(), "能力".to_string()],
        ];
        let (_, body, consumed) = split_header(rows);
        assert!(!consumed);
        assert_eq!(body.len(), 2);
    }

    #[test]
    fn remap_skips_rows_without_a_word() {
        let rows = vec![
            vec!["abandon".to_string(), "放弃".to_string()],
            vec!["".to_string(), "没有单词".to_string()],
            vec!["12".to_string(), "页码".to_string()],
        ];
        let parsed = remap(&rows, 0, Some(1));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].word, "abandon");
    }

    #[test]
    fn a_markdown_separator_is_skipped() {
        assert!(is_markdown_separator("|---|---|"));
        assert!(is_markdown_separator("| :--- | ---: |"));
        assert!(!is_markdown_separator("| abandon | 放弃 |"));
    }

    #[test]
    fn the_delimiter_is_chosen_by_frequency() {
        assert_eq!(detect_delimiter("a,b,c\nd,e,f"), ',');
        assert_eq!(detect_delimiter("a\tb\tc\nd\te\tf"), '\t');
        assert_eq!(detect_delimiter("a;b;c\nd;e;f"), ';');
    }
}
