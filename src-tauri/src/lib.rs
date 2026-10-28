//! LexiFlow backend.
//!
//! The backend owns three pieces of state:
//!
//! * the bundled [`lexicon::Lexicon`], which is read-only and shared;
//! * the SQLite [`db::Db`], which holds everything the learner produces;
//! * the FSRS scheduler, which lives in the frontend and decides when a word
//!   should come back.
//!
//! The split keeps the Rust side focused on persistence while the scheduling
//! maths stays in one place, in TypeScript, where it can be unit tested with
//! the same code the UI uses.

mod audio;
mod db;
mod error;
pub mod import;
mod lexicon;
mod session;
mod util;

/// The storage types, re-exported so integration tests can use them.
pub mod testing {
    pub use crate::db::{Card, DashboardStats, Db, NotebookItem, ReviewLog};
    pub use crate::lexicon::{Entry, Lexicon, Wordbook};
    pub use crate::session::{
        build_session, build_all, longest_streak, record_review, due_count, mastered_count, started_count,
        PendingSession, ReviewInput, ReviewOutcome, Scope, SessionItem,
    };
    pub use crate::db::{CustomBook, CustomEntry};
    pub use crate::{search_any, resolve_one};
}

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use db::{Card, DashboardStats, Db, NotebookItem, ReviewLog};
use error::{AppError, AppResult};
use lexicon::{Entry, SharedLexicon, Wordbook};
use util::now_ms;

/// The MASTERY_THRESHOLD constant lives in `src/lib/fsrs.ts`; keep the two
/// in sync so the backend's aggregate counts match the frontend's.
pub const MASTERY_THRESHOLD: i64 = 2;

/// Application state, owned by Tauri.
pub struct AppState {
    pub db: Mutex<Db>,
    pub lexicon: SharedLexicon,
    /// Downloaded pronunciation recordings.
    pub audio: audio::AudioCache,
}

/// A wordbook plus its live counters.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookWithStats {
    #[serde(flatten)]
    pub book: Wordbook,
    /// Words the learner has started.
    pub started: usize,
    /// Words the learner has mastered.
    pub mastered: usize,
}

/// One queued question.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyItem {
    pub entry: Entry,
    /// Whether this word is already scheduled for review.
    pub is_review: bool,
    /// Current FSRS card, `None` for a brand new word.
    pub card: Option<serde_json::Value>,
    /// Estimated probability of still remembering the word, 0..1.
    pub retrievability: f64,
}

/// The payload the practice page needs for one question.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyQuestion {
    pub item: StudyItem,
    /// The four answer choices for the multiple-choice mode.
    pub choices: Vec<Choice>,
}

/// One multiple-choice option.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub entry_id: String,
    pub text: String,
    pub correct: bool,
}

/// The result of grading one answer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradedAnswer {
    pub correct: bool,
    pub expected: String,
    pub typed: String,
    /// Per-letter correctness, aligned with `typed`.
    pub marks: Vec<bool>,
    pub mastered: bool,
    pub correct_count: i64,
}

/// Request to build a study session.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyRequest {
    /// Wordbook to draw from. Empty means every wordbook.
    #[serde(default)]
    pub book_id: String,
    /// `mix`, `new` or `review`.
    #[serde(default)]
    pub scope: String,
    /// Maximum number of questions.
    #[serde(default = "default_limit")]
    pub limit: usize,
    /// The learner's UTC offset in minutes.
    #[serde(default)]
    pub local_offset_minutes: i64,
    /// An explicit pool of entry ids, used when studying the notebook.
    ///
    /// When present these ids are the pool and `book_id` is ignored, so the
    /// notebook does not have to be mapped onto a wordbook first.
    #[serde(default)]
    pub entry_ids: Vec<String>,
    /// Practise every id in the pool, ignoring the review schedule.
    ///
    /// A word saved to the notebook should be available on demand rather than
    /// only when FSRS says it is due.
    #[serde(default)]
    pub force_all: bool,
}

