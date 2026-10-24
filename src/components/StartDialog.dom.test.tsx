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
  fetchSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn().mockResolvedValue(undefined),
}));

/** Mount the dialog with a given goal. */
async function mount(goal: number) {
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
        onStart: () => undefined,
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
});
