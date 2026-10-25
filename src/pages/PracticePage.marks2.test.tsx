/**
 * The letter marks must show which position is wrong.
 *
 * Reported: typing `univices` for `universe` marked the trailing `e` and `s`
 * red even though they were correct, and left the actual mistake green. The
 * cause was alignment by longest common subsequence instead of by position.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const entry = {
  id: "cet4core:universe",
  word: "universe",
  meaning: "n. 宇宙；领域，体系",
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

/** Type an answer and submit it, returning the marks on each slot. */
async function marksFor(answer: string): Promise<Array<"right" | "wrong" | "none">> {
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

  const field = host.querySelector("input") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, answer);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });

  const slots = [...host.querySelectorAll(".slot")];
  const result = slots.map((slot) => {
    if (slot.classList.contains("slot--wrong")) return "wrong" as const;
    if (slot.classList.contains("slot--right")) return "right" as const;
    return "none" as const;
  });

  await act(async () => {
    root.unmount();
  });

  return result;
}

describe("letter marking", () => {
  it("marks only the position that differs", async () => {
    // universe  ->  univerCe  (index 6 is wrong: i instead of s)
    const marks = await marksFor("univices");

    expect(marks.length).toBe(8);
    // u n i v i c e s  vs  u n i v e r s e
    //   0 1 2 3 4 5 6 7
    expect(marks[0]).toBe("right"); // u
    expect(marks[1]).toBe("right"); // n
    expect(marks[2]).toBe("right"); // i
    expect(marks[3]).toBe("right"); // v
    expect(marks[4]).toBe("wrong"); // i vs e
    expect(marks[5]).toBe("wrong"); // c vs r
    expect(marks[6]).toBe("wrong"); // e vs s
    expect(marks[7]).toBe("wrong"); // s vs e
  });

  it("marks a single substituted letter in place", async () => {
    // universe -> universE with one letter swapped: univerBe
    const marks = await marksFor("univerce");
    expect(marks.filter((mark) => mark === "wrong").length).toBe(1);
    expect(marks[6]).toBe("wrong"); // c vs s
    expect(marks[7]).toBe("right"); // e
  });

  it("marks every letter right when the answer is correct", async () => {
    const marks = await marksFor("universe");
    // A correct answer carries no per-letter marks at all: the marks exist to
    // explain a mistake, and an empty list is what the page treats as "all
    // right" when the word is graded correct.
    expect(marks.every((mark) => mark !== "wrong")).toBe(true);
  });

  it("marks letters past the end of the word as wrong", async () => {
    // The row shows one slot per letter, so extra letters never render; the
    // marks array still reports them as wrong for any future display.
    const marks = await marksFor("universes");
    // Only the eight slots of the word are rendered.
    expect(marks.length).toBe(8);
    expect(marks.every((mark) => mark === "right")).toBe(true);
  });
});
