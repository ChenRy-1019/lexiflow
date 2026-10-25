/**
 * Leaving practice, and the keyboard.
 *
 * Escape was the only way out, the rating buttons had no shortcut, and the
 * shortcuts were only discoverable one tooltip at a time.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const entry = {
  id: "cet4core:flutter",
  word: "flutter",
  meaning: "v. 飘动；拍翅",
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

async function mount(onExit: () => void) {
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
        onExit,
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

/** Press a key on the document, as the global listener expects. */
async function pressKey(
  key: string,
  act: (cb: () => void | Promise<void>) => Promise<void>,
  init: KeyboardEventInit = {},
) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

describe("leaving practice", () => {
  it("offers a visible back button", async () => {
    const onExit = vi.fn();
    const { host, root, act } = await mount(onExit);

    const back = host.querySelector(".practice__back") as HTMLButtonElement | null;
    expect(back, "a back button should be present").not.toBeNull();
    expect(back?.getAttribute("aria-label")).toBe("返回首页");

    await act(async () => {
      back!.click();
    });

    expect(onExit).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});

describe("keyboard shortcuts", () => {
  it("opens the shortcut reference with the question mark", async () => {
    const { host, root, act } = await mount(() => undefined);

    expect(host.querySelector(".shortcut-help")).toBeNull();

    await pressKey("?", act);

    const panel = host.querySelector(".shortcut-help");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Ctrl + R");

    await act(async () => {
      root.unmount();
    });
  });

  it("closes the reference with Escape without leaving practice", async () => {
    const onExit = vi.fn();
    const { host, root, act } = await mount(onExit);

    await pressKey("?", act);
    expect(host.querySelector(".shortcut-help")).not.toBeNull();

    await pressKey("Escape", act);

    expect(host.querySelector(".shortcut-help")).toBeNull();
    expect(onExit).not.toHaveBeenCalled();

    // A second Escape then leaves the page.
    await pressKey("Escape", act);
    expect(onExit).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("rates the word with the number keys once the answer is shown", async () => {
    const { host, root, act } = await mount(() => undefined);

    // Reveal the answer so the rating row appears.
    const reveal = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "显示答案",
    );
    await act(async () => {
      reveal!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    // The copy step is open; finish it, then rate with "3".
    const field = host.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(field, "flutter");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const finish = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.trim().startsWith("抄写完成"),
    );
    await act(async () => {
      finish!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    // After the copy the answer is hidden again, so the word has to be typed
    // a second time before the rating row appears.
    await act(async () => {
      setter?.call(field, "flutter");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    // Now 1-4 rate the word; with a single word the round then reports that
    // it is finished.
    await pressKey("3", act, { ctrlKey: false });

    expect(host.textContent).toContain("这一轮完成了");

    await act(async () => {
      root.unmount();
    });
  });
});
