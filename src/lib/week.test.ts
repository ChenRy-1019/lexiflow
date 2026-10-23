/**
 * Tests for the weekly chart labels.
 *
 * The backend returns the seven most recent days ending today, so the label
 * of the last bar must be today's weekday. Hard-coding Monday through Sunday
 * put a Friday under "日", which is the bug these tests guard against.
 */

import { describe, expect, it, vi, afterEach } from "vitest";

import { weekDayLabels } from "./week";

/** Replace the system clock so the labels are deterministic. */
function useDate(iso: string): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("weekDayLabels", () => {
  it("returns seven labels", () => {
    useDate("2026-10-23T12:00:00+08:00");
    expect(weekDayLabels()).toHaveLength(7);
  });

  it("marks only the last day as today", () => {
    useDate("2026-10-23T12:00:00+08:00");
    const days = weekDayLabels();
    const todays = days.filter((day) => day.isToday);
    expect(todays).toHaveLength(1);
    expect(days[6].isToday).toBe(true);
  });

  it("labels a Friday as 五 rather than 日", () => {
    // 2026-10-23 is a Friday.
    useDate("2026-10-23T12:00:00+08:00");
    const days = weekDayLabels();
    expect(days[6].label).toBe("五");
  });

  it("labels a Sunday as 日", () => {
    // 2026-10-25 is a Sunday.
    useDate("2026-10-25T12:00:00+08:00");
    expect(weekDayLabels()[6].label).toBe("日");
  });

  it("counts backwards from today", () => {
    // 2026-10-23 is a Friday, so the window runs Saturday through Friday.
    useDate("2026-10-23T12:00:00+08:00");
    const labels = weekDayLabels().map((day) => day.label);
    expect(labels).toEqual(["六", "日", "一", "二", "三", "四", "五"]);
  });

  it("handles a window that crosses a month boundary", () => {
    // 2026-11-02 is a Monday; the window starts on 2026-10-27.
    useDate("2026-11-02T12:00:00+08:00");
    const labels = weekDayLabels().map((day) => day.label);
    expect(labels).toEqual(["二", "三", "四", "五", "六", "日", "一"]);
  });
});