/// Request to record a completed review.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRequest {
    pub entry_id: String,
    /// 1 = Again, 2 = Hard, 3 = Good, 4 = Easy.
    pub rating: i64,
    /// The mode the review happened in.
    #[serde(default)]
    pub mode: String,
    /// How long the learner took, in milliseconds.
    #[serde(default)]
    pub duration_ms: i64,
    /// The learner's UTC offset in minutes.
    #[serde(default)]
    pub local_offset_minutes: i64,
    /// An explicit pool of entry ids, used when studying the notebook.
    ///
    /// When present these ids are the pool and `book_id` is ignored, so the
    /// notebook does not have to be mapped onto a wordbook first.
    #[serde(default)]
    pub entry_ids: Vec<String>,
    /// Practise every id in the pool, ignoring the review schedule.
    ///
    /// A word saved to the notebook should be available on demand rather than
    /// only when FSRS says it is due.
    #[serde(default)]
    pub force_all: bool,
}

/// Export of the learner's whole history.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub version: u32,
    pub exported_at: i64,
    pub cards: Vec<Card>,
    pub logs: Vec<ReviewLog>,
    pub notebook: Vec<NotebookItem>,
}

fn default_limit() -> usize {
    20
}

/// Compute the day buckets for the weekly chart.
fn weekly_counts(logs: &[ReviewLog], local_offset_minutes: i64) -> Vec<i64> {
    let offset_ms = local_offset_minutes * 60_000;
    let mut buckets = std::collections::BTreeMap::new();

    for log in logs {
        // Only successful reviews count towards the daily goal.
        if log.rating < 3 {
            continue;
        }
        let key = util::day_key(log.at, offset_ms);
        *buckets.entry(key).or_insert(0i64) += 1;
    }

    let today = util::day_key(util::now_ms(), offset_ms);
    let mut result = Vec::with_capacity(7);
    for offset in (0..7).rev() {
        let start = util::day_start_ms(offset, offset_ms);
        let key = util::day_key(start, offset_ms);
        let _ = today;
        result.push(*buckets.get(&key).unwrap_or(&0));
    }
    result
}

/// Compute the current streak of consecutive study days.
fn streak_length(logs: &[ReviewLog], local_offset_minutes: i64) -> i64 {
    let offset_ms = local_offset_minutes * 60_000;
    let mut days: std::collections::HashSet<String> = std::collections::HashSet::new();
    for log in logs {
        if log.rating >= 3 {
            days.insert(util::day_key(log.at, offset_ms));
        }
    }
    if days.is_empty() {
        return 0;
    }

    let mut streak = 0i64;
    // Today counts towards the streak even before the first review of the day.
    for offset in 0..3650 {
        let key = util::day_key(util::day_start_ms(offset, offset_ms), offset_ms);
        if days.contains(&key) {
            streak += 1;
        } else if offset > 0 {
            break;
        }
    }
    streak
}

/// Build the dashboard counters.
#[tauri::command]
fn dashboard_stats(
    state: State<'_, AppState>,
    local_offset_minutes: i64,
) -> AppResult<DashboardStats> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    let cards = db.all_cards()?;
    let offset_ms = local_offset_minutes * 60_000;
    let now = util::now_ms();

    let today_key = util::day_key(now, offset_ms);
    let mut today_new = 0i64;

    for card in cards.values() {
        if card.first_seen_at > 0
            && util::day_key(card.first_seen_at, offset_ms) == today_key
        {
            today_new += 1;
        }
    }

    let due_count = session::due_count(&cards, now) as i64;
    let started = session::started_count(&cards) as i64;
    let mastered = session::mastered_count(&cards) as i64;

    let since = util::day_start_ms(6, offset_ms);
    let logs = db.logs_since(since)?;
    let weekly = weekly_counts(&logs, local_offset_minutes);
    let streak = streak_length(&logs, local_offset_minutes);
    let study_seconds = db.total_study_seconds()?;

    // A review is a log entry; an accurate one was rated 3 or 4, which is what
    // the practice page sends when the answer was right.
    let week_reviews = logs.len() as i64;
    let week_correct = logs.iter().filter(|log| log.rating >= 3).count() as i64;
    let week_accuracy = if week_reviews > 0 {
        (week_correct * 100 + week_reviews / 2) / week_reviews
    } else {
        0
    };

    // The streak only covers the recent window, so the best run needs the full
    // log history.
    let all_logs = db.logs_since(0)?;
    let best_streak = session::longest_streak(&all_logs, local_offset_minutes);

    Ok(DashboardStats {
        today_new,
        due_count,
        started,
        mastered,
        streak,
        weekly,
        study_seconds,
        week_reviews,
        week_accuracy,
        best_streak,
    })
}

