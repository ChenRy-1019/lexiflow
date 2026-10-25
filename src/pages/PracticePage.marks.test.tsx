/**
 * Marking and slot behaviour after an answer.
 *
 * Two reports:
 *
 *   * the choice mode turned the correct option green but left the wrong pick
 *     unmarked;
 *   * the spelling slots grew past the word, so a long typo padded the row.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const entry = {
  id: "cet4:abandon",
  word: "abandon",
  meaning: "vt.丢弃；放弃，抛弃",
  pos: "v.",
  phonetic: "",
  example: "",
  exampleZh: "",
  phrase: false,
  etymology: "",
};

const choices = [
  { entryId: "other-1", text: "n. 能力；本领", correct: false },
  { entryId: "cet4:abandon", text: "vt.丢弃；放弃，抛弃", correct: true },
  { entryId: "other-2", text: "a. 缺席的", correct: false },
  { entryId: "other-3", text: "adv. 绝对地", correct: false },
];

vi.mock("../lib/api", () => ({
  addToNotebook: vi.fn().mockResolvedValue(undefined),
  buildChoices: vi.fn().mockResolvedValue(choices),
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

async function mount(mode: string) {
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
        initialMode: mode,
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

describe("choice marking", () => {
  it("marks the wrong pick red and the answer green", async () => {
    const { host, root, act } = await mount("choice");

    const options = [...host.querySelectorAll(".choice")];
    expect(options.length).toBe(4);

    // Click the first option, which is not the answer.
    await act(async () => {
      (options[0] as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    const wrong = host.querySelectorAll(".choice--wrong");
    const correct = host.querySelectorAll(".choice--correct");

    expect(wrong.length, "the picked option should be marked wrong").toBe(1);
    expect(correct.length).toBe(1);

    // The wrong mark is on the option that was clicked, not the answer.
    expect((wrong[0] as HTMLElement).textContent).toContain("能力");

    await act(async () => {
      root.unmount();
    });
  });

  it("marks only green when the answer is right", async () => {
    const { host, root, act } = await mount("choice");

    const options = [...host.querySelectorAll(".choice")];
    await act(async () => {
      (options[1] as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    expect(host.querySelectorAll(".choice--wrong").length).toBe(0);
    expect(host.querySelectorAll(".choice--correct").length).toBe(1);

    await act(async () => {
      root.unmount();
    });
  });
});

describe("spelling slots", () => {
  it("shows one slot per letter of the word, however long the typo", async () => {
    const { host, root, act } = await mount("spelling");

    const field = host.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

    // "abandon" has 7 letters; type far more.
    await act(async () => {
      setter?.call(field, "abandonment");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(host.querySelectorAll(".slot").length).toBe(7);

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the slot count when the answer is short", async () => {
    const { host, root, act } = await mount("spelling");

    const field = host.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

    await act(async () => {
      setter?.call(field, "ab");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(host.querySelectorAll(".slot").length).toBe(7);

    await act(async () => {
      root.unmount();
    });
  });
});
