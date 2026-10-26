import { useEffect, useMemo, useState } from "react";

import type { BookWithStats } from "../lib/api";
import { fetchSetting, saveSetting } from "../lib/api";
import type { StudyMode, StudyScope } from "../lib/types";

/** The bounds a custom session size must fall within. */
const MIN_SIZE = 1;

/**
 * A ceiling for the custom count when no book is picked yet.
 *
 * The real limit is the size of the chosen wordbook, so this only applies
 * before the dialog has a book, which never happens in practice.
 */
const FALLBACK_MAX_SIZE = 100_000;

/** The three practice modes. */
const MODES: Array<{ id: StudyMode; label: string; hint: string }> = [
  { id: "spelling", label: "拼写", hint: "看释义写英文" },
  { id: "choice", label: "选择", hint: "选出正确释义" },
  { id: "dictation", label: "听写", hint: "听发音写单词" },
];

/** The three ways a session can be drawn. */
const SCOPES: Array<{ id: StudyScope; label: string }> = [
  { id: "mix", label: "新词 + 复习" },
  { id: "new", label: "只学新词" },
  { id: "review", label: "只复习" },
];

/**
 * The quick-pick sizes shown in the dialog.
 *
 * The learner's daily goal is always offered first, because a session is
 * normally one day's work; the others are convenient round numbers around
 * it. Values are deduplicated and kept in ascending order.
 */
function sizeOptions(goal: number): number[] {
  const around = [goal, goal * 2, goal * 3];
  return [...new Set(around.map((size) => Math.round(size)))].sort((a, b) => a - b);
}

/** What the learner settled on. */
export interface StartChoice {
  bookId: string;
  mode: StudyMode;
  scope: StudyScope;
  limit: number;
}

interface StartDialogProps {
  books: BookWithStats[];
  /** The learner's daily goal, offered as the first quick-pick size. */
  dailyGoal?: number;
  /** The mode pre-selected when the dialog opens. */
  defaultMode: StudyMode;
  /** The scope pre-selected when the dialog opens. */
  defaultScope: StudyScope;
  onCancel: () => void;
  onStart: (choice: StartChoice) => void;
}

/**
 * The dialog shown before a session starts.
 *
 * Starting a session needs four decisions, and guessing any of them wastes
 * the learner's time: which book, how many words, which mode and whether to
 * include reviews. The dialog asks for all four in one place and remembers
 * the last choice, so the second session is a single click.
 */
