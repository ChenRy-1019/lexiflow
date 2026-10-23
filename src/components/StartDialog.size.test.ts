/**
 * Tests for the session size options.
 *
 * The quick picks follow the learner's daily goal, and a free-form entry
 * replaced the fixed 10, so these pin the derived list rather than a
 * hard-coded one.
 */

import { describe, expect, it } from "vitest";

/** Mirrors the helper in StartDialog; duplicated to test it in isolation. */
function sizeOptions(goal: number): number[] {
  const around = [goal, Math.max(5, Math.round(goal / 2)), goal * 2, goal * 3];
  return [...new Set(around.map((size) => Math.round(size)))].sort((a, b) => a - b);
}

describe("sizeOptions", () => {
  it("always offers the daily goal", () => {
    expect(sizeOptions(20)).toContain(20);
    expect(sizeOptions(25)).toContain(25);
  });

  it("starts from the goal rather than a fixed list", () => {
    // With a goal of 25 there is no 10 in the list, which is what the dialog
    // used to show regardless of the setting.
    expect(sizeOptions(25)).not.toContain(10);
  });

  it("returns ascending, deduplicated values", () => {
    const sizes = sizeOptions(20);
    const sorted = [...sizes].sort((a, b) => a - b);
    expect(sizes).toEqual(sorted);
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it("keeps every option positive for a small goal", () => {
    for (const size of sizeOptions(5)) {
      expect(size).toBeGreaterThanOrEqual(5);
    }
  });

  it("scales with a large goal", () => {
    const sizes = sizeOptions(60);
    expect(sizes).toContain(60);
    expect(Math.max(...sizes)).toBeGreaterThan(60);
  });
});
