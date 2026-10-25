/**
 * Grading must accept a headword typed without its spelling-variant markers.
 *
 * The bundled CET-4 core book writes some words as `hono(u)r` and
 * `realise/-ize`. Comparing the typed answer character for character marked
 * `honour` wrong, which made those entries impossible to answer in the
 * spelling mode.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

/** One entry as the bundled book now stores it: clean headword, variant noted. */
const entry = {
  id: "cet4core:honour",
  word: "honour",
  meaning: "n. 荣誉；荣幸 v. 尊敬（亦作 honor）",
  pos: "n.",
  phonetic: "",
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
  recordReview: vi.fn().mockResolvedValue({}),
  removeFromNotebook: vi.fn().mockResolvedValue(undefined),
  recordStudyTime: vi.fn().mockResolvedValue(undefined),
  resolveEntries: vi.fn().mockResolvedValue([entry]),
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: vi.fn().mockResolvedValue(null),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

/** Mount the practice page in spelling mode and type an answer. */
async function typeAnswer(answer: string) {
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
        initialMode: "spelling",
        onExit: () => undefined,
        onChange: () => undefined,
        notify: () => undefined,
      }),
    );
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

  const field = host.querySelector("input") as HTMLInputElement | null;
  expect(field, "the answer field should render").not.toBeNull();

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, answer);
    field!.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  const submit = [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "判定",
  );
  await act(async () => {
    submit?.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });

  return { host, root, act };
}

describe("grading a headword with variant markers", () => {
  it("accepts the plain spelling", async () => {
    const { host, root, act } = await typeAnswer("honour");
    expect(host.textContent).toContain("答对了");

    await act(async () => {
      root.unmount();
    });
  });

  it("accepts the alternative spelling", async () => {
    const { host, root, act } = await typeAnswer("honor");
    expect(host.textContent).toContain("答对了");

    await act(async () => {
      root.unmount();
    });
  });

  it("still marks a wrong answer wrong", async () => {
    const { host, root, act } = await typeAnswer("horror");
    expect(host.textContent).not.toContain("答对了");

    await act(async () => {
      root.unmount();
    });
  });
});
