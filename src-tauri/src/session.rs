//! Session building and progress accounting.
//!
//! The logic here is deliberately free of Tauri types so it can be tested
//! directly: given a set of entry ids and the cards the learner already has,
//! decide what the next session should contain and what a review does to the
//! counters.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::db::{Card, ReviewLog};

/// Which slice of the vocabulary a session draws from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// New words and due reviews, interleaved.
    Mix,
    /// Only words the learner has never seen.
    New,
    /// Only words that are due for review.
    Review,
}

impl Scope {
    /// Parse the scope name used by the frontend.
    pub fn parse(value: &str) -> Scope {
        match value {
            "new" => Scope::New,
            "review" => Scope::Review,
            _ => Scope::Mix,
        }
    }
}

/// One question in a session.
#[derive(Debug, Clone)]
pub struct SessionItem {
    pub entry_id: String,
    /// Whether the word was already scheduled for review.
    pub is_review: bool,
}

/// An unfinished session, remembered so the learner can return to it.
///
/// Leaving practice used to drop the queue and the position, so coming back
/// always started a fresh session. Keeping the queue here lets the home page
/// offer "continue" and resume at the exact word.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingSession {
    /// The entry ids still to answer, in order.
    pub ids: Vec<String>,
    /// How many words have already been answered.
    pub answered: usize,
    /// The wordbook the session was built from, empty for every book.
    pub book_id: String,
    /// `mix`, `new` or `review`.
    pub scope: String,
    /// The mode the learner was using.
    pub mode: String,
    /// How many words the session was asked for.
    pub limit: usize,
    /// Epoch milliseconds of the last update.
    pub updated_at: i64,
}

impl PendingSession {
    /// The word that comes next, if any.
    pub fn current(&self) -> Option<&String> {
        self.ids.get(self.answered)
    }

    /// Whether every word has been answered.
    pub fn finished(&self) -> bool {
        self.answered >= self.ids.len()
    }

    /// How many words remain.
    pub fn remaining(&self) -> usize {
        self.ids.len().saturating_sub(self.answered)
    }
}

/// Choose the entries for the next session.
///
/// New words and due reviews are interleaved so a mixed session never feels
/// like two separate blocks. The order within each group follows the
/// wordbook's own ordering, which keeps the sequence stable between sessions.
pub fn build_session(
    entry_ids: &[String],
    cards: &HashMap<String, Card>,
    scope: Scope,
    limit: usize,
    now_ms: i64,
) -> Vec<SessionItem> {
    let mut new_words: Vec<&String> = Vec::new();
    let mut due_words: Vec<&String> = Vec::new();

    for id in entry_ids {
        match cards.get(id) {
            None => new_words.push(id),
            Some(card) if card.due > 0 && card.due <= now_ms => due_words.push(id),
            Some(_) => {}
        }
    }

    let mut selected: Vec<&String> = match scope {
        Scope::New => new_words,
        Scope::Review => due_words,
        Scope::Mix => {
            let mut mixed: Vec<&String> = Vec::with_capacity(new_words.len() + due_words.len());
            let mut new_iter = new_words.iter();
            let mut due_iter = due_words.iter();
            loop {
                let take_new = new_iter.next();
                let take_due = due_iter.next();
                match (take_new, take_due) {
                    (None, None) => break,
                    (a, b) => {
                        if let Some(id) = a {
                            mixed.push(id);
                        }
                        if let Some(id) = b {
                            mixed.push(id);
                        }
                    }
                }
            }
            mixed
        }
    };

    selected.truncate(limit);

    selected
        .into_iter()
        .map(|id| SessionItem {
            entry_id: id.clone(),
            is_review: cards.contains_key(id),
        })
        .collect()
}

