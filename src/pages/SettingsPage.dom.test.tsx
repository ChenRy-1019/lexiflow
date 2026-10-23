/**
 * Render the settings page and check the update controls exist.
 *
 * The update section is the part most likely to be dropped by a refactor:
 * it lives behind a lazy chain of settings reads and an optional callback.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.1.1"),
}));

vi.mock("../lib/api", () => ({
  fetchDatabasePath: vi.fn().mockResolvedValue("C:/data/lexiflow.db"),
  fetchLexiconTotal: vi.fn().mockResolvedValue(52523),
  fetchSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn().mockResolvedValue(undefined),
  resetProgress: vi.fn().mockResolvedValue(undefined),
  fetchAudioCacheInfo: vi.fn().mockResolvedValue({ count: 0, sizeBytes: 0, directory: "" }),
  clearAudioCache: vi.fn().mockResolvedValue(undefined),
}));

/** Mount the page and let its effects settle. */
async function mount(onCheckUpdate?: () => void) {
  const { createRoot } = await import("react-dom/client");
  const { createElement, act } = await import("react");
  const { default: SettingsPage } = await import("./SettingsPage");

  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById("host")!;
  const root = createRoot(host);

  await act(async () => {
    root.render(
      createElement(SettingsPage, {
        onReset: () => undefined,
        notify: () => undefined,
        onCheckUpdate,
      }),
    );
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  return { host, root, act };
}

describe("SettingsPage", () => {
  it("shows a software update section with the running version", async () => {
    const { host, root, act } = await mount(() => undefined);

    expect(host.textContent).toContain("软件更新");
    expect(host.textContent).toContain("0.1.1");

    await act(async () => {
      root.unmount();
    });
  });

  it("offers a check button that calls back", async () => {
    const onCheck = vi.fn();
    const { host, root, act } = await mount(onCheck);

    const buttons = [...host.querySelectorAll("button")];
    const checkButton = buttons.find((button) => button.textContent?.includes("检查更新"));
    expect(checkButton).toBeDefined();
    expect(checkButton?.disabled).toBe(false);

    checkButton?.click();
    expect(onCheck).toHaveBeenCalledOnce();

    await act(async () => {
      root.unmount();
    });
  });

  it("shows the typing sound preference", async () => {
    const { host, root, act } = await mount(() => undefined);
    expect(host.textContent).toContain("打字音效");

    await act(async () => {
      root.unmount();
    });
  });

  it("has an automatic check toggle", async () => {
    const { host, root, act } = await mount(() => undefined);

    const text = host.textContent ?? "";
    expect(text).toContain("启动时自动检查更新");

    await act(async () => {
      root.unmount();
    });
  });
});
