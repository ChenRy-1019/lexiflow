//! SQLite storage layer.
//!
//! Everything the learner produces lives here: review cards, review logs,
//! notebook entries and settings. The vocabulary itself is read-only and
//! ships with the application as a bundled JSON resource, because it never
//! changes at runtime and can be shared by every user of the same build.

use std::collections::HashMap;
use std::path::PathBuf;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::error::{AppError, AppResult};

/// A review card as stored on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub entry_id: String,
    /// JSON-encoded FSRS card, `None` until the word has been seen once.
    pub card: Option<String>,
    /// FSRS state: 0 new, 1 learning, 2 review, 3 relearning.
    pub state: i64,
    /// Epoch milliseconds of the next scheduled review.
    pub due: i64,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    pub correct_count: i64,
    pub lapse_count: i64,
    pub mastered: bool,
}

/// A single recorded review.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLog {
    pub entry_id: String,
    pub at: i64,
    /// 1 = Again, 2 = Hard, 3 = Good, 4 = Easy.
    pub rating: i64,
    pub duration_ms: i64,
    pub mode: String,
}

/// A word the learner explicitly saved to the notebook.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookItem {
    pub entry_id: String,
    pub added_at: i64,
    /// Number of times the learner got this word wrong.
    pub wrong_count: i64,
}

/// Aggregate counters for the dashboard.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    pub today_new: i64,
    pub due_count: i64,
    pub started: i64,
    pub mastered: i64,
    pub streak: i64,
    pub weekly: Vec<i64>,
    pub study_seconds: i64,
    /// Reviews in the last seven days, new words and repeats alike.
    pub week_reviews: i64,
    /// Share of those reviews answered correctly, 0..100.
    pub week_accuracy: i64,
    /// The longest run of consecutive study days on record.
    pub best_streak: i64,
}

/// Handle to the learner's local database.
pub struct Db {
    conn: Connection,
    path: PathBuf,
}

