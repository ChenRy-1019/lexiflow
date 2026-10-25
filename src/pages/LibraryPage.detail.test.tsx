/**
 * The opened wordbook must show every word and be searchable.
 *
 * Reported: a 4540-word book displayed 400 entries with a footer saying so,
 * and the search box vanished once the book was opened. Both were the same
 * mistake — the detail view truncated its list and hid the filter.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

// `act` has to be reachable from each test, not only from the helper that
// renders, so it is imported once at the top.
import { act } from "react";

function makeBook(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `import-1:${index}`,
    word: `word${String(index).padStart(4, "0")}`,
    phonetic: "",
    meaning: `释义 ${index}`,
    pos: "",
    example: "",
    exampleZh: "",
    phrase: false,
    etymology: "",
  }));
}

const entries = makeBook(1000);

const books = [
  {
    id: "import-1",
    name: "测试词书",
    category: "我的词库",
    short: "测试",
    description: "",
    total: 1000,
    started: 0,
    mastered: 0,
  },
];

vi.mock("../lib/api", () => ({
  addToNotebook: vi.fn().mockResolvedValue(undefined),
  buildChoices: vi.fn().mockResolvedValue([]),
  buildSession: vi.fn().mockResolvedValue([]),
  deleteBook: vi.fn().mockResolvedValue(undefined),
  fetchBookEntries: vi.fn().mockResolvedValue(entries),
  fetchCards: vi.fn().mockResolvedValue({}),
  fetchSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn().mockResolvedValue(undefined),
  recordReview: vi.fn().mockResolvedValue({}),
  removeFromNotebook: vi.fn().mockResolvedValue(undefined),
  recordStudyTime: vi.fn().mockResolvedValue(undefined),
  resolveEntries: vi.fn().mockResolvedValue([]),
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: vi.fn().mockResolvedValue(null),
  clearSession: vi.fn().mockResolvedValue(undefined),
  fetchNotebook: vi.fn().mockResolvedValue([]),
  searchEntries: vi.fn().mockResolvedValue([]),
  fetchDatabasePath: vi.fn().mockResolvedValue(""),
  fetchLexiconTotal: vi.fn().mockResolvedValue(0),
  fetchAudioCacheInfo: vi.fn().mockResolvedValue({ count: 0, sizeBytes: 0, directory: "" }),
  clearAudioCache: vi.fn().mockResolvedValue(undefined),
  resetProgress: vi.fn().mockResolvedValue(undefined),
  previewImport: vi.fn(),
  importBook: vi.fn(),
  isTauri: () => true,
}));

/** Render the page, open its only book, and return the host element. */
async function openBook() {
  const { createRoot } = await import("react-dom/client");
  const { createElement } = await import("react");
  const { default: LibraryPage } = await import("./LibraryPage");

  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById("host")!;
  const root = createRoot(host);

  await act(async () => {
    root.render(
      createElement(LibraryPage, {
        books,
        onStart: () => undefined,
        onRefresh: () => undefined,
        notify: () => undefined,
      }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  const tile = host.querySelector(".book") as HTMLButtonElement;
  await act(async () => {
    tile.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });

  return { host, root };
}

describe("wordbook detail", () => {
  it("offers a search box inside the book", async () => {
    const { host, root } = await openBook();

    const field = host.querySelector('input[aria-label="在本词书中搜索"]');
    expect(field).not.toBeNull();
    expect((field as HTMLInputElement).placeholder).toContain("测试词书");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders a page of entries without claiming they are all of them", async () => {
    const { host, root } = await openBook();

    const rows = host.querySelectorAll(".list__row");
    // The first page is 200 entries; the paging footer is a row as well.
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.length).toBeLessThanOrEqual(201);

    const text = host.textContent ?? "";
    expect(text).toContain("继续往下滚动可加载更多");
    expect(text).not.toContain("仅显示前 400 条");

    await act(async () => {
      root.unmount();
    });
  });

  it("filters by word when something is typed", async () => {
    const { host, root } = await openBook();

    const field = host.querySelector('input[aria-label="在本词书中搜索"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(field, "word0007");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const text = host.textContent ?? "";
    // Seven entries match the prefix (0007, 0070-0079 ... only 0007 is exact,
    // plus the ones starting with it), so the count must drop sharply.
    expect(text).toContain("word0007");
    const rows = host.querySelectorAll(".list__row");
    expect(rows.length).toBeLessThan(100);

    await act(async () => {
      root.unmount();
    });
  });

  it("says so when nothing matches", async () => {
    const { host, root } = await openBook();

    const field = host.querySelector('input[aria-label="在本词书中搜索"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(field, "zzzznotaword");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(host.textContent ?? "").toContain("没有匹配");

    await act(async () => {
      root.unmount();
    });
  });
});
