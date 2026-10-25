/**
 * The due-count badge starts a review directly.
 *
 * Clicking it used to open the wordbook picker, which is a detour: a review
 * draws from every book the learner has started, so there is nothing to pick.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const entry = {
  id: "cet4:abandon",
  word: "abandon",
  meaning: "放弃",
  pos: "v.",
  phonetic: "",
  example: "",
  exampleZh: "",
  phrase: false,
  etymology: "",
};

const buildSessionMock = vi.fn();

// TitleBar queries the window on mount, so the mock has to answer every call
// it makes rather than only the ones this test triggers.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => undefined),
  }),
}));

vi.mock("./lib/api", () => ({
  addToNotebook: vi.fn().mockResolvedValue(undefined),
  buildChoices: vi.fn().mockResolvedValue([]),
  buildSession: (...args: unknown[]) => buildSessionMock(...args),
  fetchCards: vi.fn().mockResolvedValue({}),
  fetchSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn().mockResolvedValue(undefined),
  recordReview: vi.fn().mockResolvedValue({}),
  removeFromNotebook: vi.fn().mockResolvedValue(undefined),
  recordStudyTime: vi.fn().mockResolvedValue(undefined),
  resolveEntries: vi.fn().mockResolvedValue([entry]),
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: vi.fn().mockResolvedValue(null),
  clearSession: vi.fn().mockResolvedValue(undefined),
  fetchStats: vi.fn().mockResolvedValue({
    todayNew: 27,
    dueCount: 118,
    started: 200,
    mastered: 50,
    streak: 3,
    weekly: [0, 0, 0, 0, 3, 88, 17],
    studySeconds: 3600,
  }),
  fetchBooks: vi.fn().mockResolvedValue([
    {
      id: "cet4",
      name: "大学英语四级词汇",
      category: "国内考试",
      short: "CET-4",
      description: "",
      total: 4756,
      started: 10,
      mastered: 2,
    },
  ]),
  fetchBookEntries: vi.fn().mockResolvedValue([]),
  fetchNotebook: vi.fn().mockResolvedValue([]),
  searchEntries: vi.fn().mockResolvedValue([]),
  fetchDatabasePath: vi.fn().mockResolvedValue(""),
  fetchLexiconTotal: vi.fn().mockResolvedValue(0),
  fetchAudioCacheInfo: vi.fn().mockResolvedValue({ count: 0, sizeBytes: 0, directory: "" }),
  clearAudioCache: vi.fn().mockResolvedValue(undefined),
  resetProgress: vi.fn().mockResolvedValue(undefined),
  isTauri: () => true,
  pronounce: vi.fn().mockResolvedValue({ kind: "system", text: "abandon" }),
  hasRecording: vi.fn().mockResolvedValue(false),
}));

vi.mock("./lib/goal", () => ({
  DEFAULT_DAILY_GOAL: 20,
  goalProgress: () => 0,
  loadDailyGoal: vi.fn().mockResolvedValue(20),
}));

vi.mock("./lib/updater", () => ({
  autoCheckEnabled: vi.fn().mockResolvedValue(false),
  checkForUpdate: vi.fn().mockResolvedValue({ status: { kind: "current", version: "0.2.4" }, update: null }),
  RELEASES_URL: "",
}));

describe("the due-count badge", () => {
  it("opens a review session instead of the wordbook picker", async () => {
    buildSessionMock.mockReset();
    buildSessionMock.mockResolvedValue([
      { entry, isReview: true, card: null, retrievability: 1 },
    ]);

    const { createElement, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");

    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById("host")!;
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(App));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    const badge = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("待复习"),
    );
    expect(badge, "the due badge should render").toBeDefined();

    await act(async () => {
      badge!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    // The practice session was requested, not a dialog.
    expect(buildSessionMock).toHaveBeenCalled();
    const [bookId, scope, limit] = buildSessionMock.mock.calls[0];
    expect(bookId).toBe("");
    expect(scope).toBe("review");
    // The size covers the backlog rather than the daily goal.
    expect(limit).toBe(118);

    // No wordbook picker is on screen.
    expect(host.textContent).not.toContain("选好词书和数量");

    await act(async () => {
      root.unmount();
    });
  });
});
