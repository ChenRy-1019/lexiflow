//! The vocabulary store.
//!
//! The wordbook file is bundled with the application and loaded once at
//! startup. It is immutable at runtime, so it lives in memory and is shared
//! behind an `Arc` rather than being read from disk on every query.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::error::{AppError, AppResult};

/// One dictionary entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub word: String,
    pub meaning: String,
    pub pos: String,
    pub phonetic: String,
    pub example: String,
    pub example_zh: String,
    pub phrase: bool,
    pub etymology: String,
}

/// Metadata for one wordbook.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wordbook {
    pub id: String,
    pub name: String,
    pub category: String,
    pub short: String,
    pub description: String,
    pub total: usize,
}

/// The bundled lexicon file: a map of book id to its entries.
#[derive(Debug, Deserialize)]
struct LexiconFile {
    books: HashMap<String, Vec<Entry>>,
    #[serde(default)]
    meta: HashMap<String, Wordbook>,
}

/// An in-memory, read-only view over the bundled vocabulary.
pub struct Lexicon {
    entries: HashMap<String, Entry>,
    /// Entry ids grouped by the wordbook they belong to.
    by_book: HashMap<String, Vec<String>>,
    /// Wordbooks in display order.
    books: Vec<Wordbook>,
}

impl Lexicon {
    /// Load the lexicon from its JSON payload.
    pub fn from_json(raw: &str) -> AppResult<Self> {
        let parsed: LexiconFile = serde_json::from_str(raw)?;

        let mut entries = HashMap::with_capacity(16_384);
        let mut by_book: HashMap<String, Vec<String>> = HashMap::new();

        for (book_id, book_entries) in parsed.books {
            let mut ids = Vec::with_capacity(book_entries.len());
            for entry in book_entries {
                ids.push(entry.id.clone());
                entries.insert(entry.id.clone(), entry);
            }
            by_book.insert(book_id, ids);
        }

        let mut books: Vec<Wordbook> = parsed
            .meta
            .into_values()
            .map(|mut meta| {
                meta.total = by_book.get(&meta.id).map(|ids| ids.len()).unwrap_or(0);
                meta
            })
            .collect();
        books.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(Lexicon {
            entries,
            by_book,
            books,
        })
    }

    /// All wordbooks, in display order.
    pub fn books(&self) -> &[Wordbook] {
        &self.books
    }

    /// Look up one entry.
    pub fn entry(&self, entry_id: &str) -> Option<&Entry> {
        self.entries.get(entry_id)
    }

    /// The entry ids of one wordbook.
    pub fn book_entries(&self, book_id: &str) -> &[String] {
        self.by_book.get(book_id).map(|v| v.as_slice()).unwrap_or(&[])
    }

    /// Total number of entries across every wordbook.
    pub fn total_entries(&self) -> usize {
        self.entries.len()
    }

    /// Resolve a list of entry ids into entries, skipping unknown ids.
    pub fn resolve(&self, ids: &[String]) -> Vec<Entry> {
        ids.iter()
            .filter_map(|id| self.entries.get(id).cloned())
            .collect()
    }

    /// Search entries by headword or gloss, capped at `limit` results.
    pub fn search(&self, query: &str, limit: usize) -> Vec<Entry> {
        let needle = crate::util::normalise_answer(query);
        if needle.is_empty() {
            return Vec::new();
        }
        let mut hits = Vec::new();
        for entry in self.entries.values() {
            let head = crate::util::normalise_answer(&entry.word);
            if head.contains(&needle) || entry.meaning.contains(query.trim()) {
                hits.push(entry.clone());
                if hits.len() >= limit {
                    break;
                }
            }
        }
        hits.sort_by(|a, b| a.word.cmp(&b.word));
        hits
    }
}

/// Shared handle to the loaded lexicon.
pub type SharedLexicon = Arc<Lexicon>;

/// Load the lexicon bundled as a Tauri resource.
pub fn load_bundled(app: &tauri::AppHandle) -> AppResult<SharedLexicon> {
    let resource = app
        .path()
        .resolve("lexicon.json", tauri::path::BaseDirectory::Resource)
        .map_err(|err| AppError::Vocabulary(format!("cannot resolve lexicon.json: {err}")))?;

    let raw = std::fs::read_to_string(&resource)
        .map_err(|err| AppError::Vocabulary(format!("cannot read lexicon.json: {err}")))?;

    Ok(Arc::new(Lexicon::from_json(&raw)?))
}
