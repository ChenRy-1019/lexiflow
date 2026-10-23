/**
 * The bridge between the React frontend and the Rust backend.
 *
 * Every call goes through Tauri IPC. In a browser (during `vite dev` without
 * the Tauri shell) the calls resolve to empty data instead of throwing, so the
 * UI can still be developed and styled in a plain browser.
 */

import { invoke } from "@tauri-apps/api/core";

import type {
  DashboardStats,
  Entry,
  Rating,
  StudyMode,
  StudyScope,
  Wordbook,
} from "./types";

/** Whether the app is running inside the Tauri shell. */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** A wordbook together with the learner's progress in it. */
export interface BookWithStats extends Wordbook {
  started: number;
  mastered: number;
}

/** One queued question, as returned by the backend. */
export interface StudyItem {
  entry: Entry;
  isReview: boolean;
  card: unknown;
  retrievability: number;
}

/** One multiple-choice option. */
export interface Choice {
  entryId: string;
  text: string;
  correct: boolean;
}

/** The result of recording a review. */
export interface GradedAnswer {
  correct: boolean;
  expected: string;
  typed: string;
  marks: boolean[];
  mastered: boolean;
  correctCount: number;
}

/** The learner's UTC offset in minutes. */
export function localOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/** A stored review card. */
export interface StoredCard {
  entryId: string;
  card: string | null;
  state: number;
  due: number;
  firstSeenAt: number;
  lastSeenAt: number;
  correctCount: number;
  lapseCount: number;
  mastered: boolean;
}

/** A word in the notebook. */
export interface NotebookItem {
  entryId: string;
  addedAt: number;
  wrongCount: number;
}

/** Call a backend command, returning `fallback` when the shell is absent. */
async function call<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  fallback: T,
): Promise<T> {
  if (!isTauri()) return fallback;
  return invoke<T>(command, args);
}

/** Dashboard counters for the home page. */
export async function fetchStats(): Promise<DashboardStats> {
  return call<DashboardStats>(
    "dashboard_stats",
    { localOffsetMinutes: localOffsetMinutes() },
    {
      todayNew: 0,
      dueCount: 0,
      started: 0,
      mastered: 0,
      streak: 0,
      weekly: [0, 0, 0, 0, 0, 0, 0],
      studySeconds: 0,
    },
  );
}

/** Every wordbook with the learner's counters. */
export async function fetchBooks(): Promise<BookWithStats[]> {
  return call<BookWithStats[]>("list_books", undefined, []);
}
/** The entries of one wordbook. */
export async function fetchBookEntries(bookId: string): Promise<Entry[]> {
  return call<Entry[]>("book_entries", { bookId }, []);
}

/** Search the whole vocabulary. */
export async function searchEntries(query: string): Promise<Entry[]> {
  return call<Entry[]>("search_entries", { query }, []);
}

/** Resolve entry ids back into their dictionary entries. */
export async function resolveEntries(entryIds: string[]): Promise<Entry[]> {
  return call<Entry[]>("resolve_entries", { entryIds }, []);
}

/** Build a study session. */
export async function buildSession(
  bookId: string,
  scope: StudyScope,
  limit: number,
): Promise<StudyItem[]> {
  return call<StudyItem[]>(
    "build_session",
    {
      request: {
        bookId,
        scope,
        limit,
        localOffsetMinutes: localOffsetMinutes(),
      },
    },
    [],
  );
}

/** Build the multiple-choice options for one question. */
export async function buildChoices(entryId: string, bookId: string): Promise<Choice[]> {
  return call<Choice[]>("build_choices", { entryId, bookId }, []);
}

/** Record a completed review. */
export async function recordReview(params: {
  entryId: string;
  rating: Rating;
  mode: StudyMode;
  durationMs: number;
  cardJson: string | null;
  due: number;
  state: number;
  correct: boolean;
}): Promise<GradedAnswer> {
  return call<GradedAnswer>(
    "record_review",
    {
      request: {
        entryId: params.entryId,
        rating: params.rating,
        mode: params.mode,
        durationMs: params.durationMs,
        localOffsetMinutes: localOffsetMinutes(),
      },
      cardJson: params.cardJson,
      due: params.due,
      stateValue: params.state,
      correct: params.correct,
    },
    {
      correct: params.correct,
      expected: "",
      typed: "",
      marks: [],
      mastered: false,
      correctCount: 0,
    },
  );
}

/** Save a word to the notebook. */
export async function addToNotebook(entryId: string): Promise<void> {
  return call<void>("add_to_notebook", { entryId }, undefined);
}

/** Remove a word from the notebook. */
export async function removeFromNotebook(entryId: string): Promise<void> {
  return call<void>("remove_from_notebook", { entryId }, undefined);
}

/** Every word in the notebook. */
export async function fetchNotebook(): Promise<NotebookItem[]> {
  return call<NotebookItem[]>("list_notebook", undefined, []);
}

/** Every stored review card. */
export async function fetchCards(): Promise<Record<string, StoredCard>> {
  return call<Record<string, StoredCard>>("all_cards", undefined, {});
}

/** Record time spent studying. */
export async function recordStudyTime(seconds: number): Promise<void> {
  return call<void>("record_study_time", { seconds }, undefined);
}

/** Read a setting. */
export async function fetchSetting(key: string): Promise<string | null> {
  return call<string | null>("get_setting", { key }, null);
}

/** Write a setting. */
export async function saveSetting(key: string, value: string): Promise<void> {
  return call<void>("set_setting", { key, value }, undefined);
}

/** Where the database lives. */
export async function fetchDatabasePath(): Promise<string> {
  return call<string>("database_path", undefined, "");
}

/** Total number of bundled entries. */
export async function fetchLexiconTotal(): Promise<number> {
  return call<number>("lexicon_total", undefined, 0);
}

/** Wipe all learning progress. */
export async function resetProgress(): Promise<void> {
  return call<void>("reset_progress", undefined, undefined);
}

/** How a word should be pronounced. */
export type Pronunciation =
  | { kind: "cached"; data: string }
  | { kind: "system"; text: string };

/** Get the pronunciation of a word. */
export async function pronounce(word: string, accent: string): Promise<Pronunciation> {
  return call<Pronunciation>(
    "pronounce",
    { word, accent },
    { kind: "system", text: word },
  );
}

/** Whether a word already has a cached recording. */
export async function hasRecording(word: string, accent: string): Promise<boolean> {
  return call<boolean>("has_recording", { word, accent }, false);
}

/** The state of the pronunciation cache. */
export interface AudioCacheInfo {
  count: number;
  sizeBytes: number;
  directory: string;
}

/** How many recordings are cached, and how much space they take. */
export async function fetchAudioCacheInfo(): Promise<AudioCacheInfo> {
  return call<AudioCacheInfo>(
    "audio_cache_info",
    undefined,
    { count: 0, sizeBytes: 0, directory: "" },
  );
}

/** Remove every cached recording. */
export async function clearAudioCache(): Promise<void> {
  return call<void>("clear_audio_cache", undefined, undefined);
}
