import { useMemo, useState } from "react";

import type { BookWithStats } from "../lib/api";
import type { DashboardStats, StudyMode, StudyScope } from "../lib/types";
import { weekDayLabels } from "../lib/week";

/** A short line of encouragement shown under the plan. */
const QUOTES: Array<{ en: string; zh: string }> = [
  {
    en: "What you learn today is tomorrow's footing.",
    zh: "今天记住的，就是明天的底气。",
  },
  {
    en: "Review first, then learn something new.",
    zh: "先复习，再学新词。",
  },
  {
    en: "Know the roots and half the words come free.",
    zh: "把词根记牢，生词会少一半。",
  },
  {
    en: "Slow is fine. Just do not stop.",
    zh: "慢一点没关系，别断就行。",
  },
  {
    en: "Memory is the scribe of the soul.",
    zh: "记忆，是灵魂的书记官。",
  },
  {
    en: "We are what we repeatedly do.",
    zh: "我们反复做的事，塑造了我们。",
  },
];

/** The three practice modes offered on the plan card. */
const MODES: Array<{ id: StudyMode; label: string }> = [
  { id: "spelling", label: "拼写" },
  { id: "choice", label: "选择" },
  { id: "dictation", label: "听写" },
];

const SCOPES: Array<{ id: StudyScope; label: string }> = [
  { id: "mix", label: "新词 + 复习" },
  { id: "new", label: "只学新词" },
  { id: "review", label: "只复习" },
];

interface HomePageProps {
  stats: DashboardStats;
  books: BookWithStats[];
  onStart: (mode: StudyMode, scope: StudyScope) => void;
  onRefresh: () => void;
}

/** The learner's home page: today's plan, progress and the weekly chart. */
export default function HomePage({ stats, books, onStart }: HomePageProps) {
  const [mode, setMode] = useState<StudyMode>("spelling");
  const [scope, setScope] = useState<StudyScope>("mix");

  const quote = useMemo(() => QUOTES[new Date().getDate() % QUOTES.length], []);

  const week = stats.weekly.length === 7 ? stats.weekly : [0, 0, 0, 0, 0, 0, 0];
  const weekMax = Math.max(1, ...week);
  const weekDays = useMemo(() => weekDayLabels(), []);

  const totalWords = books.reduce((sum, book) => sum + book.total, 0);
  const goal = 20;
  const goalProgress = Math.min(1, stats.todayNew / goal);

  const hours = Math.floor(stats.studySeconds / 3600);
  const minutes = Math.floor((stats.studySeconds % 3600) / 60);

  return (
    <div className="grid" style={{ gap: 18 }}>
      {/* --- today's plan ------------------------------------------------- */}
      <section className="card plan">
        <div className="plan__main">
          <div className="plan__eyebrow">TODAY&apos;S PLAN</div>
          <p className="plan__quote">{quote.en}</p>
          <p className="plan__quote-zh">{quote.zh}</p>

          <div className="plan__actions">
            <button
              type="button"
              className="button button--primary button--large"
              onClick={() => onStart(mode, scope)}
            >
              开始学习
            </button>
            <div className="plan__modes">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`mode-pill ${mode === item.id ? "mode-pill--active" : ""}`}
                  onClick={() => setMode(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <select
              className="input plan__scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as StudyScope)}
              aria-label="学习范围"
            >
              {SCOPES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="plan__side">
          <div className="plan__side-row">
            <span className="stat__label">今日新词</span>
            <span className="plan__due">待复习 {stats.dueCount}</span>
          </div>
          <div className="plan__count">
            <span className="plan__count-value">{stats.todayNew}</span>
            <span className="plan__count-unit">词</span>
          </div>
          <div className="meter">
            <div className="meter__fill" style={{ width: `${goalProgress * 100}%` }} />
          </div>
          <div className="plan__count-foot">
            {stats.todayNew} / {goal}
          </div>
        </div>
      </section>

      {/* --- weekly chart ------------------------------------------------- */}
      <section className="card">
        <div className="card__body">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
            <h2 className="section-title">本周新词</h2>
            <span className="chip chip--outline">近 7 天</span>
          </div>
          <p className="section-subtitle">全部词书的单词与词组，按首次学习日计数。</p>

          <div className="bars">
            {week.map((value, index) => (
              <div className="bar" key={`${weekDays[index].label}-${index}`}>
                <span className="bar__value">{value}</span>
                <div className="bar__track">
                  <div
                    className={`bar__fill ${weekDays[index].isToday ? "" : "bar__fill--muted"}`}
                    style={{ height: `${(value / weekMax) * 100}%` }}
                  />
                </div>
                <span className={`bar__label ${weekDays[index].isToday ? "bar__label--today" : ""}`}>
                  {weekDays[index].label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- summary ------------------------------------------------------ */}
      <section className="grid grid--3">
        <div className="card">
          <div className="card__body">
            <div className="stat">
              <span className="stat__label">连续天数</span>
              <span className="stat__value">
                {stats.streak}
                <span className="stat__unit">天</span>
              </span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card__body">
            <div className="stat">
              <span className="stat__label">已掌握</span>
              <span className="stat__value">
                {stats.mastered}
                <span className="stat__unit">词</span>
              </span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card__body">
            <div className="stat">
              <span className="stat__label">累计学习</span>
              <span className="stat__value">
                {hours}
                <span className="stat__unit">时</span>
                {minutes}
                <span className="stat__unit">分</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* --- library overview --------------------------------------------- */}
      <section className="card">
        <div className="card__body">
          <h2 className="section-title">词库概览</h2>
          <p className="section-subtitle">
            共 {books.length} 本词书 · {totalWords.toLocaleString()} 条词汇 · 已开始 {stats.started} 条
          </p>
          <div className="books">
            {books.slice(0, 6).map((book) => (
              <div className="book" key={book.id}>
                <div className="book__name">{book.name}</div>
                <div className="book__meta">
                  <span className="chip chip--outline">{book.short}</span>
                  <span>{book.total.toLocaleString()} 词</span>
                </div>
                <div className="book__progress">
                  <div className="meter">
                    <div
                      className="meter__fill"
                      style={{ width: `${book.total ? (book.mastered / book.total) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="book__meta">
                    掌握 {book.mastered} / {book.total}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