/// Read an optional column index that may arrive as null.
///
/// The frontend sends `null` for "not chosen", which serde would reject for a
/// `Option<usize>` read through a plain default.
fn deserialize_optional_index<'de, D>(deserializer: D) -> Result<Option<usize>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<i64>::deserialize(deserializer)?;
    Ok(value.and_then(|number| if number < 0 { None } else { Some(number as usize) }))
}

/// A request to preview a file before importing it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewRequest {
    /// Absolute path of the file to read.
    pub path: String,
    /// Which column holds the headword, when the learner changed it.
    #[serde(default, deserialize_with = "deserialize_optional_index")]
    pub word_column: Option<usize>,
    /// Which column holds the gloss.
    #[serde(default, deserialize_with = "deserialize_optional_index")]
    pub meaning_column: Option<usize>,
}

/// What a preview found, plus the rows to import.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    /// The rows that would be imported.
    pub rows: Vec<import::ParsedRow>,
    /// How the file was read, shown in the dialog.
    pub format: String,
    /// Column headers, empty when the file had none.
    pub headers: Vec<String>,
    pub word_column: usize,
    pub meaning_column: Option<usize>,
    /// Rows set aside as not vocabulary.
    pub skipped: usize,
    /// A note for the learner, such as a PDF extraction warning.
    pub warning: Option<String>,
    /// A suggested name for the book, taken from the file name.
    pub suggested_name: String,
}

/// Look up entries by id across both the bundled and imported vocabulary.
///
/// Every command that turns a stored id back into a word goes through here,
/// so an imported book behaves exactly like a built-in one: study sessions,
/// the notebook and the choice options all see it.
fn resolve_any(db: &Db, state_lexicon: &lexicon::Lexicon, ids: &[String]) -> Vec<Entry> {
    let mut out: Vec<Entry> = Vec::with_capacity(ids.len());
    let mut missing: Vec<String> = Vec::new();

    for id in ids {
        match state_lexicon.entry(id) {
            Some(entry) => out.push(entry.clone()),
            None => missing.push(id.clone()),
        }
    }

    if !missing.is_empty() {
        // Imported entries live in the database; a single query covers them.
        if let Ok(imported) = db.custom_entries_by_ids(&missing) {
            out.extend(imported.into_iter().map(|entry| Entry {
                id: entry.entry_id,
                word: entry.word,
                meaning: entry.meaning,
                pos: entry.pos,
                phonetic: entry.phonetic,
                example: String::new(),
                example_zh: String::new(),
                phrase: false,
                etymology: String::new(),
            }));
        }
    }

    out
}

