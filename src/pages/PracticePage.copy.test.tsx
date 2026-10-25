/**
 * After copying the answer the same word must come back for a blind attempt.
 *
 * The report: pressing 「抄写完成，再默写一遍」 moved straight to the next word
 * instead of hiding the answer and letting the learner type it again.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const first = {
  id: "cet4core:enrich",
  word: "enrich",
  meaning: "v. 充实；使丰富",
  pos: "v.",
  phonetic: "",
  example: "",
  exampleZh: "",
  phrase: false,
  etymology: "",
};

const second = {
  id: "cet4core:enable",
  word: "enable",
  meaning: "v. 使能够",
  pos: "v.",
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
    { entry: first, isReview: false, card: null, retrievability: 1 },
    { entry: second, isReview: false, card: null, retrievability: 1 },
  ]),
  fetchCards: vi.fn().mockResolvedValue({}),
  fetchSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn().mockResolvedValue(undefined),
  recordReview: vi.fn().mockResolvedValue({}),
  removeFromNotebook: vi.fn().mockResolvedValue(undefined),
  recordStudyTime: vi.fn().mockResolvedValue(undefined),
  resolveEntries: vi.fn().mockResolvedValue([first, second]),
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: vi.fn().mockResolvedValue(null),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

/** Mount in spelling mode. */
async function mount() {
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
    await new Promise((resolve) => setTimeout(resolve, 180));
  });

  return { host, root, act };
}

/** Type into the answer field. */
async function type(
  host: HTMLElement,
  text: string,
  act: (cb: () => void | Promise<void>) => Promise<void>,
) {
  const field = host.querySelector("input") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

/** Click a button by its text. */
async function press(
  host: HTMLElement,
  label: string,
  act: (cb: () => void | Promise<void>) => Promise<void>,
) {
  const button = [...host.querySelectorAll("button")].find((element) =>
    element.textContent?.trim().startsWith(label),
  );
  expect(button, `button "${label}" should exist`).toBeDefined();
  await act(async () => {
    button!.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

describe("the copy step", () => {
  it("returns to the same word with the answer hidden", async () => {
    const { host, root, act } = await mount();

    // The question shows the gloss of the first word.
    expect(host.textContent).toContain("充实");

    await press(host, "显示答案", act);
    expect(host.textContent).toContain("看着这个单词抄写一遍");

    // Copy the answer, then finish the step.
    await type(host, "enrich", act);
    await press(host, "抄写完成", act);

    // Still the same word: the gloss has not changed to the next entry.
    expect(host.textContent).toContain("充实");
    expect(host.textContent).not.toContain("使能够");

    // The copy panel is gone and the field is empty and usable again.
    expect(host.textContent).not.toContain("看着这个单词抄写一遍");
    const field = host.querySelector("input") as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.disabled).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("finishes the copy step instead of grading when Enter is pressed", async () => {
    const { host, root, act } = await mount();

    await press(host, "显示答案", act);
    await type(host, "enrich", act);

    // Pressing Enter is the habit from the normal flow; it must complete the
    // copy, not grade the word and jump ahead.
    const field = host.querySelector("input") as HTMLInputElement;
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    // Same word, answer hidden, ready for the blind attempt.
    expect(host.textContent).toContain("充实");
    expect(host.textContent).not.toContain("使能够");
    expect(host.textContent).not.toContain("看着这个单词抄写一遍");
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("");

    await act(async () => {
      root.unmount();
    });
  });
});
