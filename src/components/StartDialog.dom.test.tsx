/**
 * Tests for the start dialog's size options.
 *
 * The dialog shows the goal and its multiples, with one editable tile for any
 * other value. An earlier version offered a half-goal entry, which produced a
 * stray small number, and revealed the custom field on a second row.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  // The dialog only enables its submit button once a book is chosen, and the
  // book comes from the saved settings, so the mock has to return one.
  fetchSetting: vi.fn((key: string) =>
    Promise.resolve(key === "lastBookId" ? "cet4" : null),
  ),
  saveSetting: vi.fn().mockResolvedValue(undefined),
}));

/** Mount the dialog with a given goal. */
async function mount(goal: number, onStart?: (choice: { limit?: number }) => void) {
  const { createRoot } = await import("react-dom/client");
  const { createElement, act } = await import("react");
  const { default: StartDialog } = await import("./StartDialog");

  const books = [
    {
      id: "cet4",
      name: "大学英语四级词汇",
      category: "国内考试",
      short: "CET-4",
      description: "",
      total: 4756,
      started: 4,
      mastered: 2,
    },
    {
      id: "small",
      name: "小词书",
      category: "国内考试",
      short: "SMALL",
      description: "",
      total: 120,
      started: 0,
      mastered: 0,
    },
  ];

  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById("host")!;
  const root = createRoot(host);

  await act(async () => {
    root.render(
      createElement(StartDialog, {
        books,
        dailyGoal: goal,
        defaultMode: "spelling",
        defaultScope: "mix",
        onCancel: () => undefined,
        onStart: onStart ?? (() => undefined),
      }),
    );
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  return { host, root, act };
}

/** The numeric tiles, in order. */
function sizeLabels(host: HTMLElement): string[] {
  const picker = host.querySelector(".size-picker");
  if (!picker) return [];
  return [...picker.querySelectorAll("button")].map(
    (button) => button.textContent?.replace(/词/g, "").trim() ?? "",
  );
}

describe("StartDialog size options", () => {
  it("offers the goal and its multiples, with no smaller entry", async () => {
    const { host, root, act } = await mount(20);

    // A goal of 20 yields 20, 40 and 60. The old half-goal entry produced a
    // 10 that sat oddly beside the goal.
    expect(sizeLabels(host)).toEqual(["20", "40", "60"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("follows a goal that is not a round number", async () => {
    const { host, root, act } = await mount(25);

    expect(sizeLabels(host)).toEqual(["25", "50", "75"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("has no goal badge on any tile", async () => {
    const { host, root, act } = await mount(20);

    expect(host.querySelector(".size-picker__hint")).toBeNull();
    expect(host.textContent).not.toContain("目标");

    await act(async () => {
      root.unmount();
    });
  });

  it("selects the goal by default", async () => {
    const { host, root, act } = await mount(30);

    const active = host.querySelector(".size-picker__item--active");
    expect(active?.textContent).toContain("30");

    await act(async () => {
      root.unmount();
    });
  });

  it("turns the last tile into a field without adding a row", async () => {
    const { host, root, act } = await mount(20);

    const tiles = host.querySelectorAll(".size-picker > *");
    expect(tiles).toHaveLength(4);

    const entry = host.querySelector(".size-picker__item--entry");
    entry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    // Still four tiles: the field replaces the label inside the last one.
    expect(host.querySelectorAll(".size-picker > *")).toHaveLength(4);
    expect(host.querySelector(".size-entry__input")).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("takes the ceiling from the chosen wordbook", async () => {
    let chosen: { limit?: number } | null = null;
    const { host, root, act } = await mount(20, (choice) => {
      chosen = choice;
    });

    const entry = host.querySelector(".size-picker__item--entry");
    entry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const field = host.querySelector(".size-entry__input") as HTMLInputElement;
    // The ceiling is the size of the book, not a fixed number: the fixture
    // holds 4756 words.
    expect(Number(field.getAttribute("max"))).toBe(4756);

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(field, "4756");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // The submit button stays disabled until the saved settings have loaded,
    // so wait for that before clicking.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await act(async () => {
      const start = [...host.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("开始学习"),
      ) as HTMLButtonElement | undefined;
      expect(start?.disabled).toBe(false);
      start?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(chosen?.limit).toBe(4756);

    await act(async () => {
      root.unmount();
    });
  });

  it("refuses a count above the book's ceiling", async () => {
    let chosen: { limit?: number } | null = null;
    const { host, root, act } = await mount(20, (choice) => {
      chosen = choice;
    });

    const entry = host.querySelector(".size-picker__item--entry");
    entry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const field = host.querySelector(".size-entry__input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    // A value past the book's size is kept in the field while editing but must
    // not become the chosen size.
    await act(async () => {
      setter?.call(field, "4757");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      field.dispatchEvent(new Event("blur", { bubbles: true }));
    });

    await act(async () => {
      const start = [...host.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("开始学习"),
      );
      start?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(chosen?.limit).not.toBe(4757);

    await act(async () => {
      root.unmount();
    });
  });

  it("lowers the count when a smaller book is picked", async () => {
    const { host, root, act } = await mount(20);

    // The fixture has one book of 4756 words; the ceiling follows it.
    const entry = host.querySelector(".size-picker__item--entry");
    entry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const field = host.querySelector(".size-entry__input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(field, "4000");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Choosing another book with fewer words must bring the count down with
    // it, otherwise the session asks for more words than exist.
    await act(async () => {
      const smaller = [...host.querySelectorAll(".book-picker__item")].find((button) =>
        button.getAttribute("data-total") === "120",
      ) as HTMLButtonElement | undefined;
      smaller?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const after = host.querySelector(".size-entry__input") as HTMLInputElement;
    expect(Number(after.getAttribute("max"))).toBe(120);
    expect(Number(after.value)).toBeLessThanOrEqual(120);

    await act(async () => {
      root.unmount();
    });
  });
});
