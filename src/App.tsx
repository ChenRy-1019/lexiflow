import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchBooks, fetchStats, type BookWithStats } from "./lib/api";
import type { DashboardStats } from "./lib/types";
import TitleBar from "./components/TitleBar";
import HomePage from "./pages/HomePage";
import LibraryPage from "./pages/LibraryPage";
import NotebookPage from "./pages/NotebookPage";
import PracticePage from "./pages/PracticePage";
import SettingsPage from "./pages/SettingsPage";
import StatsPage from "./pages/StatsPage";

/** The pages the sidebar can switch between. */
type Page = "home" | "library" | "practice" | "notebook" | "stats" | "settings";

const EMPTY_STATS: DashboardStats = {
  todayNew: 0,
  dueCount: 0,
  started: 0,
  mastered: 0,
  streak: 0,
  weekly: [0, 0, 0, 0, 0, 0, 0],
  studySeconds: 0,
};

const NAV: Array<{ id: Page; label: string; icon: string }> = [
  { id: "home", label: "今日计划", icon: "◷" },
  { id: "library", label: "我的词库", icon: "▤" },
  { id: "practice", label: "开始学习", icon: "▷" },
  { id: "notebook", label: "生词本", icon: "❐" },
  { id: "stats", label: "学习统计", icon: "◨" },
];

const TITLES: Record<Page, { eyebrow: string; title: string }> = {
  home: { eyebrow: "LEARNING SPACE", title: "今日计划" },
  library: { eyebrow: "LEARNING SPACE", title: "我的词库" },
  practice: { eyebrow: "FOCUS", title: "专注练习" },
  notebook: { eyebrow: "COLLECTION", title: "生词本" },
  stats: { eyebrow: "INSIGHT", title: "学习统计" },
  settings: { eyebrow: "PREFERENCES", title: "偏好设置" },
};

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [books, setBooks] = useState<BookWithStats[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  /** Refresh the counters shown in the sidebar and on the home page. */
  const refresh = useCallback(async () => {
    const [nextStats, nextBooks] = await Promise.all([fetchStats(), fetchBooks()]);
    setStats(nextStats);
    setBooks(nextBooks);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Keyboard shortcuts.
   *
   * `Ctrl+1` through `Ctrl+5` switch between the pages. The letters are
   * avoided on purpose: several of them (`Ctrl+L`, `Ctrl+P`) are claimed by
   * the web view itself and never reach the page.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return;
      const index = Number(event.key) - 1;
      const pages: Page[] = ["home", "library", "practice", "notebook", "stats"];
      if (Number.isInteger(index) && index >= 0 && index < pages.length) {
        event.preventDefault();
        setPage(pages[index]);
        return;
      }
      if (event.key === ",") {
        event.preventDefault();
        setPage("settings");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /** Show a short message at the bottom of the window. */
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const heading = TITLES[page];

  const content = useMemo(() => {
    switch (page) {
      case "home":
        return <HomePage stats={stats} books={books} onStart={() => setPage("practice")} onRefresh={refresh} />;
      case "library":
        return <LibraryPage books={books} onStart={() => setPage("practice")} />;
      case "practice":
        return <PracticePage books={books} onExit={() => setPage("home")} onChange={refresh} notify={notify} />;
      case "notebook":
        return <NotebookPage onStart={() => setPage("practice")} onRefresh={refresh} />;
      case "stats":
        return <StatsPage stats={stats} books={books} />;
      case "settings":
        return <SettingsPage onReset={refresh} notify={notify} />;
      default:
        return null;
    }
  }, [page, stats, books, refresh, notify]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__mark">词</div>
          <div>
            <div className="sidebar__title">LexiFlow</div>
            <div className="sidebar__subtitle">Vocabulary</div>
          </div>
        </div>

        <nav className="sidebar__nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${page === item.id ? "nav-item--active" : ""}`}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-item__icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar__footer">
          <button
            type="button"
            className={`nav-item ${page === "settings" ? "nav-item--active" : ""}`}
            onClick={() => setPage("settings")}
          >
            <span className="nav-item__icon" aria-hidden="true">
              ⚙
            </span>
            偏好设置
          </button>
        </div>
      </aside>

      <main className="main">
        <TitleBar title="LexiFlow · 词汇流" />
        <header className="topbar">
          <div>
            <div className="topbar__eyebrow">{heading.eyebrow}</div>
            <h1 className="topbar__title">{heading.title}</h1>
          </div>
          <div className="topbar__spacer" />
          {stats.dueCount > 0 && page !== "practice" && (
            <button type="button" className="chip chip--warning" onClick={() => setPage("practice")}>
              待复习 {stats.dueCount}
            </button>
          )}
        </header>

        <div className={`content ${page === "practice" ? "content--flush" : ""}`} key={page}>
          {content}
        </div>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