/// Search the bundled vocabulary and the imported books together.
///
/// The bundled search is a linear scan over a hash map, which is fine for a
/// query the learner typed; the imported side is a small table, so a simple
/// case-insensitive match over its rows is enough. Both are limited to the
/// same cap so the result list stays predictable.
pub fn search_any(db: &Db, state_lexicon: &lexicon::Lexicon, query: &str, limit: usize) -> Vec<Entry> {
    let mut hits = state_lexicon.search(query, limit);

    let needle = crate::util::normalise_answer(query);
    let trimmed = query.trim();
    if needle.is_empty() {
        return hits;
    }

    // Imported rows are matched on the headword and the gloss, the same rule
    // the bundled search uses.
    if let Ok(imported) = db.all_custom_entries() {
        for entry in imported {
            if hits.len() >= limit {
                break;
            }
            let head = crate::util::normalise_answer(&entry.word);
            if head.contains(&needle) || entry.meaning.contains(trimmed) {
                hits.push(Entry {
                    id: entry.entry_id,
                    word: entry.word,
                    meaning: entry.meaning,
                    pos: entry.pos,
                    phonetic: entry.phonetic,
                    example: String::new(),
                    example_zh: String::new(),
                    phrase: false,
                    etymology: String::new(),
                });
            }
        }
    }

    hits.sort_by(|a, b| a.word.to_lowercase().cmp(&b.word.to_lowercase()));

    // A word lives in every wordbook that lists it, so the same headword can
    // arrive several times. Keep the first of each, which is the bundled copy
    // with its fuller gloss, and drop the repeats.
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    hits.retain(|entry| seen.insert(entry.word.to_lowercase()));

    hits.truncate(limit);
    hits
}

/// Look up one entry by id across both sources.
pub fn resolve_one(db: &Db, state_lexicon: &lexicon::Lexicon, id: &str) -> Option<Entry> {
    resolve_any(db, state_lexicon, &[id.to_string()]).into_iter().next()
}

/// List every wordbook with live counters.
#[tauri::command]
fn list_books(state: State<'_, AppState>) -> AppResult<Vec<BookWithStats>> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    let cards = db.all_cards()?;

    let mut books = Vec::with_capacity(state.lexicon.books().len());

    // Bundled books.
    for book in state.lexicon.books() {
        let ids = state.lexicon.book_entries(&book.id);
        books.push(BookWithStats {
            book: book.clone(),
            started: 0,
            mastered: 0,
        });
        if let Some(last) = books.last_mut() {
            for id in ids {
                if let Some(card) = cards.get(id) {
                    if card.first_seen_at > 0 {
                        last.started += 1;
                    }
                    if card.mastered {
                        last.mastered += 1;
                    }
                }
            }
        }
    }

    // Imported books sit beside them, marked so the interface can offer a
    // delete action that the bundled books do not have.
    for imported in db.custom_books()? {
        let entries = db.custom_entries(&imported.id)?;
        let mut started = 0usize;
        let mut mastered = 0usize;
        for entry in &entries {
            if let Some(card) = cards.get(&entry.entry_id) {
                if card.first_seen_at > 0 {
                    started += 1;
                }
                if card.mastered {
                    mastered += 1;
                }
            }
        }

        books.push(BookWithStats {
            book: Wordbook {
                id: imported.id,
                name: imported.name,
                category: "我的词书".into(),
                short: imported.format,
                description: if imported.source.is_empty() {
                    "导入的词书".into()
                } else {
                    format!("导入自 {}", imported.source)
                },
                total: imported.total,
            },
            started,
            mastered,
        });
    }

    Ok(books)
}

/// Read a wordbook file and report what it contains, without importing it.
///
/// The dialog shows this so the learner can check the columns and the count
/// before anything is written.
#[tauri::command]
fn preview_import(request: ImportPreviewRequest) -> AppResult<ImportPreview> {
    let path = std::path::Path::new(&request.path);
    let mut parsed = import::parse_file(path)?;

    // When the learner overrides a column, the rows are rebuilt from the raw
    // cells with that mapping. Re-parsing is cheap next to re-reading the
    // file, and it keeps one code path for pairing words with glosses.
    if let Some(word_column) = request.word_column {
        let meaning_column = request.meaning_column;
        let cells = import::raw_cells(path)?;
        parsed.rows = import::remap(&cells, word_column, meaning_column);
        parsed.word_column = word_column;
        parsed.meaning_column = meaning_column;
    }

    let suggested_name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("我的词书")
        .to_string();

    Ok(ImportPreview {
        rows: parsed.rows,
        format: parsed.format,
        headers: parsed.headers,
        word_column: parsed.word_column,
        meaning_column: parsed.meaning_column,
        skipped: parsed.skipped,
        warning: parsed.warning,
        suggested_name,
    })
}

