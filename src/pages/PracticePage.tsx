import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addToNotebook,
  buildChoices,
  buildSession,
  fetchCards,
  fetchSetting,
  recordReview,
  removeFromNotebook,
  saveSetting,
  recordStudyTime,
  resolveEntries,
  saveSession,
  loadSession,
  clearSession,
  type PendingSession,
  type StoredCard,
  type BookWithStats,
  type Choice,
} from "../lib/api";
import { formatInterval, previewIntervals, review as fsrsReview } from "../lib/fsrs";
import { memoryStanding } from "../lib/memory";
import { prefetch, speak, stopSpeaking, whenVoicesReady, type Accent } from "../lib/speech";
import { playSound, preloadSounds, setSoundEnabled } from "../lib/sounds";
import type { FsrsCard, Rating, StudyMode, StudyScope } from "../lib/types";

/** Compare two answers the way a learner would expect. */
function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The spellings a gloss accepts besides the headword.
 *
 * A cleaned headword records its variants as `（亦作 honor）`, and a learner
 * typing one of those has answered correctly. Anything before the marker is
 * ignored, so an ordinary gloss yields no alternatives.
 */
function acceptedSpellings(word: string, meaning: string): string[] {
  const spellings = [word];
  const match = /（?亦作\s*([^）]+)）?/.exec(meaning);
  if (!match) return spellings;

  for (const part of match[1].split(/[、,，/]/)) {
    const candidate = part.trim();
    // A variant is a single token; anything longer is a translated note.
    if (candidate && /^[A-Za-z][A-Za-z\s'’-]*$/.test(candidate)) {
      spellings.push(candidate);
    }
  }
  return spellings;
}

/**
 * Compare an answer the way a dictionary headword should be typed.
 *
 * Punctuation and parenthetical spelling variants are ignored, so a headword
 * written `hono(u)r` still accepts `honour`, and `up-to-date` accepts
 * `up to date`. Imported wordbooks often carry such markers, and requiring the
 * learner to reproduce them exactly made those words impossible to answer.
 */
function answerKey(value: string): string {
  return normalise(value).replace(/[^a-z0-9]/g, "");
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
  /** How many times the word has been reviewed, from the stored card. */
  reviews: number;
  /** How many times it has been forgotten. */
  lapses: number;
}

interface PracticePageProps {
  books: BookWithStats[];
  /** The book chosen in the start dialog. Empty means every book. */
  initialBookId?: string;
  /** The mode chosen on the home page. */
  initialMode?: StudyMode;
  /** The scope chosen on the home page. */
  initialScope?: StudyScope;
  /** How many words this session should contain. */
  initialLimit?: number;
  /** Resume the saved session instead of building a new one. */
  resume?: boolean;
  onExit: () => void;
  onChange: () => void;
  notify: (message: string) => void;
}

/** The practice page: one word at a time, graded with FSRS. */
export default function PracticePage({
  books,
  initialBookId = "",
  initialMode = "spelling",
  initialScope = "mix",
  initialLimit = 20,
  resume = false,
  onExit,
  onChange,
  notify,
}: PracticePageProps) {
  const [mode, setMode] = useState<StudyMode>(initialMode);
  const [scope, setScope] = useState<StudyScope>(initialScope);
  const [bookId, setBookId] = useState<string>(initialBookId);
  const [sessionSize, setSessionSize] = useState(initialLimit);

  /**
   * The counts offered in the toolbar.
   *
   * A review takes its size from how many words are due, which is rarely a
   * round number. The current value is added to the list so the select shows
   * the real size rather than appearing empty.
   */
  const sizeChoices = useMemo(() => {
    const presets = [10, 20, 30, 50];
    if (presets.includes(sessionSize)) return presets;
    return [...presets, sessionSize].sort((a, b) => a - b);
  }, [sessionSize]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [choices, setChoices] = useState<Choice[]>([]);
  const [graded, setGraded] = useState<{
    correct: boolean;
    marks: boolean[];
    expected: string;
    revealed: boolean;
    /** The option the learner clicked, so a wrong pick can be marked. */
    picked?: string;
  } | null>(null);
  const [copySpelling, setCopySpelling] = useState(false);
  const [notebookIds, setNotebookIds] = useState<Set<string>>(new Set());
  const [startedAt, setStartedAt] = useState<number>(Date.now());
  const [loading, setLoading] = useState(true);
  const [accent, setAccent] = useState<Accent>("us");
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  /** Whether the keyboard shortcut reference is open. */
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** The current mode, readable from callbacks that must not depend on it. */
  const modeRef = useRef(mode);

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

  /** Turn backend entries into the queue the page renders. */
  const toQueue = useCallback(
    async (ids: string[], cards: Record<string, StoredCard>): Promise<QueueItem[]> => {
      const entries = await resolveEntries(ids);
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      return ids.flatMap((id) => {
        const entry = byId.get(id);
        if (!entry) return [];
        const stored = cards[id];
        return [
          {
            entryId: entry.id,
            word: entry.word,
            meaning: entry.meaning,
            pos: entry.pos,
            phonetic: entry.phonetic,
            example: entry.example,
            exampleZh: entry.exampleZh,
            phrase: entry.phrase,
            etymology: entry.etymology,
            isReview: Boolean(stored?.due),
            priorCard: stored?.card ? (JSON.parse(stored.card) as FsrsCard) : null,
            reviews: stored?.correctCount ?? 0,
            lapses: stored?.lapseCount ?? 0,
          },
        ];
      });
    },
    [],
  );

  /**
   * Load a fresh session from the backend.
   *
   * `mode` is read through a ref rather than the closure: switching mode must
   * not rebuild this callback, because that would re-run the session effect
   * and, when resuming, restore the saved mode over the learner's choice.
   */
  const load = useCallback(
    async (nextBook: string, nextScope: StudyScope, size: number) => {
      setLoading(true);
      const items = await buildSession(nextBook, nextScope, size);
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
          reviews: stored?.correctCount ?? 0,
          lapses: stored?.lapseCount ?? 0,
        };
      });

      setQueue(mapped);
      setIndex(0);
      setTyped("");
      setGraded(null);
      setStartedAt(Date.now());
      setLoading(false);

      // Remember this session so it can be resumed from the home page.
      void saveSession({
        ids: mapped.map((item) => item.entryId),
        answered: 0,
        bookId: nextBook,
        scope: nextScope,
        mode: modeRef.current,
        limit: size,
        updatedAt: Date.now(),
      });

      // Warm the audio cache for the first word so the audible request that
      // follows a moment later is served from memory. This makes no sound.
      if (mapped[0] && autoSpeak) {
        void prefetch(mapped[0].word, accent);
      }
    },
    // `mode` is intentionally absent; see the note above.
    [autoSpeak, accent],
  );

  /**
   * The session was restored from disk.
   *
   * `index` is the answered count, and the queue holds only the words that
   * are still to come, so the page opens on the word the learner left.
   */
  const restore = useCallback(
    async (session: PendingSession) => {
      setLoading(true);
      const cards = await fetchCards();
      const remaining = session.ids.slice(session.answered);
      const mapped = await toQueue(remaining, cards);

      setBookId(session.bookId);
      setScope(session.scope);
      setMode(session.mode);
      setSessionSize(session.limit);
      setQueue(mapped);
      setIndex(0);
      setTyped("");
      setGraded(null);
      setStartedAt(Date.now());
      setLoading(false);

      if (mapped[0] && autoSpeak) {
        void prefetch(mapped[0].word, accent);
      }
    },
    [toQueue, autoSpeak, accent],
  );

  /**
   * Speak the current word.
   *
   * Only the most recent request may clear the `speaking` flag, otherwise a
   * superseded request finishing late would clear it while the newer one is
   * still audible.
   */
  const speakToken = useRef(0);

  const pronounceCurrent = useCallback(
    async (text?: string) => {
      const word = text ?? current?.word;
      if (!word) return;

      const token = speakToken.current + 1;
      speakToken.current = token;

      // Stop any ongoing audio before starting a new one.
      stopSpeaking();
      setSpeaking(true);

      try {
        const outcome = await speak(word, accent);
        if (token !== speakToken.current) return;
        if (outcome === "failed") {
          notify("暂时无法发音，请检查网络或系统语音设置");
        }
      } finally {
        if (token === speakToken.current) {
          setSpeaking(false);
        }
      }
    },
    [current, accent, notify],
  );

  // The system voice list is only available after the web view has loaded it.
  useEffect(() => {
    void whenVoicesReady();
  }, []);

  // Read the saved accent and auto-speak preferences.
  useEffect(() => {
    void fetchSetting("voiceAccent").then((value) => {
      if (value === "us" || value === "uk") setAccent(value);
    });
    void fetchSetting("autoSpeak").then((value) => {
      if (value !== null) setAutoSpeak(value === "true");
    });
    void fetchSetting("typingSound").then((value) => {
      const on = value === null ? true : value === "true";
      setSoundEnabled(on);
      setSoundOn(on);
      if (on) preloadSounds();
    });
  }, []);

  // Speak the word once when it first appears, then only on manual trigger.
  useEffect(() => {
    if (!current || loading) return;
    
    // Stop any previous audio immediately
    stopSpeaking();
    setSpeaking(false);
    
    // Speak once after a short delay
    if (autoSpeak) {
      const timer = window.setTimeout(() => {
        void pronounceCurrent(current.word);
      }, 350);
      return () => window.clearTimeout(timer);
    }
  }, [current?.entryId, autoSpeak, loading]);

  // Stop the audio when the page is left.
  useEffect(() => {
    return () => stopSpeaking();
  }, []);

  /**
   * Forget the finished session.
   *
   * A round with nothing left to answer should not be offered as "continue"
   * on the home page. This has to sit above the early returns in the render
   * path: a hook after a conditional return breaks the rules of hooks, which
   * React rejects by unmounting the tree.
   */
  useEffect(() => {
    if (finished) {
      void clearSession();
    }
  }, [finished]);

  /**
   * Track the time spent practising.
   *
   * The clock starts when the page mounts and the elapsed time is written
   * when the page unmounts, so the counter reflects real practice time
   * rather than the number of words answered.
   */
  useEffect(() => {
    const enteredAt = Date.now();
    return () => {
      const seconds = Math.round((Date.now() - enteredAt) / 1000);
      // Ignore a page that was opened and closed straight away.
      if (seconds >= 3) {
        void recordStudyTime(seconds);
      }
    };
  }, []);

  /**
   * Open the page on the saved session when the learner asked to continue.
   *
   * Otherwise a fresh session is built from the chosen book and scope.
   */
  /** Guards the session effect so a restore runs exactly once per mount. */
  const startedRef = useRef(false);

  useEffect(() => {
    // The first pass establishes the session. Later passes are caused by the
    // restore itself setting bookId or scope; the guard keeps them from
    // restarting, which would discard the mode the learner chose.
    if (startedRef.current) return;

    // A session is resumed only when the learner pressed 继续学习. Starting
    // from the dialog always honours the book and count just chosen: reading
    // the saved session there meant a stale queue from another book replaced
    // the selection, and the practice page opened on the wrong words.
    if (!resume) {
      startedRef.current = true;
      // Leaving a stale session on disk would make the home page offer to
      // continue a round the learner has moved on from.
      void clearSession();
      void load(bookId, scope, sessionSize);
      return;
    }

    void loadSession().then((saved) => {
      if (startedRef.current) return;
      startedRef.current = true;
      // Only a session with words still to answer is worth resuming.
      if (saved && saved.ids.length > saved.answered) {
        void restore(saved);
      } else {
        void load(bookId, scope, sessionSize);
      }
    });
    // Runs once per mount; see the guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, bookId, scope]);

  // Keep the ref in step with the state, so `load` can record the mode without
  // depending on it.
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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

  /**
   * Where the current word stands in its memory schedule.
   *
   * This replaced a percentage that read 100% at every practice moment, since
   * the metric only measures decay since the last review.
   */
  const standing = useMemo(() => {
    if (!current) return null;
    return memoryStanding(current.priorCard, current.reviews, current.lapses);
  }, [current]);

  /** Grade the typed answer against the expected word. */
  const submitTyped = useCallback(() => {
    if (!current || graded) return;
    // The headword, plus any alternative the gloss lists.
    const key = answerKey(typed);
    const correct = acceptedSpellings(current.word, current.meaning).some(
      (spelling) => answerKey(spelling) === key,
    );
    setGraded({
      correct,
      marks: correct ? [] : markLetters(typed, current.word),
      expected: current.word,
      revealed: false,
    });

    if (correct) {
      playSound("success");
    }

    // Speak the word after correct submission in spelling mode
    if (correct && mode === "spelling" && autoSpeak) {
      void pronounceCurrent(current.word);
    }
  }, [current, typed, graded, mode, autoSpeak, pronounceCurrent]);

  /**
   * Reveal the answer, then require the learner to copy it once.
   *
   * Showing the answer is not the end of the question: the learner types the
   * word while it is visible, and only then is the question graded. That
   * applies to the modes that have a text field — spelling and dictation.
   *
   * The choice mode has no field to type into, so offering a copy step there
   * gave a panel and a button with nothing to fill in.
   */
  const reveal = useCallback(() => {
    if (!current || graded) return;
    setGraded({
      correct: false,
      marks: [],
      expected: current.word,
      revealed: true,
    });
    // Only the typed modes can copy the word.
    setCopySpelling(mode !== "choice");
    setTyped("");
    // The dictation mode has no visible prompt, so play the word again to
    // make the copy step possible.
    if (mode === "dictation") {
      void pronounceCurrent(current.word);
    }
  }, [current, graded, mode, pronounceCurrent]);

  /** Pick one of the multiple-choice options. */
  const pickChoice = useCallback(
    (choice: Choice) => {
      if (!current || graded) return;
      setGraded({
        correct: choice.correct,
        marks: [],
        expected: current.word,
        revealed: false,
        picked: choice.entryId,
      });
      if (choice.correct) {
        playSound("success");
      }
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
  /**
   * Finish the copy step.
   *
   * Copying does not grade the word: it only proves the learner has read the
   * answer. The answer is then hidden and the same word is typed again from
   * memory, which is what actually counts. The reveal therefore costs the
   * learner two passes instead of one.
   */
  const finishCopy = useCallback(() => {
    if (!current || !copySpelling) return;
    setCopySpelling(false);
    setGraded(null);
    setTyped("");
    // Move the caret back so the blind attempt starts cleanly.
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [current, copySpelling]);

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
        // Keep the state FSRS returned: a word in a learning step is not the
        // same as one under review, and forcing 2 discarded that stage.
        state: outcome.state,
        correct: graded.correct && rating >= 3,
      });

      onChange();
      setIndex((value) => value + 1);
      setTyped("");
      setGraded(null);
      setCopySpelling(false);
      setStartedAt(Date.now());

      // Persist the new position so the session can be resumed later.
      void saveSession({
        ids: queue.map((item) => item.entryId),
        answered: index + 1,
        bookId,
        scope,
        mode,
        limit: sessionSize,
        updatedAt: Date.now(),
      });
    },
    [current, graded, mode, startedAt, onChange, queue, index, bookId, scope, sessionSize],
  );

  /** Move to the next word without grading the current one. */
  const skip = useCallback(() => {
    setIndex((value) => value + 1);
    setTyped("");
    setGraded(null);
    setStartedAt(Date.now());

    void saveSession({
      ids: queue.map((item) => item.entryId),
      answered: index + 1,
      bookId,
      scope,
      mode,
      limit: sessionSize,
      updatedAt: Date.now(),
    });
  }, [queue, index, bookId, scope, mode, sessionSize]);

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
        // Closing the reference comes first: Escape should dismiss it rather
        // than throw the learner out of practice.
        if (shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
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
          if (copySpelling) {
            finishCopy();
          } else {
            void commit(graded.correct ? 3 : 1);
          }
          return;
        }
        if (mode === "choice" && choices.length > 0) {
          // Enter confirms the first option that is still available.
          const first = choices.find((choice) => !choice.correct);
          if (first) pickChoice(first);
        }
        return;
      }

      // After the answer is shown, 1-4 rate the word: the same keys that
      // pick an option also record how well it was remembered, so the learner
      // never has to reach for the mouse.
      if (graded && !copySpelling && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        void commit(Number(event.key) as Rating);
        return;
      }

      // The number keys pick an option in the multiple-choice mode.
      if (mode === "choice" && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        const index = Number(event.key) - 1;
        const choice = choices[index];
        if (choice && !graded) pickChoice(choice);
        return;
      }

      // A question mark opens the shortcut reference.
      if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }

      // F1, F2 and F3 switch between the three practice modes.
      if (event.key === "F1" || event.key === "F2" || event.key === "F3") {
        event.preventDefault();
        const next: StudyMode =
          event.key === "F1" ? "spelling" : event.key === "F2" ? "choice" : "dictation";
        setMode(next);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [graded, commit, skip, mode, choices, pickChoice, onExit, pronounceCurrent, copySpelling, finishCopy, shortcutsOpen]);

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
    if (event.key !== "Enter") {
        // Ctrl+R replays the pronunciation.
        if (event.ctrlKey && event.key.toLowerCase() === "r") {
          event.preventDefault();
          void pronounceCurrent();
        }
        return;
      }
    event.preventDefault();
    handledEnter.current = true;
    if (graded) {
      // During the copy step the answer is on screen, so Enter finishes the
      // copy instead of grading: grading here would jump to the next word and
      // skip the blind retry the step exists for.
      if (copySpelling) {
        finishCopy();
      } else {
        void commit(graded.correct ? 3 : 1);
      }
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
      <div className="practice">
        <div className="practice__body">
          <div className="practice__spacer" />
          <div className="empty">
            <div className="empty__title">这一轮完成了</div>
            <p style={{ margin: 0 }}>休息一下，或者再来一轮。</p>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void load(bookId, scope, sessionSize)}
              >
                再来一轮
              </button>
              <button type="button" className="button" onClick={onExit}>
                返回首页
              </button>
            </div>
          </div>
          <div className="practice__spacer" />
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
      <div className="practice__toolbar">
        {/* Leaving is the first thing a new learner looks for, and Escape is
            not something they can see. The label lives in the tooltip so the
            arrow does not compete with the controls. */}
        <button
          type="button"
          className="practice__back"
          onClick={onExit}
          title="返回首页（Esc）"
          aria-label="返回首页"
        >
          ←
        </button>

        <span className="practice__divider" aria-hidden="true" />

        {/* What the session is: which book, which mode, how many, and how far
            through. One cluster so the group reads as a unit. */}
        <div className="practice__group practice__group--session">
        <select
          className="input"
          value={bookId}
          onChange={(event) => {
            const next = event.target.value;
            setBookId(next);
            // Picking another book starts a new session; the mount-time guard
            // must not swallow that.
            void load(next, scope, sessionSize);
          }}
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
          value={mode}
          onChange={(event) => setMode(event.target.value as StudyMode)}
          aria-label="模式"
        >
          <option value="spelling">拼写</option>
          <option value="choice">词义选择</option>
          <option value="dictation">听写</option>
        </select>
        <select
          className="input"
          value={sessionSize}
          onChange={(event) => {
            const next = Number(event.target.value);
            setSessionSize(next);
            void load(bookId, scope, next);
          }}
          aria-label="本轮数量"
          title="改数量后会重新开始一轮"
        >
          {/*
            A review is sized by the number of words FSRS says are due, which
            is often not one of the round presets. Include the current size so
            the select shows it instead of going blank.
          */}
          {sizeChoices.map((size) => (
            <option key={size} value={size}>
              {size} 词
            </option>
          ))}
        </select>
        <span className="chip chip--outline">
          {index + 1} / {queue.length}
        </span>
        {current.isReview && <span className="chip">复习</span>}
        {standing && (
          <span
            className={`chip chip--memory chip--memory-${standing.tone}`}
            title={
              standing.tone === "new"
                ? "第一次见到这个词"
                : `已复习 ${standing.reviews} 次，忘记 ${standing.lapses} 次，下次间隔约 ${standing.intervalDays} 天`
            }
          >
            {standing.label}
            {standing.tone !== "new" && (
              <span className="chip__sub">{standing.intervalDays}d</span>
            )}
          </span>
        )}

        </div>

        {/* Everything from here on is an audio or display toggle, so it is
            pushed to the far end and reads as its own group. */}
        <div className="practice__group practice__group--toggles">
        <button
          type="button"
          className="chip"
          onClick={() => void pronounceCurrent()}
          disabled={speaking}
          title="朗读（Ctrl+R）"
        >
          {speaking ? "🔊 朗读中" : "🔊 发音"}
        </button>

        <select
          className="input"
          value={accent}
          onChange={(event) => {
            const next = event.target.value as Accent;
            setAccent(next);
            void saveSetting("voiceAccent", next);
          }}
          aria-label="口音"
        >
          <option value="us">美音</option>
          <option value="uk">英音</option>
        </select>

        <button
          type="button"
          className={`chip ${autoSpeak ? "chip--on" : ""}`}
          onClick={() => {
            const next = !autoSpeak;
            setAutoSpeak(next);
            void saveSetting("autoSpeak", String(next));
          }}
          title="自动朗读"
        >
          {autoSpeak ? "自动朗读 开" : "自动朗读 关"}
        </button>

        <button
          type="button"
          className={`chip ${soundOn ? "chip--on" : ""}`}
          onClick={() => {
            const next = !soundOn;
            setSoundOn(next);
            setSoundEnabled(next);
            void saveSetting("typingSound", String(next));
            if (next) {
              preloadSounds();
              playSound("key");
            }
          }}
          title="打字音效"
        >
          {soundOn ? "音效 开" : "音效 关"}
        </button>

        <button
          type="button"
          className={`chip ${shortcutsOpen ? "chip--on" : ""}`}
          onClick={() => setShortcutsOpen((open) => !open)}
          title="快捷键（?）"
          aria-label="快捷键说明"
        >
          ?
        </button>
        </div>
      </div>

      {shortcutsOpen && (
        <div
          className="shortcut-help"
          role="dialog"
          aria-label="快捷键"
          onClick={() => setShortcutsOpen(false)}
        >
          <div className="shortcut-help__panel" onClick={(event) => event.stopPropagation()}>
            <div className="shortcut-help__head">
              <h2 className="shortcut-help__title">快捷键</h2>
              <button
                type="button"
                className="shortcut-help__close"
                onClick={() => setShortcutsOpen(false)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <dl className="shortcut-help__list">
              {[
                ["Enter", "判定；显示答案后按 Enter 完成抄写"],
                ["1 – 4", "选择题选选项；显示答案后评分（忘记 / 困难 / 记得 / 简单）"],
                ["F1 / F2 / F3", "切换 拼写 / 选择 / 听写"],
                ["Ctrl + R", "重听发音"],
                ["Ctrl + Enter", "跳过这个单词"],
                ["Esc", "返回首页"],
                ["?", "显示这张表"],
              ].map(([key, action]) => (
                <div className="shortcut-help__row" key={key}>
                  <dt>
                    <kbd>{key}</kbd>
                  </dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      <div className="practice__body">
        <div className="practice__spacer" />

        {mode === "choice" ? (
        <div className="practice__stage">
          <p className="practice__word">{current.word}</p>
          <p className="practice__pos choice__prompt">从下面选出它的中文释义</p>
          <div className="choices">
            {choices.map((choice, index) => {
              // The correct option goes green, and the one the learner
              // picked goes red when it was not the answer. Comparing with
              // `current.entryId` (the correct id) meant the red branch could
              // never match.
              const state = graded
                ? choice.correct
                  ? "choice--correct"
                  : choice.entryId === graded.picked
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
                  {/* The index matches the 1-4 shortcut, so the keys and the
                      list refer to the same option. */}
                  <span className="choice__index">{index + 1}</span>
                  <span className="choice__text">{choice.text}</span>
                  {graded && choice.correct && (
                    <span className="choice__mark" aria-label="正确答案">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : mode === "dictation" ? (
        <div className="practice__stage">
          <p className="practice__pos">听发音，写出这个单词</p>
          <button
            type="button"
            className="dictation__play"
            onClick={() => void pronounceCurrent()}
            disabled={speaking}
            title="播放（Ctrl+R）"
          >
            {speaking ? "🔊" : "▶"}
          </button>
          <p className="practice__pos" style={{ marginTop: 10 }}>
            {current.phrase ? "词组" : current.pos} · {current.word.length} 个字母
          </p>

          <div className="practice__slots">
            {/*
              One slot per letter of the word. The row used to grow when the
              typed answer was longer, which made a typo look like a longer
              word; extra letters are trimmed from the markings instead.
            */}
            {Array.from({
              length: current.word.replace(/[^a-z]/gi, "").length,
            }).map((_, slotIndex) => {
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
            })}
          </div>

          <input
            ref={inputRef}
            className="input practice__input"
            value={typed}
            disabled={Boolean(graded) && !copySpelling}
            onChange={(event) => {
              setTyped(event.target.value);
              playSound("key");
            }}
            onKeyDown={onInputKeyDown}
            placeholder={copySpelling ? "照着拼写" : "听音写词"}
            autoComplete="off"
            spellCheck={false}
            aria-label="答案"
          />
        </div>
      ) : (
        <div className="practice__stage">
          <p className="practice__prompt gloss">{current.meaning}</p>
          <p className="practice__pos">
            {current.phrase ? "词组" : current.pos}
            {current.phonetic ? ` · /${current.phonetic}/` : ` · ${current.word.length} 个字母`}
          </p>

          <div className="practice__slots">
            {/* One slot per letter, as in the dictation mode: the row must
                show the length of the word, not of what was typed. */}
            {Array.from({ length: current.word.replace(/[^a-z]/gi, "").length }).map(
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
            className="input practice__input"
            value={typed}
            disabled={Boolean(graded) && !copySpelling}
            onChange={(event) => {
              setTyped(event.target.value);
              playSound("key");
            }}
            onKeyDown={onInputKeyDown}
            placeholder={copySpelling ? "照着拼写" : "在这里输入英文"}
            autoComplete="off"
            spellCheck={false}
            aria-label="答案"
          />
        </div>
      )}

      {copySpelling && (
        <div className="copy-panel">
          <div className="copy-panel__label">看着这个单词抄写一遍</div>
          <div className="copy-panel__word">{current.word}</div>
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
      ) : copySpelling ? (
        /* Copy step: the answer is visible, so the only action is to submit. */
        <div className="practice__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={finishCopy}
            disabled={typed.trim().length === 0}
          >
            抄写完成，再默写一遍
          </button>
        </div>
      ) : (
        <div className="review">
          <div className="review__answer">
            <span className={`review__badge ${graded.correct ? "review__badge--ok" : "review__badge--miss"}`}>
              {graded.correct ? "答对了" : graded.revealed ? "已显示答案" : "拼写有误"}
            </span>
            <span className="review__word">{graded.expected}</span>
            <button
              type="button"
              className="review__speak"
              onClick={() => void pronounceCurrent(graded.expected)}
              disabled={speaking}
              aria-label="朗读"
            >
              🔊
            </button>
          </div>

          {current.phonetic && (
            <p className="review__phonetic">/{current.phonetic}/</p>
          )}

          {/*
            The gloss belongs here in every mode. In the choice mode the answer
            was shown only as part of the options, so revealing it left the
            review card with the word and nothing to check it against.
          */}
          {current.meaning && <p className="review__meaning">{current.meaning}</p>}

          {current.etymology && (
            <p className="review__etymology">{current.etymology}</p>
          )}

          {current.example && (
            <p className="review__example">
              {current.example}
              {current.exampleZh && <span className="review__example-zh">{current.exampleZh}</span>}
            </p>
          )}

          {/*
            The four FSRS buttons sit right under the answer they are grading,
            labelled with the interval each one would produce, so the choice
            has a visible consequence instead of being decoration.
          */}
          <div className="review__ratings">
            <span className="review__ratings-label">这次记住了吗</span>
            <div className="review__ratings-row">
              {([1, 2, 3, 4] as Rating[]).map((rating) => (
                <button
                  key={rating}
                  type="button"
                  className={`grade grade--${rating}`}
                  onClick={() => void commit(rating)}
                  title={`下次复习：${formatInterval(intervals[rating])}`}
                >
                  <span className="grade__name">
                    {rating === 1 ? "忘记" : rating === 2 ? "困难" : rating === 3 ? "记得" : "简单"}
                  </span>
                  <span className="grade__interval">{formatInterval(intervals[rating])}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="review__tools">
            <button
              type="button"
              className="button button--small button--ghost"
              onClick={() => void toggleNotebook(current.entryId)}
            >
              {notebookIds.has(current.entryId) ? "移出生词本" : "加入生词本"}
            </button>
          </div>
        </div>
      )}
        <div className="practice__spacer" />
      </div>
    </div>
  );
}