impl Db {
    /// Open (or create) the database and apply the schema.
    pub fn open(path: PathBuf) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Db { conn, path };
        db.migrate()?;
        Ok(db)
    }

    /// The on-disk location, shown in the settings page.
    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    fn migrate(&self) -> AppResult<()> {
        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS cards (
                entry_id     TEXT PRIMARY KEY,
                card         TEXT,
                state        INTEGER NOT NULL DEFAULT 0,
                due          INTEGER NOT NULL DEFAULT 0,
                first_seen_at INTEGER NOT NULL DEFAULT 0,
                last_seen_at INTEGER NOT NULL DEFAULT 0,
                correct_count INTEGER NOT NULL DEFAULT 0,
                lapse_count  INTEGER NOT NULL DEFAULT 0,
                mastered     INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);

            CREATE TABLE IF NOT EXISTS review_logs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id   TEXT NOT NULL,
                at         INTEGER NOT NULL,
                rating     INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                mode       TEXT NOT NULL DEFAULT 'spelling'
            );

            CREATE INDEX IF NOT EXISTS idx_logs_at ON review_logs(at);
            CREATE INDEX IF NOT EXISTS idx_logs_entry ON review_logs(entry_id);

            CREATE TABLE IF NOT EXISTS notebook (
                entry_id   TEXT PRIMARY KEY,
                added_at   INTEGER NOT NULL,
                wrong_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            -- Wordbooks the learner imported. They live beside the bundled
            -- vocabulary rather than replacing it, so an import survives an
            -- upgrade and the built-in books stay intact.
            CREATE TABLE IF NOT EXISTS custom_books (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                source      TEXT NOT NULL DEFAULT "",
                format      TEXT NOT NULL DEFAULT "",
                imported_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS custom_entries (
                book_id     TEXT NOT NULL,
                entry_id    TEXT NOT NULL,
                position    INTEGER NOT NULL,
                word        TEXT NOT NULL,
                meaning     TEXT NOT NULL DEFAULT "",
                phonetic    TEXT NOT NULL DEFAULT "",
                pos         TEXT NOT NULL DEFAULT "",
                PRIMARY KEY (book_id, entry_id)
            );

            CREATE INDEX IF NOT EXISTS idx_custom_entries_book
                ON custom_entries(book_id, position);

            CREATE TABLE IF NOT EXISTS study_sessions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at  INTEGER NOT NULL,
                ended_at    INTEGER,
                seconds     INTEGER NOT NULL DEFAULT 0
            );
            "#,
        )?;
        Ok(())
    }

    /// Fetch a single card.
    pub fn card(&self, entry_id: &str) -> AppResult<Option<Card>> {
        let mut stmt = self.conn.prepare(
            "SELECT entry_id, card, state, due, first_seen_at, last_seen_at,
                    correct_count, lapse_count, mastered
             FROM cards WHERE entry_id = ?1",
        )?;
        let row = stmt
            .query_row(params![entry_id], |row| {
                Ok(Card {
                    entry_id: row.get(0)?,
                    card: row.get(1)?,
                    state: row.get(2)?,
                    due: row.get(3)?,
                    first_seen_at: row.get(4)?,
                    last_seen_at: row.get(5)?,
                    correct_count: row.get(6)?,
                    lapse_count: row.get(7)?,
                    mastered: row.get(8)?,
                })
            })
            .optional()?;
        Ok(row)
    }

    /// Fetch every card, keyed by entry id.
    pub fn all_cards(&self) -> AppResult<HashMap<String, Card>> {
        let mut stmt = self.conn.prepare(
            "SELECT entry_id, card, state, due, first_seen_at, last_seen_at,
                    correct_count, lapse_count, mastered
             FROM cards",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Card {
                entry_id: row.get(0)?,
                card: row.get(1)?,
                state: row.get(2)?,
                due: row.get(3)?,
                first_seen_at: row.get(4)?,
                last_seen_at: row.get(5)?,
                correct_count: row.get(6)?,
                lapse_count: row.get(7)?,
                mastered: row.get(8)?,
            })
        })?;

        let mut map = HashMap::new();
        for row in rows {
            let card = row?;
            map.insert(card.entry_id.clone(), card);
        }
        Ok(map)
    }

    /// Insert or update a card.
    pub fn upsert_card(&self, card: &Card) -> AppResult<()> {
        self.conn.execute(
            r#"
            INSERT INTO cards (entry_id, card, state, due, first_seen_at, last_seen_at,
                               correct_count, lapse_count, mastered)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(entry_id) DO UPDATE SET
                card = excluded.card,
                state = excluded.state,
                due = excluded.due,
                last_seen_at = excluded.last_seen_at,
                correct_count = excluded.correct_count,
                lapse_count = excluded.lapse_count,
                mastered = excluded.mastered
            "#,
            params![
                card.entry_id,
                card.card,
                card.state,
                card.due,
                card.first_seen_at,
                card.last_seen_at,
                card.correct_count,
                card.lapse_count,
                card.mastered as i64,
            ],
        )?;
        Ok(())
    }

    /// Append a review to the log.
    pub fn add_log(&self, log: &ReviewLog) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO review_logs (entry_id, at, rating, duration_ms, mode)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![log.entry_id, log.at, log.rating, log.duration_ms, log.mode],
        )?;
        Ok(())
    }

    /// Fetch review logs newer than `since`, used to build the weekly chart.
    pub fn logs_since(&self, since: i64) -> AppResult<Vec<ReviewLog>> {
        let mut stmt = self.conn.prepare(
            "SELECT entry_id, at, rating, duration_ms, mode
             FROM review_logs WHERE at >= ?1 ORDER BY at ASC",
        )?;
        let rows = stmt.query_map(params![since], |row| {
            Ok(ReviewLog {
                entry_id: row.get(0)?,
                at: row.get(1)?,
                rating: row.get(2)?,
                duration_ms: row.get(3)?,
                mode: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Add a word to the notebook.
    pub fn add_to_notebook(&self, entry_id: &str, at: i64) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO notebook (entry_id, added_at, wrong_count) VALUES (?1, ?2, 0)
             ON CONFLICT(entry_id) DO NOTHING",
            params![entry_id, at],
        )?;
        Ok(())
    }

    /// Remove a word from the notebook.
    pub fn remove_from_notebook(&self, entry_id: &str) -> AppResult<()> {
        self.conn.execute("DELETE FROM notebook WHERE entry_id = ?1", params![entry_id])?;
        Ok(())
    }

    /// Bump the wrong-answer counter for a notebook entry.
    pub fn increment_notebook_wrong(&self, entry_id: &str) -> AppResult<()> {
        self.conn.execute(
            "UPDATE notebook SET wrong_count = wrong_count + 1 WHERE entry_id = ?1",
            params![entry_id],
        )?;
        Ok(())
    }

    /// Whether a word is in the notebook.
    pub fn in_notebook(&self, entry_id: &str) -> AppResult<bool> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM notebook WHERE entry_id = ?1",
            params![entry_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Every notebook entry, newest first.
    pub fn notebook(&self) -> AppResult<Vec<NotebookItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT entry_id, added_at, wrong_count FROM notebook ORDER BY added_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(NotebookItem {
                entry_id: row.get(0)?,
                added_at: row.get(1)?,
                wrong_count: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Read a setting.
    pub fn setting(&self, key: &str) -> AppResult<Option<String>> {
        let value = self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| {
                row.get(0)
            })
            .optional()?;
        Ok(value)
    }

    /// Save the unfinished session so it can be resumed.
    ///
    /// It lives in the settings table because it is a single small value that
    /// is rewritten on every answer, and a dedicated table would add schema
    /// churn for no gain.
    pub fn save_pending_session(&self, json: &str) -> AppResult<()> {
        self.set_setting("pendingSession", json)
    }

    /// Read the unfinished session, if one was saved.
    pub fn pending_session(&self) -> AppResult<Option<String>> {
        self.setting("pendingSession")
    }

    /// Forget the unfinished session.
    pub fn clear_pending_session(&self) -> AppResult<()> {
        self.conn
            .execute("DELETE FROM settings WHERE key = ?1", params!["pendingSession"])?;
        Ok(())
    }

    /// Write a setting.
    pub fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Record a completed study session.
    pub fn record_session(&self, seconds: i64) -> AppResult<()> {
        let now = crate::util::now_ms();
        self.conn.execute(
            "INSERT INTO study_sessions (started_at, ended_at, seconds) VALUES (?1, ?1, ?2)",
            params![now, seconds],
        )?;
        Ok(())
    }

    /// Total seconds spent studying.
    pub fn total_study_seconds(&self) -> AppResult<i64> {
        let total: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(seconds), 0) FROM study_sessions",
            [],
            |row| row.get(0),
        )?;
        Ok(total)
    }

    /// Wipe all learning progress, keeping the notebook and settings.
    pub fn reset_progress(&self) -> AppResult<()> {
        self.conn.execute("DELETE FROM cards", [])?;
        self.conn.execute("DELETE FROM review_logs", [])?;
        self.conn.execute("DELETE FROM study_sessions", [])?;
        Ok(())
    }

    /// Wipe everything, including the notebook and settings.
    pub fn reset_all(&self) -> AppResult<()> {
        self.reset_progress()?;
        self.conn.execute("DELETE FROM notebook", [])?;
        self.conn.execute("DELETE FROM settings", [])?;
        Ok(())
    }

    // -------------------------------------------------------- imported books

    /// Every imported wordbook, newest first.
    pub fn custom_books(&self) -> AppResult<Vec<CustomBook>> {
        let mut stmt = self.conn.prepare(
            "SELECT b.id, b.name, b.source, b.format, b.imported_at,
                    (SELECT COUNT(*) FROM custom_entries e WHERE e.book_id = b.id)
             FROM custom_books b
             ORDER BY b.imported_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(CustomBook {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    source: row.get(2)?,
                    format: row.get(3)?,
                    imported_at: row.get(4)?,
                    total: row.get::<_, i64>(5)? as usize,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// One imported wordbook's entries, in their original order.
    pub fn custom_entries(&self, book_id: &str) -> AppResult<Vec<CustomEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT entry_id, word, meaning, phonetic, pos
             FROM custom_entries WHERE book_id = ?1 ORDER BY position",
        )?;
        let rows = stmt
            .query_map(params![book_id], |row| {
                Ok(CustomEntry {
                    entry_id: row.get(0)?,
                    word: row.get(1)?,
                    meaning: row.get(2)?,
                    phonetic: row.get(3)?,
                    pos: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Store a wordbook and its entries in one transaction.
    ///
    /// A partial import would leave a book whose word count does not match its
    /// contents, so the whole set is written together.
    pub fn insert_custom_book(&mut self, book: &CustomBook, entries: &[CustomEntry]) -> AppResult<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO custom_books (id, name, source, format, imported_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![book.id, book.name, book.source, book.format, book.imported_at],
        )?;

        {
            let mut stmt = tx.prepare(
                "INSERT INTO custom_entries
                     (book_id, entry_id, position, word, meaning, phonetic, pos)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for (position, entry) in entries.iter().enumerate() {
                stmt.execute(params![
                    book.id,
                    entry.entry_id,
                    position as i64,
                    entry.word,
                    entry.meaning,
                    entry.phonetic,
                    entry.pos,
                ])?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    /// Remove an imported wordbook and its entries.
    pub fn delete_custom_book(&mut self, book_id: &str) -> AppResult<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM custom_entries WHERE book_id = ?1", params![book_id])?;
        tx.execute("DELETE FROM custom_books WHERE id = ?1", params![book_id])?;
        tx.commit()?;
        Ok(())
    }

    /// Look up imported entries by their entry ids.
    ///
    /// The notebook and the resume path store only ids, so they need to turn
    /// an arbitrary list back into entries.
    pub fn custom_entries_by_ids(&self, ids: &[String]) -> AppResult<Vec<CustomEntry>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        // One placeholder per id, so a large notebook still works without
        // building a query string out of the values themselves.
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!(
            "SELECT entry_id, word, meaning, phonetic, pos
             FROM custom_entries WHERE entry_id IN ({placeholders})"
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query_map(params.as_slice(), |row| {
                Ok(CustomEntry {
                    entry_id: row.get(0)?,
                    word: row.get(1)?,
                    meaning: row.get(2)?,
                    phonetic: row.get(3)?,
                    pos: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Every imported entry id, so they can be loaded alongside the bundled
    /// vocabulary at startup.
    pub fn all_custom_entries(&self) -> AppResult<Vec<CustomEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT entry_id, word, meaning, phonetic, pos
             FROM custom_entries ORDER BY book_id, position",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(CustomEntry {
                    entry_id: row.get(0)?,
                    word: row.get(1)?,
                    meaning: row.get(2)?,
                    phonetic: row.get(3)?,
                    pos: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

/// An imported wordbook.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomBook {
    pub id: String,
    pub name: String,
    /// The file it came from.
    pub source: String,
    pub format: String,
    pub imported_at: i64,
    pub total: usize,
}

/// One row of an imported wordbook.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomEntry {
    pub entry_id: String,
    pub word: String,
    pub meaning: String,
    pub phonetic: String,
    pub pos: String,
}

/// Open the database in the platform's application data directory.
pub fn default_db_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::Io(format!("cannot resolve app data dir: {err}")))?;
    Ok(dir.join("lexiflow.db"))
}
