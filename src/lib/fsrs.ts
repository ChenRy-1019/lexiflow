/**
 * FSRS integration.
 *
 * The reference project (Vocabulary Studio) uses a fixed ladder of intervals
 * — 1, 2, 4, 7, 15, 30 days — which treats every word identically. FSRS
 * instead models per-word memory state (stability and difficulty) and
 * schedules each word from the retention probability the learner chose, so
 * easy words drift further apart while fragile ones come back sooner.
 *
 * `ts-fsrs` is the official TypeScript port of the FSRS scheduler.
 */

import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade } from "ts-fsrs";

import type { FsrsCard, Rating } from "./types";

/** How many successful reviews a word needs before it counts as mastered. */
export const MASTERY_THRESHOLD = 2;

/**
 * FSRS parameters tuned for language learners.
 *
 * The request retention is slightly above the library default: a learner
 * needs to *see* a word again before they can honestly claim to have learnt
 * it, so a 90% target would let words drift away too quickly.
 */
const PARAMETERS = generatorParameters({
  enable_fuzz: true,
  enable_short_term: true,
  maximum_interval: 36500,
  request_retention: 0.9,
});

let scheduler: ReturnType<typeof fsrs> | null = null;

function getScheduler(): ReturnType<typeof fsrs> {
  if (!scheduler) {
    scheduler = fsrs(PARAMETERS);
  }
  return scheduler;
}

/** Epoch milliseconds for "now". */
export function now(): number {
  return Date.now();
}

/**
 * Convert a library card into the flat shape stored in SQLite.
 *
 * Dates become epoch milliseconds so the value survives a JSON round trip
 * without any serialisation plugin.
 */
export function toCard(card: Card): FsrsCard {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    lastReview: card.last_review ? card.last_review.getTime() : 0,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
  };
}

/** Rebuild a library card from the stored shape. */
export function fromCard(card: FsrsCard): Card {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: 0,
    scheduled_days: card.scheduledDays,
    learning_steps: 0,
    reps: card.reps,
    lapses: card.lapses,
    state: 2,
    last_review: card.lastReview ? new Date(card.lastReview) : undefined,
  } as Card;
}

/**
 * Compute the schedule for a review.
 *
 * `card` is `null` for a word the learner has never seen, which produces a
 * first-review schedule based on the chosen rating.
 */
export function review(
  card: FsrsCard | null,
  rating: Rating,
  reviewedAt: number = now(),
): { card: FsrsCard; log: unknown; state: number } {
  const s = getScheduler();
  const input = card ? fromCard(card) : createEmptyCard(new Date(reviewedAt));
  const result = s.next(input, new Date(reviewedAt), rating as Grade);
  return { card: toCard(result.card), log: result.log, state: result.card.state };
}

/**
 * The intervals the learner would get for each button, used to label the
 * answer buttons with "10 min" / "3 days" and so on.
 */
export function previewIntervals(
  card: FsrsCard | null,
  reviewedAt: number = now(),
): Record<Rating, number> {
  const s = getScheduler();
  const input = card ? fromCard(card) : createEmptyCard(new Date(reviewedAt));
  const preview = s.repeat(input, new Date(reviewedAt));

  const labels = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<Rating, number>;
  for (const entry of preview) {
    const rating = entry.log.rating as Rating;
    labels[rating] = (entry.card.due.getTime() - reviewedAt) / 86_400_000;
  }
  return labels;
}

/** Render an interval expressed in days as a short human label. */
export function formatInterval(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "—";

  const minutes = days * 24 * 60;

  // Learning steps are minutes apart, so a day-based label collapsed several
  // different schedules into the same "< 1h" and made the four buttons look
  // identical. Minutes are shown explicitly instead.
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/**
 * Estimate the probability that the learner still remembers a word.
 *
 * This drives the "记忆强度" readout and lets the home page sort by
 * fragility rather than by raw due date.
 */
export function retrievability(card: FsrsCard, at: number = now()): number {
  const s = getScheduler();
  const value = s.get_retrievability(fromCard(card), new Date(at), false);
  return Math.max(0, Math.min(1, value));
}

/**
 * Decide whether a word counts as mastered.
 *
 * Mastery requires two independent successful reviews — a single lucky guess
 * is not enough, and neither is showing the answer.
 */
export function isMastered(correctCount: number): boolean {
  return correctCount >= MASTERY_THRESHOLD;
}