/// Build a session from an explicit pool, ignoring the review schedule.
///
/// The notebook uses this: its words are saved because the learner wants to
/// work on them, so they should be available whenever that is asked for rather
/// than only once FSRS marks them due.
pub fn build_all(entry_ids: &[String], cards: &HashMap<String, Card>, limit: usize) -> Vec<SessionItem> {
    entry_ids
        .iter()
        .take(limit)
        .map(|id| SessionItem {
            entry_id: id.clone(),
            is_review: cards.get(id).map(|card| card.due > 0).unwrap_or(false),
        })
        .collect()
}

/// The counters for a word after one review.
///
/// `correct` is whether the learner got it right; showing the answer and
/// skipping both count as a lapse because neither demonstrates recall.
pub fn updated_counts(
    previous_correct: i64,
    previous_lapses: i64,
    correct: bool,
) -> (i64, i64, bool) {
    let correct_count = previous_correct + i64::from(correct);
    let lapse_count = previous_lapses + i64::from(!correct);
    // A word counts as mastered after two independent successful reviews.
    let mastered = correct_count >= crate::MASTERY_THRESHOLD;
    (correct_count, lapse_count, mastered)
}

/// The longest run of consecutive study days on record.
///
/// A day counts when at least one review was answered correctly, the same rule
/// the current streak uses. Timestamps are converted to a local day number so
/// that "the next day" is exactly one apart, whatever the offset.
pub fn longest_streak(logs: &[ReviewLog], local_offset_minutes: i64) -> i64 {
    const DAY: i64 = 86_400_000;
    let offset_ms = local_offset_minutes * 60_000;

    let mut days: Vec<i64> = logs
        .iter()
        .filter(|log| log.rating >= 3)
        .map(|log| (log.at + offset_ms).div_euclid(DAY))
        .collect();

    if days.is_empty() {
        return 0;
    }

    days.sort_unstable();
    days.dedup();

    let mut best = 1i64;
    let mut run = 1i64;
    for pair in days.windows(2) {
        if pair[1] - pair[0] == 1 {
            run += 1;
            best = best.max(run);
        } else {
            run = 1;
        }
    }

    best
}

/// Count the words that are due for review right now.
pub fn due_count(cards: &HashMap<String, Card>, now_ms: i64) -> usize {
    cards
        .values()
        .filter(|card| card.due > 0 && card.due <= now_ms)
        .count()
}

/// Count the words the learner has started.
pub fn started_count(cards: &HashMap<String, Card>) -> usize {
    cards.values().filter(|card| card.first_seen_at > 0).count()
}

/// Count the words the learner has mastered.
pub fn mastered_count(cards: &HashMap<String, Card>) -> usize {
    cards.values().filter(|card| card.mastered).count()
}

/// What the frontend needs to know after a review has been recorded.
#[derive(Debug, Clone)]
pub struct ReviewOutcome {
    pub correct: bool,
    pub expected: String,
    pub mastered: bool,
    pub correct_count: i64,
}

/// The inputs a review brings with it.
#[derive(Debug, Clone)]
pub struct ReviewInput<'a> {
    pub entry_id: &'a str,
    pub expected: &'a str,
    /// The FSRS card computed by the frontend, serialised.
    pub card_json: Option<String>,
    /// Epoch milliseconds of the next scheduled review.
    pub due: i64,
    /// The FSRS state after the review.
    pub state: i64,
    /// Whether the learner answered correctly.
    pub correct: bool,
    /// The rating the learner chose, 1 (Again) to 4 (Easy).
    pub rating: i64,
    /// The study mode the review happened in.
    pub mode: &'a str,
    /// How long the learner took.
    pub duration_ms: i64,
}

