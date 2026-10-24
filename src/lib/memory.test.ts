/**
 * Tests for the memory standing readout.
 *
 * The old percentage read 100% every time a word was practised, because
 * retrievability measures decay since the last review and is at its maximum
 * at the moment of review. These tests pin the bands that replaced it.
 */

import { describe, expect, it } from "vitest";

import { memoryStanding } from "./memory";
import type { FsrsCard } from "./types";

/** A card with the given stability, enough for these bands. */
function card(stability: number): FsrsCard {
  return {
    due: 0,
    stability,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: stability,
    reps: 1,
    lapses: 0,
    state: 2,
    lastReview: 0,
  } as FsrsCard;
}

describe("memoryStanding", () => {
  it("reports a word never seen as new", () => {
    const standing = memoryStanding(null);
    expect(standing.tone).toBe("new");
    expect(standing.label).toBe("新词");
    expect(standing.intervalDays).toBe(0);
  });

  it("treats a one-day interval as still fragile", () => {
    const standing = memoryStanding(card(1));
    expect(standing.tone).toBe("fragile");
    expect(standing.intervalDays).toBe(1);
  });

  it("separates a short interval from a week-long one", () => {
    expect(memoryStanding(card(3)).tone).toBe("fragile");
    expect(memoryStanding(card(10)).tone).toBe("settling");
  });

  it("calls a month-long interval solid", () => {
    const standing = memoryStanding(card(45));
    expect(standing.tone).toBe("solid");
    expect(standing.label).toBe("稳固");
  });

  it("never reports a zero-day interval for a known word", () => {
    // Stability can round down to zero for a very young card; the interval
    // shown must still read as at least a day.
    expect(memoryStanding(card(0.2)).intervalDays).toBe(1);
  });

  it("carries the review and lapse counts through", () => {
    const standing = memoryStanding(card(10), 4, 2);
    expect(standing.reviews).toBe(4);
    expect(standing.lapses).toBe(2);
  });

  it("gives distinct labels across the bands", () => {
    const labels = new Set([
      memoryStanding(null).label,
      memoryStanding(card(1)).label,
      memoryStanding(card(10)).label,
      memoryStanding(card(45)).label,
    ]);
    // A readout that always said the same thing would not be worth showing.
    expect(labels.size).toBeGreaterThanOrEqual(3);
  });
});
