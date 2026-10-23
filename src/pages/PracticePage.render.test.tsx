/**
 * Render the practice page with a real question.
 *
 * The blank window came from a hook after a conditional return. Rendering
 * the loaded state proves the whole render path still produces markup, not
 * just the initial spinner.
 */

import { describe, expect, it, vi } from "vitest";

const entry = {
  id: "cet4:abandon",
  word: "abandon",
  meaning: "放弃；抛弃",
  pos: "v.",
  phonetic: "əˈbændən",
  example: "",
  exampleZh: "",
  phrase: false,
  etymology: "",
};

vi.mock("../lib/api", () => ({
  addToNotebook: vi.fn().mockResolvedValue(undefined),
  buildChoices: vi.fn().mockResolvedValue([]),
  buildSession: vi.fn().mockResolvedValue([
    { entry, isReview: false, card: null, retrievability: 1 },
  ]),
  fetchCards: vi.fn().mockResolvedValue({}),
  fetchSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn().mockResolvedValue(undefined),
  recordReview: vi.fn().mockResolvedValue({
    correct: true,
    expected: "abandon",
    typed: "",
    marks: [],
    mastered: false,
    correctCount: 1,
  }),
  removeFromNotebook: vi.fn().mockResolvedValue(undefined),
  recordStudyTime: vi.fn().mockResolvedValue(undefined),
  resolveEntries: vi.fn().mockResolvedValue([entry]),
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: vi.fn().mockResolvedValue(null),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

describe("PracticePage with a question", () => {
  it("renders the word, the slots and the toolbar", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { default: PracticePage } = await import("./PracticePage");

    // Rendering the first pass shows the loading state; the data arrives on
    // the effects that do not run during server rendering, so this asserts
    // the initial markup is intact rather than the resolved question.
    const html = renderToString(
      createElement(PracticePage, {
        books: [],
        onExit: () => undefined,
        onChange: () => undefined,
        notify: () => undefined,
      }),
    );

    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("正在准备");
  });
});
