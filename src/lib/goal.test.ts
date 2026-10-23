/**
 * Tests for the daily goal.
 *
 * The bug these guard against: the goal was saved but the home page and the
 * sidebar ring both used a hard-coded 20, so changing it updated neither.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchSettingMock = vi.fn();
const saveSettingMock = vi.fn();

vi.mock("./api", () => ({
  fetchSetting: (...args: unknown[]) => fetchSettingMock(...args),
  saveSetting: (...args: unknown[]) => saveSettingMock(...args),
}));

describe("loadDailyGoal", () => {
  beforeEach(() => {
    fetchSettingMock.mockReset();
    saveSettingMock.mockReset();
  });

  it("falls back to the default when nothing is saved", async () => {
    fetchSettingMock.mockResolvedValue(null);
    const { loadDailyGoal, DEFAULT_DAILY_GOAL } = await import("./goal");
    expect(await loadDailyGoal()).toBe(DEFAULT_DAILY_GOAL);
  });

  it("reads the saved value", async () => {
    fetchSettingMock.mockResolvedValue("25");
    const { loadDailyGoal } = await import("./goal");
    expect(await loadDailyGoal()).toBe(25);
  });

  it("clamps a value that is out of range", async () => {
    fetchSettingMock.mockResolvedValue("5000");
    const { loadDailyGoal, MAX_DAILY_GOAL } = await import("./goal");
    expect(await loadDailyGoal()).toBe(MAX_DAILY_GOAL);
  });

  it("ignores a value that is not a number", async () => {
    fetchSettingMock.mockResolvedValue("abc");
    const { loadDailyGoal, DEFAULT_DAILY_GOAL } = await import("./goal");
    expect(await loadDailyGoal()).toBe(DEFAULT_DAILY_GOAL);
  });
});

describe("saveDailyGoal", () => {
  beforeEach(() => {
    fetchSettingMock.mockReset();
    saveSettingMock.mockReset();
  });

  it("stores the goal as a plain number", async () => {
    saveSettingMock.mockResolvedValue(undefined);
    const { saveDailyGoal } = await import("./goal");
    await saveDailyGoal(30);
    expect(saveSettingMock).toHaveBeenCalledWith("dailyGoal", "30");
  });

  it("clamps before saving", async () => {
    saveSettingMock.mockResolvedValue(undefined);
    const { saveDailyGoal, MAX_DAILY_GOAL } = await import("./goal");
    await saveDailyGoal(9999);
    expect(saveSettingMock).toHaveBeenCalledWith("dailyGoal", String(MAX_DAILY_GOAL));
  });
});

describe("goalProgress", () => {
  it("is zero with nothing learned", async () => {
    const { goalProgress } = await import("./goal");
    expect(goalProgress(0, 20)).toBe(0);
  });

  it("is the ratio halfway through", async () => {
    const { goalProgress } = await import("./goal");
    expect(goalProgress(10, 20)).toBe(0.5);
  });

  it("never exceeds one when the goal is beaten", async () => {
    const { goalProgress } = await import("./goal");
    expect(goalProgress(100, 20)).toBe(1);
  });

  it("follows the goal rather than a fixed denominator", async () => {
    const { goalProgress } = await import("./goal");
    // Twenty words is a complete day at a goal of twenty, and a fifth of a
    // much larger goal. A hard-coded denominator would report the same number
    // for both.
    expect(goalProgress(20, 20)).toBe(1);
    expect(goalProgress(20, 100)).toBe(0.2);
  });

  it("is zero for a goal of zero rather than dividing by it", async () => {
    const { goalProgress } = await import("./goal");
    expect(goalProgress(5, 0)).toBe(0);
  });
});