/// Store a set of parsed rows as a new wordbook.
#[tauri::command]
fn import_book(
    state: State<'_, AppState>,
    name: String,
    source: String,
    format: String,
    rows: Vec<import::ParsedRow>,
) -> AppResult<db::CustomBook> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::Vocabulary("词书需要一个名字".into()));
    }
    if rows.is_empty() {
        return Err(AppError::Vocabulary("没有可导入的词条".into()));
    }

    let now = util::now_ms();
    // The id carries the timestamp so two books with the same name do not
    // collide, and entry ids are namespaced by it so a word in this book is
    // tracked separately from the same word in a built-in book.
    let book_id = format!("import-{now}");

    let entries: Vec<db::CustomEntry> = rows
        .iter()
        .enumerate()
        .map(|(index, row)| db::CustomEntry {
            entry_id: format!("{book_id}-{index}"),
            word: row.word.clone(),
            meaning: row.meaning.clone(),
            phonetic: row.phonetic.clone(),
            pos: row.pos.clone(),
        })
        .collect();

    let book = db::CustomBook {
        id: book_id,
        name: trimmed_name.to_string(),
        source,
        format,
        imported_at: now,
        total: entries.len(),
    };

    let mut db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    db.insert_custom_book(&book, &entries)?;
    Ok(book)
}

/// Delete an imported wordbook and its entries.
#[tauri::command]
fn delete_book(state: State<'_, AppState>, book_id: String) -> AppResult<()> {
    let mut db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    db.delete_custom_book(&book_id)
}

/// List the entries of a wordbook.
#[tauri::command]
fn book_entries(state: State<'_, AppState>, book_id: String) -> AppResult<Vec<Entry>> {
    // A bundled book resolves from memory; anything else is looked up among
    // the imported books.
    let bundled = state.lexicon.book_entries(&book_id);
    if !bundled.is_empty() {
        return Ok(state.lexicon.resolve(bundled));
    }

    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    Ok(db
        .custom_entries(&book_id)?
        .into_iter()
        .map(|entry| Entry {
            id: entry.entry_id,
            word: entry.word,
            meaning: entry.meaning,
            pos: entry.pos,
            phonetic: entry.phonetic,
            example: String::new(),
            example_zh: String::new(),
            phrase: false,
            etymology: String::new(),
        })
        .collect())
}

/// Search the whole vocabulary.
#[tauri::command]
fn search_entries(state: State<'_, AppState>, query: String) -> AppResult<Vec<Entry>> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    Ok(search_any(&db, &state.lexicon, &query, 200))
}

/// Resolve a list of entry ids back into their dictionary entries.
///
/// The notebook stores only ids, so the page needs a way to turn them back
/// into words and glosses for display.
#[tauri::command]
fn resolve_entries(state: State<'_, AppState>, entry_ids: Vec<String>) -> AppResult<Vec<Entry>> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    Ok(resolve_any(&db, &state.lexicon, &entry_ids))
}

