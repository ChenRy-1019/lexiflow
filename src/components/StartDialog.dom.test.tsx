/**
 * Render the start dialog and check the size options follow the goal.
 *
 * The dialog used to offer a fixed 10 / 20 / 30 / 50 whatever the learner had
 * set, so a goal of 25 could not be picked from it.
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

/** The size buttons, in order, as their visible number. */
function sizeLabels(host: HTMLElement): string[] {
  const picker = host.querySelector(".size-picker");
  if (!picker) return [];
  return [...picker.querySelectorAll("button")].map(
    (button) => button.textContent?.replace(/词|目标/g, "").trim() ?? "",
  );
}

describe("StartDialog size options", () => {
  it("offers the daily goal for a goal of 25", async () => {
    const { host, root, act } = await mount(25);

    const labels = sizeLabels(host);
    expect(labels).toContain("25");
    // The old fixed list had a 10, which no longer fits a goal of 25.
    expect(labels).not.toContain("10");

    await act(async () => {
      root.unmount();
    });
  });

  it("offers a custom entry instead of the fixed smallest option", async () => {
    const { host, root, act } = await mount(20);

    expect(sizeLabels(host)).toContain("自定义");

    await act(async () => {
      root.unmount();
    });
  });

  it("shows the goal as the default selection", async () => {
    const { host, root, act } = await mount(30);

    const active = host.querySelector(".size-picker__item--active");
    expect(active?.textContent).toContain("30");

    await act(async () => {
      root.unmount();
    });
  });

  it("reveals a free-form field when custom is chosen", async () => {
    const { host, root, act } = await mount(20);

    const buttons = [...host.querySelectorAll(".size-picker button")];
    const custom = buttons.find((button) => button.textContent?.includes("自定义"));
    custom?.click();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const field = host.querySelector(".size-custom input");
    expect(field).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
