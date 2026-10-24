/**
 * The copy step belongs to the typed modes only.
 *
 * Revealing the answer in the choice mode used to start the copy step, which
 * has no field to type into: the page showed a panel and a submit button that
 * could never be satisfied.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const entry = {
  id: "cet4:a",
  word: "a",
  meaning: "art.一(个)；每一(个)",
  pos: "art.",
  phonetic: "",
  example: "",
  exampleZh: "",
  phrase: false,
  etymology: "",
};

const choices = [
  { entryId: "x1", text: "n.形成；构成", correct: false },
  { entryId: "x2", text: "n.&vi.谋杀", correct: false },
  { entryId: "cet4:a", text: "art.一(个)；每一(个)", correct: true },
  { entryId: "x3", text: "a.永久的", correct: false },
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

/** Mount the page in the given mode. */
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
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

  return { host, root, act };
}

/** Click a button by its visible text. */
async function press(
  host: HTMLElement,
  label: string,
  act: (cb: () => void | Promise<void>) => Promise<void>,
) {
  const button = [...host.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(button, `button "${label}" should exist`).toBeDefined();

  await act(async () => {
    button?.click();
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}

describe("revealing the answer", () => {
  it("does not start a copy step in the choice mode", async () => {
    const { host, root, act } = await mount("choice");

    await press(host, "显示答案", act);

    // No copy panel and no copy button: the mode has no field to type in.
    expect(host.querySelector(".copy-panel")).toBeNull();
    expect(host.textContent).not.toContain("抄写完成");
    expect(host.textContent).not.toContain("看着这个单词抄写一遍");

    // The answer is shown for review instead.
    expect(host.textContent).toContain("已显示答案");

    // The gloss must appear too. In this mode the answer only existed as one
    // of the options, so revealing it left nothing to check the word against.
    const meaning = host.querySelector(".review__meaning");
    expect(meaning).not.toBeNull();
    expect(meaning?.textContent).toBe(entry.meaning);

    await act(async () => {
      root.unmount();
    });
  });

  it("starts a copy step in the spelling mode", async () => {
    const { host, root, act } = await mount("spelling");

    await press(host, "显示答案", act);

    expect(host.querySelector(".copy-panel")).not.toBeNull();
    expect(host.textContent).toContain("看着这个单词抄写一遍");
    expect(host.textContent).toContain("抄写完成");

    await act(async () => {
      root.unmount();
    });
  });

  it("starts a copy step in the dictation mode", async () => {
    const { host, root, act } = await mount("dictation");

    await press(host, "显示答案", act);

    // Dictation has no visible prompt, so the copy panel is the only place the
    // word can be seen.
    expect(host.querySelector(".copy-panel")).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