/// Build the next study session.
#[tauri::command]
fn build_session(
    state: State<'_, AppState>,
    request: StudyRequest,
) -> AppResult<Vec<StudyItem>> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    let cards = db.all_cards()?;
    let now = util::now_ms();

    let ids: Vec<String> = if !request.entry_ids.is_empty() {
        // The caller supplied the pool, so no wordbook lookup is needed.
        request.entry_ids.clone()
    } else if request.book_id.is_empty() {
        let mut all = Vec::new();
        for book in state.lexicon.books() {
            all.extend(state.lexicon.book_entries(&book.id).iter().cloned());
        }
        // "全部词书" includes what the learner imported.
        for entry in db.all_custom_entries()? {
            all.push(entry.entry_id);
        }
        all
    } else {
        let bundled = state.lexicon.book_entries(&request.book_id);
        if bundled.is_empty() {
            db.custom_entries(&request.book_id)?
                .into_iter()
                .map(|entry| entry.entry_id)
                .collect()
        } else {
            bundled.to_vec()
        }
    };

    let scope = session::Scope::parse(&request.scope);
    let selected = if request.force_all {
        // Study the pool as it stands: the notebook asks for practice, not for
        // whatever happens to be due.
        session::build_all(&ids, &cards, request.limit)
    } else {
        session::build_session(&ids, &cards, scope, request.limit, now)
    };

    Ok(selected
        .iter()
        .filter_map(|item| {
            let entry = resolve_one(&db, &state.lexicon, &item.entry_id)?;
            let card = cards.get(&item.entry_id);
            Some(StudyItem {
                entry,
                is_review: item.is_review && card.map(|c| c.due > 0).unwrap_or(false),
                card: card.and_then(|c| {
                    c.card
                        .as_ref()
                        .and_then(|raw| serde_json::from_str(raw).ok())
                }),
                retrievability: 1.0,
            })
        })
        .collect())
}

/// Build the multiple-choice options for one question.
#[tauri::command]
fn build_choices(
    state: State<'_, AppState>,
    entry_id: String,
    book_id: String,
) -> AppResult<Vec<Choice>> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;

    // The word may be bundled or imported; one lookup covers both.
    let entry = resolve_one(&db, &state.lexicon, &entry_id)
        .ok_or_else(|| AppError::Vocabulary(format!("unknown entry {entry_id}")))?;

    // The question's own book first, so the distractors come from nearby
    // vocabulary rather than a random corner of the dictionary.
    let mut pool: Vec<Entry> = {
        let bundled = state.lexicon.book_entries(&book_id);
        if !bundled.is_empty() {
            state.lexicon.resolve(bundled)
        } else {
            db.custom_entries(&book_id)?
                .into_iter()
                .map(|item| Entry {
                    id: item.entry_id,
                    word: item.word,
                    meaning: item.meaning,
                    pos: item.pos,
                    phonetic: item.phonetic,
                    example: String::new(),
                    example_zh: String::new(),
                    phrase: false,
                    etymology: String::new(),
                })
                .collect()
        }
    };
    pool.retain(|candidate| candidate.phrase == entry.phrase);

    if pool.len() < 8 {
        // Widen to the whole vocabulary, imported books included. The ids are
        // gathered from both sources and resolved together, so a word in an
        // imported book gets distractors as readily as a bundled one.
        let mut all: Vec<String> = Vec::new();
        for book in state.lexicon.books() {
            all.extend(state.lexicon.book_entries(&book.id).iter().cloned());
        }
        for item in db.all_custom_entries()? {
            all.push(item.entry_id);
        }

        pool = resolve_any(&db, &state.lexicon, &all)
            .into_iter()
            .filter(|candidate| candidate.phrase == entry.phrase && candidate.id != entry_id)
            .collect();
    }

    // Pick three random distractors from the pool.
    let mut distractors: Vec<Entry> = pool
        .into_iter()
        .filter(|candidate| candidate.id != entry_id && candidate.meaning != entry.meaning)
        .collect();

    // Shuffle and take 3 for variety.
    let mut rng = distractors.len();
    let mut seed = (distractors.len() as u64) ^ (entry_id.len() as u64) ^ (now_ms() as u64);
    while rng > 1 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let target = (seed >> 33) as usize % rng;
        rng -= 1;
        distractors.swap(rng, target);
    }

    let mut choices: Vec<Choice> = distractors
        .iter()
        .take(3)
        .map(|candidate| Choice {
            entry_id: candidate.id.clone(),
            text: candidate.meaning.clone(),
            correct: false,
        })
        .collect();

    choices.push(Choice {
        entry_id: entry.id.clone(),
        text: entry.meaning.clone(),
        correct: true,
    });

    // Fisher-Yates so the answer is not always last.
    let mut seed = (choices.len() as u64) ^ (entry_id.len() as u64) ^ (now_ms() as u64);
    for index in (1..choices.len()).rev() {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let target = (seed >> 33) as usize % (index + 1);
        choices.swap(index, target);
    }

    Ok(choices)
}

