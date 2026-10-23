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
mod lexicon;
mod session;
mod util;

/// The storage types, re-exported so integration tests can use them.
pub mod testing {
    pub use crate::db::{Card, DashboardStats, Db, NotebookItem, ReviewLog};
    pub use crate::lexicon::{Entry, Lexicon, Wordbook};
    pub use crate::session::{record_review, ReviewInput, ReviewOutcome, Scope};
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

    Ok(DashboardStats {
        today_new,
        due_count,
        started,
        mastered,
        streak,
        weekly,
        study_seconds,
    })
}

/// List every wordbook with live counters.
#[tauri::command]
fn list_books(state: State<'_, AppState>) -> AppResult<Vec<BookWithStats>> {
    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;
    let cards = db.all_cards()?;

    let mut books = Vec::with_capacity(state.lexicon.books().len());
    for book in state.lexicon.books() {
        let ids = state.lexicon.book_entries(&book.id);
        let mut started = 0usize;
        let mut mastered = 0usize;
        for id in ids {
            if let Some(card) = cards.get(id) {
                if card.first_seen_at > 0 {
                    started += 1;
                }
                if card.mastered {
                    mastered += 1;
                }
            }
        }
        books.push(BookWithStats {
            book: book.clone(),
            started,
            mastered,
        });
    }
    Ok(books)
}

/// List the entries of a wordbook.
#[tauri::command]
fn book_entries(state: State<'_, AppState>, book_id: String) -> AppResult<Vec<Entry>> {
    Ok(state.lexicon.resolve(state.lexicon.book_entries(&book_id)))
}

/// Search the whole vocabulary.
#[tauri::command]
fn search_entries(state: State<'_, AppState>, query: String) -> AppResult<Vec<Entry>> {
    Ok(state.lexicon.search(&query, 200))
}

/// Resolve a list of entry ids back into their dictionary entries.
///
/// The notebook stores only ids, so the page needs a way to turn them back
/// into words and glosses for display.
#[tauri::command]
fn resolve_entries(state: State<'_, AppState>, entry_ids: Vec<String>) -> AppResult<Vec<Entry>> {
    Ok(state.lexicon.resolve(&entry_ids))
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

    let ids: Vec<String> = if request.book_id.is_empty() {
        let mut all = Vec::new();
        for book in state.lexicon.books() {
            all.extend(state.lexicon.book_entries(&book.id).iter().cloned());
        }
        all
    } else {
        state.lexicon.book_entries(&request.book_id).to_vec()
    };

    let scope = session::Scope::parse(&request.scope);
    let selected = session::build_session(&ids, &cards, scope, request.limit, now);

    Ok(selected
        .iter()
        .filter_map(|item| {
            let entry = state.lexicon.entry(&item.entry_id)?;
            let card = cards.get(&item.entry_id);
            Some(StudyItem {
                entry: entry.clone(),
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
    let entry = state
        .lexicon
        .entry(&entry_id)
        .ok_or_else(|| AppError::Vocabulary(format!("unknown entry {entry_id}")))?;

    let mut pool: Vec<&Entry> = state
        .lexicon
        .book_entries(&book_id)
        .iter()
        .filter_map(|id| state.lexicon.entry(id))
        .filter(|candidate| candidate.phrase == entry.phrase)
        .collect();

    if pool.len() < 8 {
        pool = state
            .lexicon
            .books()
            .iter()
            .flat_map(|book| state.lexicon.book_entries(&book.id))
            .filter_map(|id| state.lexicon.entry(id))
            .filter(|candidate| candidate.phrase == entry.phrase && candidate.id != entry_id)
            .collect();
    }

    // Pick three random distractors from the pool.
    let mut distractors: Vec<&Entry> = pool
        .iter()
        .filter(|candidate| candidate.id != entry_id && candidate.meaning != entry.meaning)
        .copied()
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

    let entry = state
        .lexicon
        .entry(&request.entry_id)
        .ok_or_else(|| AppError::Vocabulary(format!("unknown entry {}", request.entry_id)))?
        .clone();

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

/// Entry point used by the mobile and desktop shells.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running LexiFlow");
}
