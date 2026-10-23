import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addToNotebook,
  buildChoices,
  buildSession,
  fetchCards,
  recordReview,
  removeFromNotebook,
  type BookWithStats,
  type Choice,
} from "../lib/api";
import { formatInterval, previewIntervals, review as fsrsReview, retrievability } from "../lib/fsrs";
import type { FsrsCard, Rating, StudyMode, StudyScope } from "../lib/types";

/** Compare two answers the way a learner would expect. */
function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Compare a phrase ignoring spaces. */
function spellingKey(value: string): string {
  return normalise(value).replace(/\s+/g, "");
}

/**
 * Mark each typed letter as right or wrong.
 *
 * A letter is wrong when it is not part of the best alignment between the
 * typed text and the expected answer, which is what makes "pear" vs "bear"
 * show a single wrong letter rather than a wholesale mismatch.
 */
function markLetters(typed: string, expected: string): boolean[] {
  const typedLetters = [...typed].filter((char) => /[a-z]/i.test(char));
  const expectedLetters = [...expected].filter((char) => /[a-z]/i.test(char));
  const marks = typedLetters.map(() => true);

  if (typedLetters.length === 0 || expectedLetters.length === 0) return marks;

  // Longest common subsequence alignment.
  const rows = typedLetters.length + 1;
  const cols = expectedLetters.length + 1;
  const table = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const same = typedLetters[i - 1].toLowerCase() === expectedLetters[j - 1].toLowerCase();
      table[i][j] = same
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }

  let i = typedLetters.length;
  let j = expectedLetters.length;
  while (i > 0 && j > 0) {
    const same = typedLetters[i - 1].toLowerCase() === expectedLetters[j - 1].toLowerCase();
    if (same) {
      i -= 1;
      j -= 1;
    } else if (table[i - 1][j] >= table[i][j - 1]) {
      marks[i - 1] = false;
      i -= 1;
    } else {
      j -= 1;
    }
  }
  while (i > 0) {
    marks[i - 1] = false;
    i -= 1;
  }
  return marks;
}

interface QueueItem {
  entryId: string;
  word: string;
  meaning: string;
  pos: string;
  phonetic: string;
  example: string;
  exampleZh: string;
  phrase: boolean;
  etymology: string;
  isReview: boolean;
  priorCard: FsrsCard | null;
}

interface PracticePageProps {
  books: BookWithStats[];
  onExit: () => void;
  onChange: () => void;
  notify: (message: string) => void;
}