/// Grade a free-text answer and record the review.
///
/// The FSRS maths happens in the frontend; the backend stores the resulting
/// card so that the schedule survives a restart.
#[tauri::command]
fn record_review(
    state: State<'_, AppState>,
    request: ReviewRequest,
    card_json: Option<String>,
    due: i64,
    state_value: i64,
    correct: bool,
) -> AppResult<GradedAnswer> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    let now = util::now_ms();

    // The word may be bundled or imported. Looking it up in the bundled
    // lexicon alone made rating an imported word fail, which stopped the
    // practice page from advancing at all.
    let entry = resolve_one(&db, &state.lexicon, &request.entry_id)
        .ok_or_else(|| AppError::Vocabulary(format!("unknown entry {}", request.entry_id)))?;

    let outcome = session::record_review(
        &db,
        session::ReviewInput {
            entry_id: &request.entry_id,
            expected: &entry.word,
            card_json,
            due,
            state: state_value,
            correct,
            rating: request.rating,
            mode: &request.mode,
            duration_ms: request.duration_ms,
        },
        now,
    );

    Ok(GradedAnswer {
        correct: outcome.correct,
        expected: outcome.expected,
        typed: String::new(),
        marks: Vec::new(),
        mastered: outcome.mastered,
        correct_count: outcome.correct_count,
    })
}

/// Save a word to the notebook.
#[tauri::command]
fn add_to_notebook(state: State<'_, AppState>, entry_id: String) -> AppResult<()> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    db.add_to_notebook(&entry_id, util::now_ms())
}

/// Remove a word from the notebook.
#[tauri::command]
fn remove_from_notebook(state: State<'_, AppState>, entry_id: String) -> AppResult<()> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    db.remove_from_notebook(&entry_id)
}

/// List the notebook.
#[tauri::command]
fn list_notebook(state: State<'_, AppState>) -> AppResult<Vec<NotebookItem>> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    db.notebook()
}

/// Read every stored card, so the frontend can compute schedules locally.
#[tauri::command]
fn all_cards(state: State<'_, AppState>) -> AppResult<HashMap<String, Card>> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    db.all_cards()
}

/// Export the learner's history.
#[tauri::command]
fn export_backup(state: State<'_, AppState>) -> AppResult<Backup> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    let cards: Vec<Card> = db.all_cards()?.into_values().collect();
    let logs = db.logs_since(0)?;
    let notebook = db.notebook()?;

    Ok(Backup {
        version: 1,
        exported_at: util::now_ms(),
        cards,
        logs,
        notebook,
    })
}

/// Import a previously exported history, merging into the current one.
#[tauri::command]
fn import_backup(state: State<'_, AppState>, backup: Backup) -> AppResult<()> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    for card in backup.cards {
        db.upsert_card(&card)?;
    }
    for log in backup.logs {
        db.add_log(&log)?;
    }
    for item in backup.notebook {
        db.add_to_notebook(&item.entry_id, item.added_at)?;
    }
    Ok(())
}

/// Record time spent studying.
#[tauri::command]
fn record_study_time(state: State<'_, AppState>, seconds: i64) -> AppResult<()> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    db.record_session(seconds)
}

/// Wipe learning progress.
#[tauri::command]
fn reset_progress(state: State<'_, AppState>) -> AppResult<()> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    db.reset_progress()
}

/// Read a setting.
#[tauri::command]
fn get_setting(state: State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    db.setting(&key)
}

/// Write a setting.
#[tauri::command]
fn set_setting(state: State<'_, AppState>, key: String, value: String) -> AppResult<()> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    db.set_setting(&key, &value)
}

/// Where the database lives, shown in the settings page.
#[tauri::command]
fn database_path(state: State<'_, AppState>) -> AppResult<String> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    Ok(db.path().display().to_string())
}

