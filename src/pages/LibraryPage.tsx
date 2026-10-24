import { useMemo, useState } from "react";

import {
  deleteBook,
  fetchBookEntries,
  searchEntries,
  type BookWithStats,
} from "../lib/api";
import ImportDialog from "../components/ImportDialog";
import type { Entry } from "../lib/types";

interface LibraryPageProps {
  books: BookWithStats[];
  onStart: (bookId: string) => void;
  /** Reload the book list after an import or a delete. */
  onRefresh: () => void;
  notify: (message: string) => void;
}

/** The wordbook browser: pick a book, read its words, start studying. */
export default function LibraryPage({
  books,
  onStart,
  onRefresh,
  notify,
}: LibraryPageProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [openBook, setOpenBook] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [searchHits, setSearchHits] = useState<Entry[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const categories = useMemo(
    () => ["全部", ...new Set(books.map((book) => book.category))],
    [books],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return books.filter((book) => {
      if (category !== "全部" && book.category !== category) return false;
      if (!needle) return true;
      return book.name.toLowerCase().includes(needle);
    });
  }, [books, query, category]);

  /** Run a search across the whole vocabulary. */
  const runSearch = async (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setSearchHits(null);
      return;
    }
    const hits = await searchEntries(value.trim());
    setSearchHits(hits);
  };

  /** Open a wordbook and load its entries. */
  const open = async (bookId: string) => {
    setOpenBook(bookId);
    setSearchHits(null);
    setEntries(await fetchBookEntries(bookId));
  };

  if (openBook) {
    const book = books.find((item) => item.id === openBook);
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <button type="button" className="button button--small" onClick={() => setOpenBook(null)}>
            ← 返回
          </button>
          <h2 className="section-title" style={{ margin: 0 }}>
            {book?.name ?? "词书"}
          </h2>
          <span className="chip chip--outline">{entries.length} 词</span>
          <div style={{ flex: 1 }} />
          {openBook.startsWith("import-") && (
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => {
                if (!window.confirm(`删除「${book?.name ?? "这本词书"}」及其词条？学习记录会保留。`)) {
                  return;
                }
                void deleteBook(openBook).then(() => {
                  setOpenBook(null);
                  onRefresh();
                  notify("词书已删除");
                });
              }}
            >
              删除词书
            </button>
          )}
          <button type="button" className="button button--primary" onClick={() => onStart(openBook)}>
            学习这本
          </button>
        </div>

        <div className="card">
          <div className="card__body" style={{ maxHeight: "60vh", overflowY: "auto" }}>
            <div className="list">
              {entries.slice(0, 400).map((entry) => (
                <div className="list__row" key={entry.id}>
                  <div style={{ width: 190 }}>
                    <span className="word" style={{ fontSize: 15 }}>
                      {entry.word}
                    </span>
                    {entry.phonetic && (
                      <span className="word" style={{ fontSize: 11, color: "var(--ink-faint)", marginLeft: 8 }}>
                        /{entry.phonetic}/
                      </span>
                    )}
                  </div>
                  <div className="gloss" style={{ flex: 1, color: "var(--ink-muted)" }}>
                    {entry.meaning}
                  </div>
                  {entry.etymology && (
                    <span className="chip chip--outline" style={{ maxWidth: 260, overflow: "hidden" }}>
                      {entry.etymology}
                    </span>
                  )}
                </div>
              ))}
              {entries.length > 400 && (
                <div className="list__row">
                  <span className="gloss" style={{ color: "var(--ink-faint)" }}>
                    仅显示前 400 条，共 {entries.length} 条
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div className="search" style={{ flex: 1, maxWidth: 340 }}>
          <span className="search__icon" aria-hidden="true">
            ⌕
          </span>
          <input
            className="search__input"
            value={query}
            onChange={(event) => void runSearch(event.target.value)}
            placeholder="搜索词书或单词释义"
            aria-label="搜索"
          />
        </div>
        <button type="button" className="button" onClick={() => setImportOpen(true)}>
          导入词书
        </button>
        <select
          className="input"
          style={{ width: "auto" }}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="分类"
        >
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {searchHits && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card__body">
            <h3 className="section-title">搜索结果（{searchHits.length}）</h3>
            <div className="list">
              {searchHits.slice(0, 60).map((entry) => (
                <div className="list__row" key={entry.id}>
                  <span className="word" style={{ width: 190, fontSize: 15 }}>
                    {entry.word}
                  </span>
                  <span className="gloss" style={{ flex: 1, color: "var(--ink-muted)" }}>
                    {entry.meaning}
                  </span>
                  {entry.etymology && <span className="chip chip--outline">{entry.etymology}</span>}
                </div>
              ))}
              {searchHits.length === 0 && (
                <div className="list__row">
                  <span className="gloss" style={{ color: "var(--ink-faint)" }}>
                    没有找到匹配的单词。
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="books">
        {filtered.map((book) => {
          const progress = book.total ? book.mastered / book.total : 0;
          return (
            <button type="button" className="book" key={book.id} onClick={() => void open(book.id)}>
              <div className="book__name">{book.name}</div>
              <div className="book__meta">
                <span className="chip chip--outline">{book.short}</span>
                <span>{book.category}</span>
              </div>
              <p className="gloss" style={{ margin: 0, fontSize: 12, color: "var(--ink-faint)" }}>
                {book.description}
              </p>
              <div className="book__progress">
                <div className="meter">
                  <div className="meter__fill" style={{ width: `${progress * 100}%` }} />
                </div>
                <span className="book__meta">
                  {book.total.toLocaleString()} 词 · 掌握 {book.mastered}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="empty">
          <div className="empty__title">没有匹配的词书</div>
          <p style={{ margin: 0 }}>换个关键词或分类试试。</p>
        </div>
      )}

      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={() => {
            onRefresh();
            setCategory("全部");
            setQuery("");
            setSearchHits(null);
          }}
          notify={notify}
        />
      )}
    </div>
  );
}
