//! Tests for studying an explicit pool of ids.
//!
//! The notebook is already a list of words the learner saved, so reviewing it
//! should not ask which wordbook to draw from. `build_all` takes the pool as
//! given: every saved word is offered, whether or not FSRS marks it due.

use lexiflow_lib::testing::{build_all, build_session, Card, Scope};
use std::collections::HashMap;

/// A card scheduled far in the future, so it is not due now.
fn future_card() -> Card {
    Card {
        entry_id: "cet4:abandon".into(),
        card: None,
        state: 2,
        due: i64::MAX / 4,
        first_seen_at: 1,
        last_seen_at: 1,
        correct_count: 1,
        lapse_count: 0,
        mastered: false,
    }
}

#[test]
fn build_all_offers_every_saved_word() {
    let ids = vec!["a:1".to_string(), "a:2".to_string(), "a:3".to_string()];
    let mut cards = HashMap::new();
    // The second word is scheduled far ahead, so a scheduled review would skip
    // it. The notebook should still offer it.
    cards.insert("a:2".to_string(), future_card());

    let session = build_all(&ids, &cards, 10);

    assert_eq!(session.len(), 3);
    assert_eq!(
        session.iter().map(|item| item.entry_id.clone()).collect::<Vec<_>>(),
        ids,
    );
}

#[test]
fn build_all_respects_the_limit() {
    let ids: Vec<String> = (0..10).map(|n| format!("a:{n}")).collect();
    let cards = HashMap::new();

    let session = build_all(&ids, &cards, 4);

    assert_eq!(session.len(), 4);
}

#[test]
fn a_regular_session_still_skips_words_that_are_not_due() {
    // The contrast that motivates `build_all`: the scheduled path drops a word
    // whose due date has not arrived.
    let ids = vec!["a:1".to_string(), "a:2".to_string()];
    let mut cards = HashMap::new();
    cards.insert("a:2".to_string(), future_card());

    let scheduled = build_session(&ids, &cards, Scope::Review, 10, 1_000);

    assert_eq!(scheduled.len(), 0, "nothing is due yet");
}

#[test]
fn build_all_marks_a_started_word_as_a_review() {
    let ids = vec!["a:1".to_string(), "a:2".to_string()];
    let mut cards = HashMap::new();
    cards.insert("a:2".to_string(), future_card());

    let session = build_all(&ids, &cards, 10);

    let second = session.iter().find(|item| item.entry_id == "a:2").unwrap();
    assert!(second.is_review, "a word with a card is a review");
    let first = session.iter().find(|item| item.entry_id == "a:1").unwrap();
    assert!(!first.is_review, "a word without a card is new");
}
