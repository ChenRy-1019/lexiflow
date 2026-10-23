import { useMemo } from "react";

import type { BookWithStats } from "../lib/api";
import type { DashboardStats } from "../lib/types";

interface StatsPageProps {
  stats: DashboardStats;
  books: BookWithStats[];
}

/** The statistics page: progress, accuracy and per-book mastery. */
export default function StatsPage({ stats, books }: StatsPageProps) {
  const week = stats.weekly.length === 7 ? stats.weekly : [0, 0, 0, 0, 0, 0, 0];
  const weekMax = Math.max(1, ...week);
  const weekTotal = week.reduce((sum, value) => sum + value, 0);
  const labels = ["一", "二", "三", "四", "五", "六", "日"];
  const todayIndex = (new Date().getDay() + 6) % 7;

  const hours = Math.floor(stats.studySeconds / 3600);
  const minutes = Math.floor((stats.studySeconds % 3600) / 60);

  /** The books with the most progress, so the chart is not a wall of rows. */
  const topBooks = useMemo(
    () =>
      [...books]
        .filter((book) => book.started > 0)
        .sort((a, b) => b.mastered - a.mastered)
        .slice(0, 8),
    [books],
  );

  const accuracy = stats.started > 0 ? Math.round((stats.mastered / stats.started) * 100) : 0;

  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="grid grid--3">
        <div className="card">
          <div className="card__body">
            <div className="stat">
              <span className="stat__label">已学习词数</span>
              <span className="stat__value">
                {stats.started}
                <span className="stat__unit">词</span>
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
              <span className="stat__label">掌握率</span>
              <span className="stat__value">
                {accuracy}
                <span className="stat__unit">%</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid--2">
        <div className="card">
          <div className="card__body">
            <h2 className="section-title">本周新词</h2>
            <p className="section-subtitle">共 {weekTotal} 词</p>
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
        </div>

        <div className="card">
          <div className="card__body">
            <h2 className="section-title">学习时长</h2>
            <p className="section-subtitle">累计投入</p>
            <div style={{ display: "flex", gap: 32, marginTop: 12 }}>
              <div className="stat">
                <span className="stat__label">小时</span>
                <span className="stat__value">{hours}</span>
              </div>
              <div className="stat">
                <span className="stat__label">分钟</span>
                <span className="stat__value">{minutes}</span>
              </div>
              <div className="stat">
                <span className="stat__label">连续天数</span>
                <span className="stat__value">{stats.streak}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__body">
          <h2 className="section-title">各词书掌握度</h2>
          <p className="section-subtitle">按已掌握词数排序，只显示已经开始学习的词书。</p>

          {topBooks.length === 0 ? (
            <div className="empty">
              <div className="empty__title">还没有学习记录</div>
              <p style={{ margin: 0 }}>完成一轮练习后，这里会出现进度。</p>
            </div>
          ) : (
            <div className="list">
              {topBooks.map((book) => {
                const ratio = book.total ? book.mastered / book.total : 0;
                return (
                  <div className="list__row" key={book.id}>
                    <div style={{ width: 190 }}>
                      <div style={{ fontWeight: 500 }}>{book.name}</div>
                      <span className="book__meta">
                        {book.mastered} / {book.total}
                      </span>
                    </div>
                    <div className="meter" style={{ flex: 1 }}>
                      <div className="meter__fill" style={{ width: `${ratio * 100}%` }} />
                    </div>
                    <span className="book__meta" style={{ width: 52, textAlign: "right" }}>
                      {Math.round(ratio * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