/// Record one review.
///
/// The FSRS maths happens in the frontend; the backend stores the resulting
/// card so that the schedule survives a restart, and keeps the counters that
/// the dashboard reads.
pub fn record_review(db: &crate::db::Db, input: ReviewInput<'_>, now_ms: i64) -> ReviewOutcome {
    let existing = db.card(input.entry_id).ok().flatten();

    let (correct_count, lapse_count, mastered) = updated_counts(
        existing.as_ref().map(|c| c.correct_count).unwrap_or(0),
        existing.as_ref().map(|c| c.lapse_count).unwrap_or(0),
        input.correct,
    );
    let first_seen_at = existing
        .as_ref()
        .map(|c| c.first_seen_at)
        .filter(|t| *t > 0)
        .unwrap_or(now_ms);

    let card = Card {
        entry_id: input.entry_id.to_string(),
        card: input.card_json,
        state: input.state,
        due: input.due,
        first_seen_at,
        last_seen_at: now_ms,
        correct_count,
        lapse_count,
        mastered,
    };
    let _ = db.upsert_card(&card);

    let _ = db.add_log(&crate::db::ReviewLog {
        entry_id: input.entry_id.to_string(),
        at: now_ms,
        rating: input.rating,
        duration_ms: input.duration_ms,
        mode: input.mode.to_string(),
    });

    if !input.correct {
        let _ = db.increment_notebook_wrong(input.entry_id);
    }

    ReviewOutcome {
        correct: input.correct,
        expected: input.expected.to_string(),
        mastered,
        correct_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(due: i64, correct: i64, mastered: bool) -> Card {
        Card {
            entry_id: "x".into(),
            card: None,
            state: 2,
            due,
            first_seen_at: 1,
            last_seen_at: 1,
            correct_count: correct,
            lapse_count: 0,
            mastered,
        }
    }

    fn ids(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    #[test]
    fn a_new_session_only_contains_unseen_words() {
        let mut cards = HashMap::new();
        cards.insert("seen".to_string(), card(1_000, 1, false));

        let session = build_session(&ids(&["fresh", "seen"]), &cards, Scope::New, 10, 500);
        assert_eq!(session.len(), 1);
        assert_eq!(session[0].entry_id, "fresh");
        assert!(!session[0].is_review);
    }

    #[test]
    fn a_review_session_only_contains_due_words() {
        let mut cards = HashMap::new();
        cards.insert("due".to_string(), card(400, 1, false));
        cards.insert("later".to_string(), card(9_000, 1, false));

        let session = build_session(&ids(&["due", "later", "fresh"]), &cards, Scope::Review, 10, 500);
        assert_eq!(session.len(), 1);
        assert_eq!(session[0].entry_id, "due");
        assert!(session[0].is_review);
    }

    #[test]
    fn a_mixed_session_interleaves_new_and_review_words() {
        let mut cards = HashMap::new();
        cards.insert("due1".to_string(), card(400, 1, false));
        cards.insert("due2".to_string(), card(400, 1, false));

        let session = build_session(
            &ids(&["new1", "due1", "new2", "due2"]),
            &cards,
            Scope::Mix,
            10,
            500,
        );
        assert_eq!(session.len(), 4);
        // The two groups alternate rather than arriving in blocks.
        assert!(session[0].is_review != session[1].is_review);
    }

    #[test]
    fn the_session_respects_the_limit() {
        let session = build_session(&ids(&["a", "b", "c"]), &HashMap::new(), Scope::New, 2, 0);
        assert_eq!(session.len(), 2);
    }

    #[test]
    fn a_word_needs_two_correct_answers_to_be_mastered() {
        assert_eq!(updated_counts(0, 0, true), (1, 0, false));
        assert_eq!(updated_counts(1, 0, true), (2, 0, true));
        assert_eq!(updated_counts(2, 0, false), (2, 1, true));
        assert_eq!(updated_counts(0, 0, false), (0, 1, false));
    }

    #[test]
    fn counters_reflect_the_cards() {
        let mut cards = HashMap::new();
        cards.insert("a".to_string(), card(400, 1, false));
        cards.insert("b".to_string(), card(9_000, 2, true));

        assert_eq!(due_count(&cards, 500), 1);
        assert_eq!(started_count(&cards), 2);
        assert_eq!(mastered_count(&cards), 1);
    }
}
