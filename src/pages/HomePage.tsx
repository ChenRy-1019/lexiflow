import { useMemo, useState } from "react";

import type { BookWithStats } from "../lib/api";
import type { DashboardStats } from "../lib/types";

/** A short line of encouragement shown under the plan. */
const NOTES = [
  "先复习，再学新词。",
  "把词根记牢，生词会少一半。",
  "慢一点没关系，别断就行。",
  "今天记住的，就是明天的底气。",
];

interface HomePageProps {
  stats: DashboardStats;
  books: BookWithStats[];
  onStart: () => void;
  onRefresh: () => void;
}

/** The learner's home page: today's plan, progress and the weekly chart. */
export default function HomePage({ stats, books, onStart }: HomePageProps) {
  const [scope, setScope] = useState<"mix" | "new" | "review">("mix");

  const note = useMemo(() => {
    const index = new Date().getDate() % NOTES.length;
    return NOTES[index];
  }, []);

  const week = stats.weekly.length === 7 ? stats.weekly : [0, 0, 0, 0, 0, 0, 0];
  const weekMax = Math.max(1, ...week);
  const labels = ["一", "二", "三", "四", "五", "六", "日"];
  const todayIndex = (new Date().getDay() + 6) % 7;

  const totalWords = books.reduce((sum, book) => sum + book.total, 0);
  const goal = 20;
  const goalProgress = Math.min(1, stats.todayNew / goal);

  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="card">
        <div className="card__body" style={{ display: "flex", gap: 32 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="section-title" style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--ink-faint)", textTransform: "uppercase" }}>
              Today&apos;s plan
            </div>
            <p style={{ fontFamily: "var(--font-en)", fontSize: 26, margin: "10px 0 4px" }}>
              Keep the thread going.
            </p>
            <p className="gloss" style={{ color: "var(--ink-muted)", margin: "0 0 20px" }}>
              {note}
            </p>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="button button--primary" onClick={onStart}>
                开始今日计划
              </button>
              <select
                className="input"
                style={{ width: "auto" }}
                value={scope}
                onChange={(event) => setScope(event.target.value as typeof scope)}
                aria-label="学习范围"
              >
                <option value="mix">新词 + 复习</option>
                <option value="new">只学新词</option>
                <option value="review">只复习</option>
              </select>
            </div>
          </div>

          <div style={{ width: 240, flexShrink: 0 }}>
            <div className="stat">
              <span className="stat__label">今日新词</span>
              <span className="stat__value">
                {stats.todayNew}
                <span className="stat__unit">/ {goal} 词</span>
              </span>
            </div>
            <div className="meter" style={{ marginTop: 10 }}>
              <div className="meter__fill" style={{ width: `${goalProgress * 100}%` }} />
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 20 }}>
              <div className="stat">
                <span className="stat__label">连续天数</span>
                <span className="stat__value" style={{ fontSize: 20 }}>
                  {stats.streak}
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">已掌握</span>
                <span className="stat__value" style={{ fontSize: 20 }}>
                  {stats.mastered}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__body">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
            <h2 className="section-title">本周新词</h2>
            <span className="chip chip--outline">近 7 天</span>
          </div>
          <p className="section-subtitle">每天第一次学到的单词计一次，重复复习不重复计数。</p>

          <div className="bars">
            {week.map((value, index) => (
              <div className="bar" key={labels[index]}>
                <span className="bar__value">{value}</span>
                <div className="bar__track">
                  <div
                    className={`bar__fill ${index === todayIndex ? "" : "bar__fill--muted"}`}
                    style={{ height: `${(value / weekMax) * 100}%` }}
                  />
                </div>
                <span className="bar__label">{labels[index]}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

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
                  <span className="book__meta">掌握 {book.mastered} / {book.total}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
