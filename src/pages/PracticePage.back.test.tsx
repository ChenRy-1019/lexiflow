/**
 * Stepping back to the previous word.
 *
 * The practice page could only move forward, so a word rated by mistake was
 * gone. Going back restores the page as it looked before that step; the review
 * already recorded stays in the database, because the move is for a second
 * look rather than for undoing a rating.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const entries = ["alpha", "beta", "gamma"].map((word, index) => ({
  id: `cet4:${word}`,
  word,
  meaning: `释义 ${index}`,
  pos: "",
  phonetic: "",
  example: "",
  exampleZh: "",
  phrase: false,
  etymology: "",
}));

vi.mock("../lib/api", () => ({
  addToNotebook: vi.fn().mockResolvedValue(undefined),
  buildChoices: vi.fn().mockResolvedValue([]),
  buildSession: vi.fn().mockResolvedValue(
    entries.map((entry) => ({ entry, isReview: false, card: null, retrievability: 1 })),
  ),
  fetchCards: vi.fn().mockResolvedValue({}),
  fetchSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn().mockResolvedValue(undefined),
  recordReview: vi.fn().mockResolvedValue({}),
  removeFromNotebook: vi.fn().mockResolvedValue(undefined),
  recordStudyTime: vi.fn().mockResolvedValue(undefined),
  resolveEntries: vi.fn().mockResolvedValue(entries),
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: vi.fn().mockResolvedValue(null),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

/** Mount the page on three words. */
async function mountPractice() {
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
        initialScope: "new",
        initialLimit: 3,
        onExit: () => undefined,
        onChange: () => undefined,
        notify: () => undefined,
      }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  return { host, root, act };
}

/** The meaning the page is showing. */
function shownWord(host: HTMLElement): string {
  return host.querySelector(".practice__prompt")?.textContent ?? "";
}

describe("stepping back", () => {
  it("disables the back control on the first word", async () => {
    const { host, root, act } = await mountPractice();

    const back = host.querySelector(".practice__back-word") as HTMLButtonElement;
    expect(back).not.toBeNull();
    expect(back.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("returns to the word that was just left", async () => {
    const { host, root, act } = await mountPractice();

    const first = shownWord(host);

    // Skip ahead, which is the cheapest way to advance in a test.
    await act(async () => {
      const skip = [...host.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "跳过",
      );
      skip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(shownWord(host)).not.toBe(first);

    // The control becomes usable once there is somewhere to return to.
    const back = host.querySelector(".practice__back-word") as HTMLButtonElement;
    expect(back.disabled).toBe(false);

    await act(async () => {
      back.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(shownWord(host)).toBe(first);

    await act(async () => {
      root.unmount();
    });
  });

  it("accepts Ctrl+Z", async () => {
    const { host, root, act } = await mountPractice();

    const first = shownWord(host);

    await act(async () => {
      const skip = [...host.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "跳过",
      );
      skip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(shownWord(host)).toBe(first);

    await act(async () => {
      root.unmount();
    });
  });

  it("does not re-record the review when stepping back", async () => {
    const { host, root, act } = await mountPractice();
    const api = await import("../lib/api");

    // Answer the first word properly, so a review is written.
    const field = host.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(field, "alpha");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    // Rate it, which advances and writes the review.
    await act(async () => {
      const rate = [...host.querySelectorAll("button")].find(
        (button) => button.textContent?.includes("记得"),
      );
      rate?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    const afterRating = (api.recordReview as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(afterRating).toBeGreaterThan(0);

    // Step back; no second review should be written.
    await act(async () => {
      const back = host.querySelector(".practice__back-word") as HTMLButtonElement;
      back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect((api.recordReview as ReturnType<typeof vi.fn>).mock.calls.length).toBe(afterRating);

    await act(async () => {
      root.unmount();
    });
  });
});