/** The practice page: one word at a time, graded with FSRS. */
export default function PracticePage({ books, onExit, onChange, notify }: PracticePageProps) {
  const [mode, setMode] = useState<StudyMode>("spelling");
  const [scope, setScope] = useState<StudyScope>("mix");
  const [bookId, setBookId] = useState<string>("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [choices, setChoices] = useState<Choice[]>([]);
  const [graded, setGraded] = useState<{
    correct: boolean;
    marks: boolean[];
    expected: string;
    revealed: boolean;
  } | null>(null);
  const [notebookIds, setNotebookIds] = useState<Set<string>>(new Set());
  const [startedAt, setStartedAt] = useState<number>(Date.now());
  const [loading, setLoading] = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Marks the key press that the answer field already handled.
   *
   * React flushes state updates for a key press synchronously, which
   * re-registers the window listener before the native event has finished
   * travelling. Without this marker the window listener sees the updated
   * state and rates the word that was only just graded.
   */
  const handledEnter = useRef(false);

  const current = queue[index] ?? null;
  const finished = queue.length > 0 && index >= queue.length;

  /** Load a fresh session from the backend. */
  const load = useCallback(
    async (nextBook: string, nextScope: StudyScope) => {
      setLoading(true);
      const items = await buildSession(nextBook, nextScope, 20);
      const cards = await fetchCards();

      const mapped: QueueItem[] = items.map((item) => {
        const stored = cards[item.entry.id];
        return {
          entryId: item.entry.id,
          word: item.entry.word,
          meaning: item.entry.meaning,
          pos: item.entry.pos,
          phonetic: item.entry.phonetic,
          example: item.entry.example,
          exampleZh: item.entry.exampleZh,
          phrase: item.entry.phrase,
          etymology: item.entry.etymology,
          isReview: item.isReview,
          priorCard: stored?.card ? (JSON.parse(stored.card) as FsrsCard) : null,
        };
      });

      setQueue(mapped);
      setIndex(0);
      setTyped("");
      setGraded(null);
      setStartedAt(Date.now());
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    void load(bookId, scope);
  }, [load, bookId, scope]);

  // Focus the answer field whenever a new question appears.
  useEffect(() => {
    if (current && mode === "spelling") {
      inputRef.current?.focus();
    }
  }, [current, mode]);

  // Load the multiple-choice options for the current word.
  useEffect(() => {
    if (!current || mode !== "choice") {
      setChoices([]);
      return;
    }
    void buildChoices(current.entryId, bookId).then(setChoices);
  }, [current, mode, bookId]);

  /** The FSRS intervals the learner would get for each button. */
  const intervals = useMemo<Record<Rating, number>>(() => {
    if (!current) return { 1: 0, 2: 0, 3: 0, 4: 0 };
    return previewIntervals(current.priorCard);
  }, [current]);

  /** The learner's estimated recall of the current word. */
  const strength = useMemo(() => {
    if (!current?.priorCard) return null;
    return retrievability(current.priorCard);
  }, [current]);

  /** Grade the typed answer against the expected word. */
  const submitTyped = useCallback(() => {
    if (!current || graded) return;
    const correct = spellingKey(typed) === spellingKey(current.word);
    setGraded({
      correct,
      marks: correct ? [] : markLetters(typed, current.word),
      expected: current.word,
      revealed: false,
    });
  }, [current, typed, graded]);

  /** Reveal the answer without grading it as correct. */
  const reveal = useCallback(() => {
    if (!current || graded) return;
    setGraded({
      correct: false,
      marks: [],
      expected: current.word,
      revealed: true,
    });
  }, [current, graded]);

  /** Pick one of the multiple-choice options. */
  const pickChoice = useCallback(
    (choice: Choice) => {
      if (!current || graded) return;
      setGraded({
        correct: choice.correct,
        marks: [],
        expected: current.word,
        revealed: false,
      });
    },
    [current, graded],
  );

  /**
   * Record the review and move on.
   *
   * The FSRS schedule is computed here, in the frontend, and then handed to
   * the backend, which stores it. That keeps the algorithm in one place and
   * makes it testable without a database.
   */
  const commit = useCallback(
    async (rating: Rating) => {
      if (!current || !graded) return;

      const outcome = fsrsReview(current.priorCard, rating);
      const cardJson = JSON.stringify(outcome.card);

      await recordReview({
        entryId: current.entryId,
        rating,
        mode,
        durationMs: Date.now() - startedAt,
        cardJson,
        due: outcome.card.due,
        state: 2,
        correct: graded.correct && rating >= 3,
      });

      onChange();
      setIndex((value) => value + 1);
      setTyped("");
      setGraded(null);
      setStartedAt(Date.now());
    },
    [current, graded, mode, startedAt, onChange],
  );

  /** Move to the next word without grading the current one. */
  const skip = useCallback(() => {
    setIndex((value) => value + 1);
    setTyped("");
    setGraded(null);
    setStartedAt(Date.now());
  }, []);

  /** Toggle the current word in the notebook. */
  const toggleNotebook = useCallback(
    async (entryId: string) => {
      const saved = notebookIds.has(entryId);
      if (saved) {
        await removeFromNotebook(entryId);
        setNotebookIds((prev) => {
          const next = new Set(prev);
          next.delete(entryId);
          return next;
        });
        notify("已从生词本移除");
      } else {
        await addToNotebook(entryId);
        setNotebookIds((prev) => new Set(prev).add(entryId));
        notify("已加入生词本");
      }
    },
    [notebookIds, notify],
  );

  /**
   * Keyboard shortcuts.
   *
   * Enter is handled in exactly one place at a time. The answer field marks
   * the press it has handled, and this listener skips that press; see
   * `handledEnter` for why the marker is necessary.
   *
   * In the multiple-choice mode there is no field, so the number keys pick
   * an option and Enter confirms it.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onExit();
        return;
      }
      if (event.key === "Enter" && event.ctrlKey) {
        event.preventDefault();
        skip();
        return;
      }

      if (event.key === "Enter") {
        if (handledEnter.current) {
          handledEnter.current = false;
          return;
        }
        if (graded) {
          void commit(graded.correct ? 3 : 1);
          return;
        }
        if (mode === "choice" && choices.length > 0) {
          // Enter confirms the first option that is still available.
          const first = choices.find((choice) => !choice.correct);
          if (first) pickChoice(first);
        }
        return;
      }

      // The number keys pick an option in the multiple-choice mode.
      if (mode === "choice" && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        const index = Number(event.key) - 1;
        const choice = choices[index];
        if (choice && !graded) pickChoice(choice);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [graded, commit, skip, mode, choices, pickChoice, onExit]);

  /**
   * The answer field handles Enter itself.
   *
   * A window-level listener is not enough: the web view delivers the key to
   * the focused input first, and some layouts swallow it before it bubbles
   * up to the document.
   *
   * The press is marked so that the window listener above ignores it. React
   * flushes the state update for a key press synchronously, so by the time
   * the event bubbles up the window listener would already see the graded
   * state and rate the word that was only just graded.
   */
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handledEnter.current = true;
    if (graded) {
      void commit(graded.correct ? 3 : 1);
    } else {
      submitTyped();
    }
  };

  if (loading) {
    return (
      <div className="empty">
        <div className="empty__title">正在准备今天的单词…</div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="empty">
        <div className="empty__title">这一轮完成了</div>
        <p style={{ margin: 0 }}>休息一下，或者再来一轮。</p>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button type="button" className="button button--primary" onClick={() => void load(bookId, scope)}>
            再来一轮
          </button>
          <button type="button" className="button" onClick={onExit}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="empty">
        <div className="empty__title">没有待学的单词</div>
        <p style={{ margin: 0 }}>换一个词书或范围试试。</p>
      </div>
    );
  }

  const typedLetters = [...typed].filter((char) => /[a-z]/i.test(char));

  return (
    <div className="practice">
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        <select
          className="input"
          style={{ width: "auto" }}
          value={bookId}
          onChange={(event) => setBookId(event.target.value)}
          aria-label="词书"
        >
          <option value="">全部词书</option>
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          style={{ width: "auto" }}
          value={scope}
          onChange={(event) => setScope(event.target.value as StudyScope)}
          aria-label="范围"
        >
          <option value="mix">新词 + 复习</option>
          <option value="new">只学新词</option>
          <option value="review">只复习</option>
        </select>
        <select
          className="input"
          style={{ width: "auto" }}
          value={mode}
          onChange={(event) => setMode(event.target.value as StudyMode)}
          aria-label="模式"
        >
          <option value="spelling">拼写</option>
          <option value="choice">词义选择</option>
          <option value="dictation">听写</option>
        </select>
        <span className="chip chip--outline">
          {index + 1} / {queue.length}
        </span>
        {current.isReview && <span className="chip">复习</span>}
        {strength !== null && (
          <span className="chip chip--outline">记忆强度 {Math.round(strength * 100)}%</span>
        )}
      </div>

      {mode === "choice" ? (
        <div className="practice__stage">
          <p className="practice__pos word">{current.word}</p>
          <p className="practice__pos">选出正确的释义</p>
          <div className="choices">
            {choices.map((choice) => {
              const state = graded
                ? choice.correct
                  ? "choice--correct"
                  : choice.entryId === current.entryId
                    ? "choice--wrong"
                    : ""
                : "";
              return (
                <button
                  key={choice.entryId}
                  type="button"
                  className={`choice ${state}`}
                  disabled={Boolean(graded)}
                  onClick={() => pickChoice(choice)}
                >
                  {choice.text}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="practice__stage">
          <div className="practice__pos">{current.meaning}</div>
          <p className="practice__prompt gloss">{current.meaning}</p>
          <p className="practice__pos">
            {current.phrase ? "词组" : current.pos} · {current.phonetic ? `/${current.phonetic}/` : `${current.word.length} 个字母`}
          </p>

          <div className="practice__slots">
            {Array.from({ length: Math.max(current.word.replace(/[^a-z]/gi, "").length, typedLetters.length) }).map(
              (_, slotIndex) => {
                const char = typedLetters[slotIndex] ?? "";
                const isWrong = graded && !graded.correct && graded.marks[slotIndex] === false;
                const isRight = graded && !graded.correct && graded.marks[slotIndex] === true;
                const classes = ["slot"];
                if (isWrong) classes.push("slot--wrong");
                else if (isRight) classes.push("slot--right");
                else if (slotIndex === typedLetters.length && !graded) classes.push("slot--active");
                return (
                  <span key={slotIndex} className={classes.join(" ")}>
                    {char}
                  </span>
                );
              },
            )}
          </div>

          <input
            ref={inputRef}
            className="input"
            style={{ textAlign: "center", fontFamily: "var(--font-en)", fontSize: 18 }}
            value={typed}
            disabled={Boolean(graded)}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="在这里输入英文"
            autoComplete="off"
            spellCheck={false}
            aria-label="答案"
          />
        </div>
      )}

      {!graded ? (
        <div className="practice__actions">
          <button type="button" className="button" onClick={reveal}>
            显示答案
          </button>
          <button type="button" className="button" onClick={skip}>
            跳过
          </button>
          {mode !== "choice" && (
            <button type="button" className="button button--primary" onClick={submitTyped}>
              判定
            </button>
          )}
        </div>
      ) : (
        <div style={{ width: "100%", maxWidth: 620, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="practice__feedback">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span className={`chip ${graded.correct ? "chip--success" : "chip--warning"}`}>
                {graded.correct ? "答对了" : graded.revealed ? "已显示答案" : "拼写有误"}
              </span>
              <span className="practice__answer word">{graded.expected}</span>
            </div>
            {current.meaning && (
              <p className="gloss" style={{ color: "var(--ink-muted)", margin: "0 0 6px" }}>
                {current.meaning}
              </p>
            )}
            {current.etymology && (
              <p className="gloss" style={{ fontSize: 12, color: "var(--ink-faint)", margin: "0 0 6px" }}>
                {current.etymology}
              </p>
            )}
            {current.example && (
              <p className="word" style={{ fontSize: 13, color: "var(--ink-muted)", margin: 0 }}>
                {current.example}
                {current.exampleZh && (
                  <span className="gloss" style={{ display: "block", fontSize: 12, color: "var(--ink-faint)" }}>
                    {current.exampleZh}
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="ratings">
            {([1, 2, 3, 4] as Rating[]).map((rating) => (
              <button key={rating} type="button" className="rating" onClick={() => void commit(rating)}>
                <span className="rating__label">
                  {rating === 1 ? "忘记" : rating === 2 ? "困难" : rating === 3 ? "记得" : "简单"}
                </span>
                <span className="rating__interval">{formatInterval(intervals[rating])}</span>
              </button>
            ))}
          </div>

          <div className="practice__actions">
            <button
              type="button"
              className="button button--small"
              onClick={() => void toggleNotebook(current.entryId)}
            >
              {notebookIds.has(current.entryId) ? "移出生词本" : "加入生词本"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
