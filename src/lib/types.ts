/**
 * Shared domain types for LexiFlow.
 *
 * The vocabulary payload is deliberately split from the review state so that a
 * wordbook (static, shipped with the app) and a user's progress (dynamic, kept
 * in SQLite) never get confused with one another.
 */

/** A single dictionary entry as it appears in a wordbook. */
export interface LexiconEntry {
  /** Stable identifier: `<bookId>:<slugified word>`. */
  id: string;
  /** The English headword or phrase. */
  word: string;
  /** Chinese gloss, `；` separated when a word has several senses. */
  meaning: string;
  /** Part of speech, already normalised to a short tag such as `n.` or `v.`. */
  pos: string;
  /** IPA transcription without slashes. Empty when unknown. */
  phonetic: string;
  /** Example sentence in English. Empty when unknown. */
  example: string;
  /** Example sentence translation. Empty when unknown. */
  exampleZh: string;
  /** Whether the entry is a multi-word phrase rather than a single word. */
  phrase: boolean;
  /** Roots, affixes and mnemonics attached by the AI helper. Empty by default. */
  etymology: string;
}

/** A dictionary entry as the backend returns it. */
export type Entry = LexiconEntry;

/** Metadata describing one wordbook. */
export interface Wordbook {
  id: string;
  name: string;
  /** Category used for filtering in the library, e.g. `考试` or `通用`. */
  category: string;
  /** Short badge shown on the card, e.g. `CET-4`. */
  short: string;
  description: string;
  /** Number of entries in the book. */
  total: number;
}
/** One learning session's answer for a single entry. */
export interface ReviewCard {
  /** FK into `entries`. */
  entryId: string;
  /** FSRS scheduling state. `null` until the word has been seen once. */
  card: FsrsCard | null;
  /** FSRS memory state, used to estimate retention. */
  state: number;
  /** Epoch milliseconds of the next scheduled review. */
  due: number;
  /** Epoch milliseconds of the first time the word was seen. */
  firstSeenAt: number;
  /** Epoch milliseconds of the most recent review. */
  lastSeenAt: number;
  /** Lifetime count of correct answers. */
  correctCount: number;
  /** Lifetime count of incorrect answers. */
  lapseCount: number;
  /** Whether the word reached the mastery threshold. */
  mastered: boolean;
}

/**
 * FSRS card state.
 *
 * The four states mirror the official FSRS implementation: `0` new,
 * `1` learning, `2` review, `3` relearning.
 */
export type FsrsCard = {
  /** Days until the card is due, floored at zero. */
  due: number;
  /** Current stability in days. */
  stability: number;
  /** Current difficulty, clamped to `[1, 10]`. */
  difficulty: number;
  /** Epoch milliseconds of the last review. */
  lastReview: number;
  /** Epoch milliseconds the card entered its current state. */
  scheduledDays: number;
  /** Number of consecutive successful reviews. */
  reps: number;
  /** Number of times the card was forgotten. */
  lapses: number;
  /** Epoch milliseconds the card was created. */
  dueAt?: number;
};

/** The four buttons available when reviewing a card. */
export type Rating = 1 | 2 | 3 | 4;

/** A recorded review, used for statistics and for FSRS optimisation. */
export interface ReviewLog {
  entryId: string;
  /** Epoch milliseconds. */
  at: number;
  rating: Rating;
  /** The rating the user actually chose. */
  durationMs: number;
  /** Which study mode produced the review. */
  mode: StudyMode;
}

/** Study modes offered by the practice page. */
export type StudyMode = "spelling" | "choice" | "dictation";

/** Which slice of the vocabulary a session draws from. */
export type StudyScope = "mix" | "new" | "review";

/** The answer feedback shown after a question is graded. */
export interface AnswerResult {
  correct: boolean;
  expected: string;
  /** What the user typed, when the mode was free-text. */
  typed: string;
  /** Per-letter correctness flags aligned with `typed`. */
  marks: boolean[];
  skipped: boolean;
  revealed: boolean;
  /** Whether the word is now considered mastered. */
  mastered: boolean;
}

/** A question queued for the current session. */
export interface SessionItem {
  entry: LexiconEntry;
  /** The FSRS state before this question, for rollback on "previous". */
  priorCard: FsrsCard | null;
  /** Whether this entry was already scheduled for review. */
  isReview: boolean;
}

/** Aggregated numbers shown on the home and statistics pages. */
export interface DashboardStats {
  /** Words first learned today, de-duplicated across wordbooks. */
  todayNew: number;
  /** Words due for review right now. */
  dueCount: number;
  /** Total number of words the user has started. */
  started: number;
  /** Total number of words marked as mastered. */
  mastered: number;
  /** Current daily streak in days. */
  streak: number;
  /** Correct answers over the last seven days, one entry per day. */
  weekly: number[];
  /** Total seconds spent studying. */
  studySeconds: number;
  /** Reviews in the last seven days, new words and repeats alike. */
  weekReviews?: number;
  /** Share of those reviews answered correctly, 0..100. */
  weekAccuracy?: number;
  /** The longest run of consecutive study days on record. */
  bestStreak?: number;
}
