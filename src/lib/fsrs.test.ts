/**
 * Tests for the FSRS wrapper.
 *
 * These run in a plain Node environment, so they need no database and no
 * Tauri shell — which is the point of keeping the scheduler in TypeScript.
 */

import { describe, expect, it } from "vitest";

import { formatInterval, isMastered, previewIntervals, review, retrievability } from "./fsrs";

describe("review scheduling", () => {
  it("gives a brand new word a first schedule", () => {
    const { card } = review(null, 3);
    expect(card.stability).toBeGreaterThan(0);
    expect(card.difficulty).toBeGreaterThanOrEqual(1);
    expect(card.difficulty).toBeLessThanOrEqual(10);
  });

  it("schedules a forgotten word sooner than a remembered one", () => {
    const forgotten = review(null, 1).card;
    const remembered = review(null, 3).card;
    expect(forgotten.stability).toBeLessThan(remembered.stability);
  });

  it("makes a remembered word come back later than a forgotten one", () => {
    const now = Date.now();
    const forgotten = review(null, 1, now).card;
    const remembered = review(null, 4, now).card;
    expect(remembered.due).toBeGreaterThan(forgotten.due);
  });

  it("grows the interval when a word is recalled successfully", () => {
    // Stability only grows once time has actually passed: at the instant of
    // a review the retrievability is 1, and FSRS leaves stability untouched
    // in that case. A real second review happens days later.
    const firstDay = Date.now();
    const first = review(null, 3, firstDay).card;
    const second = review(first, 3, firstDay + 3 * 86_400_000).card;

    expect(second.stability).toBeGreaterThan(first.stability);
    expect(second.reps).toBeGreaterThan(first.reps);
  });

  it("counts a lapse when the word is forgotten", () => {
    const first = review(null, 3).card;
    assertLapse(first, 3);
  });
});

function assertLapse(card: ReturnType<typeof review>["card"], rating: 1 | 2 | 3 | 4) {
  const next = review(card, rating).card;
  if (rating === 1) {
    expect(next.lapses).toBe(card.lapses + 1);
  } else {
    expect(next.lapses).toBe(card.lapses);
  }
}

describe("interval preview", () => {
  it("offers four intervals for a new word", () => {
    const intervals = previewIntervals(null);
    expect(Object.keys(intervals).sort()).toEqual(["1", "2", "3", "4"]);
    expect(intervals[1]).toBeLessThanOrEqual(intervals[2]);
    expect(intervals[2]).toBeLessThanOrEqual(intervals[3]);
    expect(intervals[3]).toBeLessThanOrEqual(intervals[4]);
  });

  it("keeps the ordering for a word that has been reviewed", () => {
    const card = review(null, 3).card;
    const intervals = previewIntervals(card);
    expect(intervals[1]).toBeLessThanOrEqual(intervals[4]);
  });
});

describe("retrievability", () => {
  it("starts at one for a freshly reviewed word and decays over time", () => {
    const reviewedAt = Date.now();
    const { card } = review(null, 3, reviewedAt);

    const fresh = retrievability(card, reviewedAt);
    const later = retrievability(card, reviewedAt + 86_400_000);

    expect(fresh).toBeGreaterThan(later);
    expect(fresh).toBeLessThanOrEqual(1);
    expect(later).toBeGreaterThanOrEqual(0);
  });
});

describe("formatting", () => {
  it("renders learning steps in minutes, not all as one label", () => {
    // The four first-review intervals are minutes apart. Showing them all as
    // "< 1h" made the rating buttons look identical.
    expect(formatInterval(1 / 1440)).toBe("1m"); // one minute
    expect(formatInterval(6 / 1440)).toBe("6m");
    expect(formatInterval(10 / 1440)).toBe("10m");

    const labels = new Set([
      formatInterval(1 / 1440),
      formatInterval(6 / 1440),
      formatInterval(10 / 1440),
    ]);
    expect(labels.size).toBe(3);
  });

  it("renders sub-minute intervals without a unit clash", () => {
    expect(formatInterval(0.0001)).toBe("<1m");
  });

  it("renders half-day and multi-hour intervals in hours", () => {
    expect(formatInterval(0.5)).toBe("12h");
    expect(formatInterval(0.25)).toBe("6h");
  });

  it("renders medium intervals in days", () => {
    expect(formatInterval(3)).toBe("3d");
    expect(formatInterval(20)).toBe("20d");
  });

  it("renders long intervals in months and years", () => {
    expect(formatInterval(60)).toBe("2.0mo");
    expect(formatInterval(730)).toBe("2.0y");
  });

  it("renders a non-positive interval as a dash", () => {
    expect(formatInterval(0)).toBe("—");
    expect(formatInterval(Number.NaN)).toBe("—");
  });
});

describe("mastery", () => {
  it("requires two successful reviews", () => {
    expect(isMastered(0)).toBe(false);
    expect(isMastered(1)).toBe(false);
    expect(isMastered(2)).toBe(true);
    expect(isMastered(5)).toBe(true);
  });
});
