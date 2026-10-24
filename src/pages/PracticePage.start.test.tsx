/**
 * A freshly chosen book must not be replaced by a saved session.
 *
 * The reported bug: the learner picked the CET-6 book and asked for 30 words,
 * but the practice page opened a short CET-4 queue read from disk. Starting
 * from the dialog used to fall through to the resume path.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const cet4Entry = {
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

const cet6Entry = {
  id: "import-cet6-0",
  word: "abate",
  meaning: "减少；减弱",
  pos: "v.",
  phonetic: "",
  example: "",
  exampleZh: "",
  phrase: false,
  etymology: "",
};

const buildSessionMock = vi.fn();
const loadSessionMock = vi.fn();
const clearSessionMock = vi.fn();

vi.mock("../lib/api", () => ({
  addToNotebook: vi.fn().mockResolvedValue(undefined),
  buildChoices: vi.fn().mockResolvedValue([]),
  buildSession: (...args: unknown[]) => buildSessionMock(...args),
  fetchCards: vi.fn().mockResolvedValue({}),
  fetchSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn().mockResolvedValue(undefined),
  recordReview: vi.fn().mockResolvedValue({}),
  removeFromNotebook: vi.fn().mockResolvedValue(undefined),
  recordStudyTime: vi.fn().mockResolvedValue(undefined),
  resolveEntries: vi.fn().mockResolvedValue([]),
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: (...args: unknown[]) => loadSessionMock(...args),
  clearSession: (...args: unknown[]) => clearSessionMock(...args),
}));

/** Mount the page and let the initial effects settle. */
async function mount(props: Record<string, unknown>) {
  const { createRoot } = await import("react-dom/client");
  const { createElement, act } = await import("react");
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
        ...props,
      }),
    );
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });

  return { host, root, act };
}

describe("starting a chosen book", () => {
  it("builds that book's session instead of reading a saved one", async () => {
    buildSessionMock.mockReset();
    loadSessionMock.mockReset();
    clearSessionMock.mockReset();

    buildSessionMock.mockResolvedValue([
      { entry: cet6Entry, isReview: false, card: null, retrievability: 1 },
    ]);
    // A stale CET-4 session is on disk.
    loadSessionMock.mockResolvedValue({
      ids: ["cet4:abandon"],
      answered: 4,
      bookId: "cet4",
      scope: "new",
      mode: "spelling",
      limit: 20,
      updatedAt: 1,
    });

    const { root, act } = await mount({
      resume: false,
      initialBookId: "import-cet6-0",
      initialMode: "spelling",
      initialScope: "new",
      initialLimit: 30,
    });

    // The chosen book is the one loaded.
    expect(buildSessionMock).toHaveBeenCalled();
    const [bookId, scope, limit] = buildSessionMock.mock.calls[0];
    expect(bookId).toBe("import-cet6-0");
    expect(scope).toBe("new");
    expect(limit).toBe(30);

    // The saved session was not consulted for the queue, and was cleared so
    // the home page stops offering it.
    expect(loadSessionMock).not.toHaveBeenCalled();
    expect(clearSessionMock).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("still resumes when the learner asked to continue", async () => {
    buildSessionMock.mockReset();
    loadSessionMock.mockReset();
    clearSessionMock.mockReset();

    loadSessionMock.mockResolvedValue({
      ids: ["cet4:abandon", "cet4:ability"],
      answered: 1,
      bookId: "cet4",
      scope: "mix",
      mode: "choice",
      limit: 20,
      updatedAt: 1,
    });

    const { root, act } = await mount({ resume: true });

    expect(loadSessionMock).toHaveBeenCalled();
    // Nothing new was built; the saved queue was restored instead.
    expect(buildSessionMock).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("builds fresh when there is nothing saved to resume", async () => {
    buildSessionMock.mockReset();
    loadSessionMock.mockReset();
    clearSessionMock.mockReset();

    loadSessionMock.mockResolvedValue(null);
    buildSessionMock.mockResolvedValue([
      { entry: cet4Entry, isReview: false, card: null, retrievability: 1 },
    ]);

    const { root, act } = await mount({ resume: true, initialBookId: "cet4" });

    expect(loadSessionMock).toHaveBeenCalled();
    expect(buildSessionMock).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
