/**
 * Tests that switching practice mode sticks.
 *
 * The bug: `load` depended on `mode`, so choosing a different mode rebuilt it
 * and re-ran the session effect. When a session had been saved, that effect
 * restored the saved mode, and the dropdown sprang back to the previous value.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const entry = {
  id: "cet4:accessory",
  word: "accessory",
  meaning: "附件",
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
  resolveEntries: vi.fn().mockResolvedValue([
    entry,
    { ...entry, id: "cet4:second", word: "abandon" },
    { ...entry, id: "cet4:third", word: "ability" },
  ]),
  saveSession: vi.fn().mockResolvedValue(undefined),
  // A saved session whose mode is spelling, so a restore would overwrite any
  // choice the learner makes.
  loadSession: vi.fn().mockResolvedValue({
    // Three words so skipping one leaves a question on screen.
    ids: [entry.id, "cet4:second", "cet4:third"],
    answered: 0,
    bookId: "cet4",
    scope: "mix",
    mode: "spelling",
    limit: 20,
    updatedAt: 1_700_000_000_000,
  }),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

/** Mount the page in resume mode and let its effects settle. */
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
        resume: true,
        initialMode: "spelling",
        onExit: () => undefined,
        onChange: () => undefined,
        notify: () => undefined,
      }),
    );
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });

  return { host, root, act };
}

/** The mode dropdown. */
function modeSelect(host: HTMLElement): HTMLSelectElement | null {
  const selects = [...host.querySelectorAll("select")] as HTMLSelectElement[];
  return selects.find((select) => select.getAttribute("aria-label") === "模式") ?? null;
}

/** Choose a value the way the browser would. */
async function choose(
  select: HTMLSelectElement,
  value: string,
  act: (callback: () => void | Promise<void>) => Promise<void>,
) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

describe("switching practice mode", () => {
  it("keeps the chosen mode after a restore", async () => {
    const { host, root, act } = await mount();

    const select = modeSelect(host);
    expect(select).not.toBeNull();
    // The saved session was spelling, so that is where it opens.
    expect(select?.value).toBe("spelling");

    await choose(select!, "choice", act);
    expect(modeSelect(host)?.value).toBe("choice");

    await act(async () => {
      root.unmount();
    });
  });

  it("allows switching again to a third mode", async () => {
    const { host, root, act } = await mount();

    await choose(modeSelect(host)!, "choice", act);
    await choose(modeSelect(host)!, "dictation", act);

    expect(modeSelect(host)?.value).toBe("dictation");

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the mode when the question advances", async () => {
    const { host, root, act } = await mount();

    await choose(modeSelect(host)!, "dictation", act);

    // Answering should not reset the mode.
    const buttons = [...host.querySelectorAll("button")];
    const skip = buttons.find((button) => button.textContent === "跳过");
    skip?.click();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(modeSelect(host)?.value).toBe("dictation");

    await act(async () => {
      root.unmount();
    });
  });
});
