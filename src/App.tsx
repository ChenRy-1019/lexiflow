import { useCallback, useEffect, useMemo, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { fetchBooks, fetchStats, isTauri, loadSession, type BookWithStats } from "./lib/api";
import { autoCheckEnabled, checkForUpdate, type UpdateStatus } from "./lib/updater";
import { DEFAULT_DAILY_GOAL, goalProgress, loadDailyGoal } from "./lib/goal";
import type { DashboardStats, StudyMode, StudyScope } from "./lib/types";
import TitleBar from "./components/TitleBar";
import StartDialog, { type StartChoice } from "./components/StartDialog";
import HomePage from "./pages/HomePage";
import LibraryPage from "./pages/LibraryPage";
import NotebookPage from "./pages/NotebookPage";
import PracticePage from "./pages/PracticePage";
import UpdateDialog from "./components/UpdateDialog";
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
  const [immersive, setImmersive] = useState(false);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [books, setBooks] = useState<BookWithStats[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  /** The learner's daily goal, shown by the home page and the ring. */
  const [dailyGoal, setDailyGoal] = useState(DEFAULT_DAILY_GOAL);
  /** The mode and scope chosen on the home page, handed to the practice page. */
  const [startOptions, setStartOptions] = useState<{
    bookId: string;
    mode: StudyMode;
    scope: StudyScope;
    limit: number;
  }>({ bookId: "", mode: "spelling", scope: "mix", limit: 20 });
  /** Whether the start dialog is open. */
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  /** How many words remain in the unfinished session, if there is one. */
  const [pendingRemaining, setPendingRemaining] = useState(0);
  /** Whether the practice page should resume the saved session. */
  const [resumeSession, setResumeSession] = useState(false);
  /** The update check result, shown in a dialog when present. */
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<Awaited<ReturnType<typeof checkForUpdate>>["update"]>(null);

  /** Refresh the counters shown in the sidebar and on the home page. */
  const refresh = useCallback(async () => {
    const [nextStats, nextBooks, saved, goal] = await Promise.all([
      fetchStats(),
      fetchBooks(),
      loadSession(),
      loadDailyGoal(),
    ]);
    setStats(nextStats);
    setBooks(nextBooks);
    setPendingRemaining(saved ? Math.max(0, saved.ids.length - saved.answered) : 0);
    setDailyGoal(goal);
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
   *
   * `Esc` exits immersive mode when in practice.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && immersive) {
        event.preventDefault();
        setImmersive(false);
        setPage("home");
        return;
      }
      if (!event.ctrlKey) return;
      const index = Number(event.key) - 1;
      const pages: Page[] = ["home", "library", "practice", "notebook", "stats"];
      if (Number.isInteger(index) && index >= 0 && index < pages.length) {
        event.preventDefault();
        setImmersive(false);
        setPage(pages[index]);
        return;
      }
      if (event.key === ",") {
        event.preventDefault();
        setImmersive(false);
        setPage("settings");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [immersive]);

  /**
   * Check for an update.
   *
   * Called on startup when the setting is on, and from the settings page when
   * the learner asks. `showResult` is false for the startup check so a current
   * version does not interrupt the learner with a dialog.
   */
  const runUpdateCheck = useCallback(async (showResult: boolean) => {
    if (!isTauri()) {
      if (showResult) {
        setUpdateStatus({ kind: "failed", reason: "此功能需要在桌面应用中运行" });
      }
      return;
    }

    const { status, update } = await checkForUpdate();
    setPendingUpdate(update);

    // A startup check only speaks up when there is something to install.
    if (showResult || status.kind === "available") {
      setUpdateStatus(status);
    }
  }, []);

  useEffect(() => {
    void autoCheckEnabled().then((enabled) => {
      if (enabled) {
        void runUpdateCheck(false);
      }
    });
  }, [runUpdateCheck]);

  /** Show a short message at the bottom of the window. */
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const heading = TITLES[page];

  /**
   * Open the start dialog.
   *
   * Choosing a book and a word count is a per-session decision, so the
   * dialog always comes first; `preferredBook` lets the library start with a
   * particular book already selected.
   */
  const openStartDialog = useCallback((preferredBook?: string) => {
    if (preferredBook) {
      setStartOptions((prev) => ({ ...prev, bookId: preferredBook }));
    }
    setStartDialogOpen(true);
  }, []);

  const exitImmersive = useCallback(() => {
    setImmersive(false);
    setPage("home");
  }, []);

  /** Enter practice with the choice the dialog returned. */
  const startSession = useCallback((choice: StartChoice) => {
    setStartOptions(choice);
    setResumeSession(false);
    setStartDialogOpen(false);
    setImmersive(true);
    setPage("practice");
  }, []);

  const content = useMemo(() => {
    switch (page) {
      case "home":
        return (
          <HomePage
            stats={stats}
            books={books}
            onStart={(mode, scope) => {
              setStartOptions((prev) => ({ ...prev, mode, scope }));
              setResumeSession(false);
              setStartDialogOpen(true);
            }}
            onContinue={() => {
              setResumeSession(true);
              setImmersive(true);
              setPage("practice");
            }}
            pendingRemaining={pendingRemaining}
            dailyGoal={dailyGoal}
/>
        );
      case "library":
        return <LibraryPage books={books} onStart={(bookId) => openStartDialog(bookId ?? undefined)} />;
      case "practice":
        return (
          <PracticePage
            books={books}
            initialBookId={startOptions.bookId}
            initialMode={startOptions.mode}
            initialScope={startOptions.scope}
            initialLimit={startOptions.limit}
            resume={resumeSession}
            onExit={exitImmersive}
            onChange={refresh}
            notify={notify}
          />
        );
      case "notebook":
        return <NotebookPage onStart={() => openStartDialog()} onRefresh={refresh} />;
      case "stats":
        return <StatsPage stats={stats} books={books} />;
      case "settings":
        return (
          <SettingsPage
            onReset={refresh}
            notify={notify}
            onCheckUpdate={() => void runUpdateCheck(true)}
            onGoalChange={(goal) => {
              setDailyGoal(goal);
            }}
          />
        );
      default:
        return null;
    }
  }, [page, stats, books, refresh, notify, openStartDialog, startOptions, exitImmersive, dailyGoal]);

  return (
    <div className={`app ${immersive ? "app--immersive" : ""}`}>
      {!immersive && (
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
                onClick={() => {
                  if (item.id === "practice") {
                    openStartDialog();
                  } else {
                    setPage(item.id);
                  }
                }}
              >
                <span className="nav-item__icon" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
          </nav>

          {/* Today's note card */}
          <div className="sidebar__note">
            <div className="sidebar__note-label">Today&apos;s Note</div>
            <div className="sidebar__note-en">The unexamined life is not worth living.</div>
            <div className="sidebar__note-zh">未经省察的人生，不值得过。</div>
          </div>

          {/* Circular progress ring */}
          <div className="sidebar__progress">
            <svg className="progress-ring" viewBox="0 0 48 48">
              <circle className="progress-ring__track" cx="24" cy="24" r="20" />
              <circle
                className="progress-ring__fill"
                cx="24"
                cy="24"
                r="20"
                strokeDasharray={`${2 * Math.PI * 20}`}
                strokeDashoffset={`${2 * Math.PI * 20 - goalProgress(stats.todayNew, dailyGoal) * 2 * Math.PI * 20}`}
              />
              <text className="progress-ring__text" x="24" y="24">
                {stats.todayNew}
              </text>
            </svg>
            <div className="progress-info">
              <div className="progress-info__label">今日新词</div>
              <div className="progress-info__sub">
                {stats.todayNew} / {dailyGoal} 词
              </div>
              <div className="progress-info__foot">A LITTLE EVERY DAY</div>
            </div>
          </div>

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
      )}

      <main className="main">
        {!immersive && <TitleBar title="LexiFlow · 词汇流" />}
        {immersive && (
          <div className="titlebar titlebar--minimal" data-tauri-drag-region>
            <div className="titlebar__spacer" data-tauri-drag-region />
            <div className="titlebar__buttons">
              <button type="button" className="titlebar__button" onClick={() => {
                if (!isTauri()) return;
                void getCurrentWindow().minimize();
              }} aria-label="最小化">
                ─
              </button>
              <button type="button" className="titlebar__button" onClick={() => {
                if (!isTauri()) return;
                void getCurrentWindow().toggleMaximize();
              }} aria-label="最大化">
                ☐
              </button>
              <button type="button" className="titlebar__button titlebar__button--close" onClick={() => {
                if (!isTauri()) return;
                void getCurrentWindow().close();
              }} aria-label="关闭">
                ✕
              </button>
            </div>
          </div>
        )}
        {!immersive && (
          <header className="topbar">
            <div>
              <div className="topbar__eyebrow">{heading.eyebrow}</div>
              <h1 className="topbar__title">{heading.title}</h1>
            </div>
            <div className="topbar__spacer" />
            {stats.dueCount > 0 && page !== "practice" && (
              <button type="button" className="chip chip--warning" onClick={() => openStartDialog()}>
                待复习 {stats.dueCount}
              </button>
            )}
          </header>
        )}

        <div className={`content ${immersive ? "content--immersive" : ""}`} key={page}>
          {content}
        </div>
      </main>

      {startDialogOpen && (
        <StartDialog
          books={books}
          defaultMode={startOptions.mode}
          defaultScope={startOptions.scope}
          onCancel={() => setStartDialogOpen(false)}
          onStart={startSession}
        />
      )}

      {updateStatus && (
        <UpdateDialog
          status={updateStatus}
          update={pendingUpdate}
          onClose={() => setUpdateStatus(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
