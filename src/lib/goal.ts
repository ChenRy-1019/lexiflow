/**
 * The learner's daily goal.
 *
 * Stored as a plain number in settings. The home page and the sidebar ring
 * both need it, and a stale copy in either would show the wrong denominator
 * after the learner changes it, so the value is read in one place and passed
 * down.
 */

import { fetchSetting, saveSetting } from "./api";

/** The goal used before the learner picks one. */
export const DEFAULT_DAILY_GOAL = 20;

/** The bounds the settings page enforces. */
export const MIN_DAILY_GOAL = 1;
export const MAX_DAILY_GOAL = 200;

/** Clamp a value into the range every caller can rely on. */
export function clampGoal(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAILY_GOAL;
  return Math.min(MAX_DAILY_GOAL, Math.max(MIN_DAILY_GOAL, Math.round(value)));
}

/** Read the saved daily goal, falling back to the default. */
export async function loadDailyGoal(): Promise<number> {
  const raw = await fetchSetting("dailyGoal");
  if (!raw) return DEFAULT_DAILY_GOAL;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? clampGoal(parsed) : DEFAULT_DAILY_GOAL;
}

/** Persist the daily goal. */
export async function saveDailyGoal(goal: number): Promise<void> {
  await saveSetting("dailyGoal", String(clampGoal(goal)));
}

/** How far through the goal the learner is, 0 to 1. */
export function goalProgress(todayNew: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.min(1, Math.max(0, todayNew / goal));
}