export default function StartDialog({
  books,
  dailyGoal = 20,
  defaultMode,
  defaultScope,
  onCancel,
  onStart,
}: StartDialogProps) {
  const [bookId, setBookId] = useState("");
  const [mode, setMode] = useState<StudyMode>(defaultMode);
  const [scope, setScope] = useState<StudyScope>(defaultScope);
  const [limit, setLimit] = useState(dailyGoal);
  const [custom, setCustom] = useState(false);
  const [customValue, setCustomValue] = useState(String(dailyGoal));
  const [ready, setReady] = useState(false);

  const quickSizes = sizeOptions(dailyGoal);

  // Load the previous choice, so the dialog opens where it was left.
  useEffect(() => {
    void Promise.all([
      fetchSetting("lastBookId"),
      fetchSetting("lastMode"),
      fetchSetting("lastScope"),
      fetchSetting("lastLimit"),
    ]).then(([savedBook, savedMode, savedScope, savedLimit]) => {
      if (savedBook && books.some((book) => book.id === savedBook)) {
        setBookId(savedBook);
      }
      if (savedMode === "spelling" || savedMode === "choice" || savedMode === "dictation") {
        setMode(savedMode);
      }
      if (savedScope === "mix" || savedScope === "new" || savedScope === "review") {
        setScope(savedScope);
      }
      const parsed = Number(savedLimit);
      // A count saved for a different book may exceed this one's size, so it
      // is only restored when it still fits.
      const book = books.find((item) => item.id === savedBook);
      const ceiling = book ? book.total : FALLBACK_MAX_SIZE;
      if (Number.isInteger(parsed) && parsed >= MIN_SIZE && parsed <= ceiling) {
        setLimit(parsed);
        setCustomValue(String(parsed));
      }
      setReady(true);
    });
  }, [books]);

  // Escape closes the dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  /** Books that still have words left to learn, so the list is not noise. */
  const choices = useMemo(() => {
    return books.map((book) => {
      const remaining = Math.max(0, book.total - book.started);
      return { book, remaining };
    });
  }, [books]);

  const selected = books.find((book) => book.id === bookId) ?? null;

  /**
   * The largest count the current choices allow.
   *
   * A book cannot yield more words than it holds, so its size is the ceiling.
   * A review is sized by FSRS rather than by the learner, so the ceiling lifts
   * while that scope is selected.
   */
  const maxSize = useMemo(() => {
    if (!selected) return FALLBACK_MAX_SIZE;
    if (scope === "review") return Math.max(FALLBACK_MAX_SIZE, selected.total);
    return Math.max(MIN_SIZE, selected.total);
  }, [selected, scope]);

  /** How many words the chosen settings can actually produce. */
  const available = useMemo(() => {
    if (!selected) return 0;
    if (scope === "review") return 0;
    return Math.max(0, selected.total - selected.started);
  }, [selected, scope]);

  const confirm = () => {
    // Remember the choice, so the next session opens with the same settings.
    void saveSetting("lastBookId", bookId);
    void saveSetting("lastMode", mode);
    void saveSetting("lastScope", scope);
    void saveSetting("lastLimit", String(limit));
    onStart({ bookId, mode, scope, limit });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal start-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="开始学习"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="start-dialog__head">
          <div>
            <h2 className="start-dialog__title">开始学习</h2>
            <p className="start-dialog__subtitle">选好词书和数量，再进入练习。</p>
          </div>
          <button type="button" className="start-dialog__close" onClick={onCancel} aria-label="关闭">
            ✕
          </button>
        </header>

        <div className="start-dialog__body">
          <section className="start-dialog__section">
            <h3 className="start-dialog__label">词书</h3>
            <div className="book-picker">
              {choices.map(({ book, remaining }) => (
                <button
                  key={book.id}
                  type="button"
                  className={`book-picker__item ${bookId === book.id ? "book-picker__item--active" : ""}`}
                  data-total={book.total}
                  onClick={() => {
                    // Switching to a smaller book must not leave a count that
                    // the new book cannot supply, and the field has to show
                    // the lowered number too.
                    setBookId(book.id);
                    const ceiling = Math.max(MIN_SIZE, book.total);
                    setLimit((current) => {
                      if (current <= ceiling) return current;
                      setCustomValue(String(ceiling));
                      return ceiling;
                    });
                  }}
                >
                  <span className="book-picker__name">{book.name}</span>
                  <span className="book-picker__meta">
                    {book.total.toLocaleString()} 词
                    {remaining > 0 ? ` · 未学 ${remaining}` : " · 已学完"}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <div className="start-dialog__row">
            <section className="start-dialog__section">
              <h3 className="start-dialog__label">模式</h3>
              <div className="segmented">
                {MODES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`segmented__item ${mode === item.id ? "segmented__item--active" : ""}`}
                    onClick={() => setMode(item.id)}
                    title={item.hint}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="start-dialog__section">
              <h3 className="start-dialog__label">范围</h3>
              <div className="segmented">
                {SCOPES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`segmented__item ${scope === item.id ? "segmented__item--active" : ""}`}
                    onClick={() => setScope(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <section className="start-dialog__section">
            <h3 className="start-dialog__label">本次数量</h3>
            <div className="size-picker">
              {quickSizes.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`size-picker__item ${!custom && limit === size ? "size-picker__item--active" : ""}`}
                  onClick={() => {
                    setCustom(false);
                    setLimit(size);
                  }}
                >
                  {size}
                  <span className="size-picker__unit">词</span>
                </button>
              ))}

              {/*
                The custom tile holds its own field. Revealing the field in
                place keeps the row one line tall; a separate row below it
                pushed the rest of the dialog down every time it opened.
              */}
              <div
                className={`size-picker__item size-picker__item--entry ${
                  custom ? "size-picker__item--active" : ""
                }`}
                onClick={() => {
                  setCustom(true);
                  setCustomValue(String(limit));
                }}
                role="presentation"
              >
                {custom ? (
                  <>
                    <input
                      className="size-entry__input"
                      type="number"
                      min={MIN_SIZE}
                      max={maxSize}
                      value={customValue}
                      autoFocus
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        setCustomValue(event.target.value);
                        const parsed = Number(event.target.value);
                        if (Number.isInteger(parsed) && parsed >= MIN_SIZE && parsed <= maxSize) {
                          setLimit(parsed);
                        }
                      }}
                      onBlur={() => {
                        // Keep the field and the chosen size in step.
                        const parsed = Number(customValue);
                        if (!Number.isInteger(parsed) || parsed < MIN_SIZE || parsed > maxSize) {
                          setCustomValue(String(limit));
                        } else {
                          setLimit(parsed);
                        }
                      }}
                      aria-label="自定义数量"
                    />
                    <span className="size-picker__unit">词</span>
                    {custom && selected && scope !== "review" && (
                      <span className="size-picker__hint">最多 {maxSize.toLocaleString()}</span>
                    )}
                  </>
                ) : (
                  "自定义"
                )}
              </div>
            </div>
          </section>

          <p className="start-dialog__summary">
            {selected ? (
              scope === "review" ? (
                <>
                  「{selected.name}」中到期的复习词最多 {limit} 个
                </>
              ) : (
                <>
                  「{selected.name}」还有 {available.toLocaleString()} 个新词，本次取 {Math.min(limit, available)} 个
                </>
              )
            ) : (
              "请选择一本词书"
            )}
          </p>
        </div>

        <footer className="start-dialog__foot">
          <button type="button" className="button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={confirm}
            disabled={!ready || !bookId}
          >
            开始学习
          </button>
        </footer>
      </div>
    </div>
  );
}
