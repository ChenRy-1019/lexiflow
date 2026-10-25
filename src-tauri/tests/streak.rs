//! Tests for the longest-streak counter.
//!
//! `streak_length` reports the run that ends today; this one reports the best
//! run ever recorded, which the statistics page shows beside it.

use lexiflow_lib::testing::{longest_streak, ReviewLog};

const DAY: i64 = 86_400_000;
/// Midnight UTC on 2026-01-01.
const DAY0: i64 = 1_767_225_600_000;

/// A review log at a given offset from DAY0.
fn entry(day_offset: i64, rating: i64) -> ReviewLog {
    ReviewLog {
        entry_id: "cet4:abandon".into(),
        at: DAY0 + day_offset * DAY,
        rating,
        duration_ms: 800,
        mode: "spelling".into(),
    }
}

#[test]
fn no_logs_means_no_streak() {
    assert_eq!(longest_streak(&[], 0), 0);
}

#[test]
fn a_single_day_is_a_streak_of_one() {
    assert_eq!(longest_streak(&[entry(0, 3)], 0), 1);
}

#[test]
fn consecutive_days_accumulate() {
    let logs: Vec<ReviewLog> = (0..5).map(|day| entry(day, 3)).collect();
    assert_eq!(longest_streak(&logs, 0), 5);
}

#[test]
fn a_missed_day_breaks_the_run() {
    // Days 0, 1 then 4, 5, 6: the window from 0 to 6 spans seven days but the
    // longest unbroken run is three.
    let logs: Vec<ReviewLog> = [0, 1, 4, 5, 6]
        .iter()
        .map(|day| entry(*day, 3))
        .collect();
    assert_eq!(longest_streak(&logs, 0), 3);
}

#[test]
fn the_longest_run_wins_even_when_it_is_not_the_latest() {
    // Four consecutive days early on, then only two later.
    let logs: Vec<ReviewLog> = [0, 1, 2, 3, 10, 11]
        .iter()
        .map(|day| entry(*day, 3))
        .collect();
    assert_eq!(longest_streak(&logs, 0), 4);
}

#[test]
fn several_reviews_on_one_day_count_once() {
    let logs = vec![entry(0, 3), entry(0, 4), entry(0, 3)];
    assert_eq!(longest_streak(&logs, 0), 1);
}

#[test]
fn a_day_of_wrong_answers_does_not_count() {
    // Ratings 1 and 2 are Again and Hard: neither shows recall.
    let logs = vec![entry(0, 3), entry(1, 1), entry(1, 2), entry(2, 3)];
    // Day 0 and day 2 are correct, with a wrong-only day between them.
    assert_eq!(longest_streak(&logs, 0), 1);
}

#[test]
fn the_learner_offset_is_respected() {
    // Two reviews eight hours apart can fall on the same local day or on two,
    // depending on the offset. At UTC+0 they are one day apart; at UTC-12 the
    // later one is still the previous local day.
    let logs = vec![
        ReviewLog {
            entry_id: "cet4:abandon".into(),
            at: DAY0 + 16 * 3_600_000,
            rating: 3,
            duration_ms: 800,
            mode: "spelling".into(),
        },
        ReviewLog {
            entry_id: "cet4:abandon".into(),
            at: DAY0 + 20 * 3_600_000,
            rating: 3,
            duration_ms: 800,
            mode: "spelling".into(),
        },
    ];

    // Same UTC day, so a streak of one either way.
    assert_eq!(longest_streak(&logs, 0), 1);
    assert_eq!(longest_streak(&logs, -720), 1);
}
