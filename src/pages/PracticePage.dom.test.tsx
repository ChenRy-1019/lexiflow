/**
 * Render the practice page in a real DOM, with effects running.
 *
 * The blank window came from a hook placed after a conditional return, which
 * React rejects at runtime and a type check cannot see. This test mounts the
 * page, lets the effects run, and asserts the question actually appears.
 */

// @vitest-environment jsdom

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

/** Render the page and let its effects settle. */
async function mount() {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { createElement } = await import("react");
  const { default: PracticePage } = await import("./PracticePage");

  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById("host")!;
  const root = createRoot(host);

  await act(async () => {
    root.render(
      createElement(PracticePage, {
        books: [],
        onExit: () => undefined,
        onChange: () => undefined,
        notify: () => undefined,
      }),
    );
  });

  // Flush the promise chain that loads the session.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  return { host, root, act };
}

describe("PracticePage in a real DOM", () => {
  it("shows the question rather than a blank page", async () => {
    const { host, root, act } = await mount();

    expect(host.textContent).toBeTruthy();
    expect(host.textContent).not.toBe("");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders the answer field", async () => {
    const { host, root, act } = await mount();

    const field = host.querySelector("input");
    expect(field).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the toolbar outside the scrolling body", async () => {
    const { host, root, act } = await mount();

    const toolbar = host.querySelector(".practice__toolbar");
    const body = host.querySelector(".practice__body");

    expect(toolbar).not.toBeNull();
    expect(body).not.toBeNull();
    // The toolbar must be a sibling of the scrolling body, not inside it,
    // otherwise it scrolls away with the question.
    expect(body?.contains(toolbar)).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });
});