/// Total number of bundled entries.
#[tauri::command]
fn lexicon_total(state: State<'_, AppState>) -> AppResult<usize> {
    Ok(state.lexicon.total_entries())
}

/// Get the pronunciation of a word.
///
/// A cached recording is returned when there is one. Otherwise the recording
/// is downloaded and cached; if that fails the caller is told to use the
/// system voice instead.
#[tauri::command]
fn pronounce(
    state: State<'_, AppState>,
    word: String,
    accent: String,
) -> audio::Pronunciation {
    let accent = audio::Accent::parse(&accent);

    match state.audio.fetch(&word, accent) {
        Ok(path) => match state.audio.read_base64(&path) {
            Ok(data) => audio::Pronunciation::Cached { data },
            // The file was written but cannot be read back, so fall back to
            // the system voice rather than failing outright.
            Err(_) => audio::Pronunciation::System {
                text: word.trim().to_string(),
            },
        },
        // The system voice always works, so it is the fallback rather than
        // an error the learner has to deal with.
        Err(_) => audio::Pronunciation::System {
            text: word.trim().to_string(),
        },
    }
}

/// Whether a word already has a cached recording.
#[tauri::command]
fn has_recording(state: State<'_, AppState>, word: String, accent: String) -> bool {
    state.audio.is_cached(&word, audio::Accent::parse(&accent))
}

/// How many recordings are cached, and how much space they take.
#[tauri::command]
fn audio_cache_info(state: State<'_, AppState>) -> AudioCacheInfo {
    AudioCacheInfo {
        count: state.audio.count(),
        size_bytes: state.audio.size(),
        directory: state.audio.root().to_string_lossy().to_string(),
    }
}

/// Remove every cached recording.
#[tauri::command]
fn clear_audio_cache(state: State<'_, AppState>) -> AppResult<()> {
    state.audio.clear()
}

/// The state of the pronunciation cache.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCacheInfo {
    pub count: usize,
    pub size_bytes: u64,
    pub directory: String,
}

/// Save the current session so it can be resumed later.
///
/// The queue and the position are small, so the whole session is stored as
/// JSON in the settings table rather than in its own schema.
#[tauri::command]
fn save_session(state: State<'_, AppState>, session: session::PendingSession) -> AppResult<()> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    let json = serde_json::to_string(&session)?;
    db.save_pending_session(&json)
}

/// Read the saved session, if there is one.
#[tauri::command]
fn load_session(state: State<'_, AppState>) -> AppResult<Option<session::PendingSession>> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    match db.pending_session()? {
        Some(json) => match serde_json::from_str(&json) {
            Ok(session) => Ok(Some(session)),
            // A corrupt record should not block the app; drop it.
            Err(_) => {
                db.clear_pending_session()?;
                Ok(None)
            }
        },
        None => Ok(None),
    }
}

/// Forget the saved session.
#[tauri::command]
fn clear_session(state: State<'_, AppState>) -> AppResult<()> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    db.clear_pending_session()
}

/// Entry point used by the mobile and desktop shells.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let db = Db::open(db::default_db_path(&handle)?)?;
            let lexicon = lexicon::load_bundled(&handle)?;

            let audio_dir = handle
                .path()
                .app_data_dir()
                .map_err(|err| AppError::Io(format!("cannot resolve app data dir: {err}")))?
                .join("audio");

            app.manage(AppState {
                db: Mutex::new(db),
                lexicon,
                audio: audio::AudioCache::new(audio_dir),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            dashboard_stats,
            list_books,
            book_entries,
        preview_import,
        import_book,
        delete_book,
            search_entries,
            resolve_entries,
            build_session,
            build_choices,
            record_review,
            add_to_notebook,
            remove_from_notebook,
            list_notebook,
            all_cards,
            export_backup,
            import_backup,
            record_study_time,
            reset_progress,
            get_setting,
            set_setting,
            database_path,
            lexicon_total,
            pronounce,
            has_recording,
            audio_cache_info,
            clear_audio_cache,
            save_session,
            load_session,
            clear_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LexiFlow");
}
