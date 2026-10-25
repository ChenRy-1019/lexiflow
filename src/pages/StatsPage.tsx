import { useMemo } from "react";

import type { BookWithStats } from "../lib/api";
import { weekDayLabels } from "../lib/week";
import type { DashboardStats } from "../lib/types";

interface StatsPageProps {
  stats: DashboardStats;
  books: BookWithStats[];
}

/**
 * Format a mastery ratio.
 *
 * One mastered word out of four thousand is 0.02%, which rounds to 0 and reads
 * as no progress at all. Below one percent the figure keeps a decimal so the
 * row does not claim nothing has happened.
 */
function formatPercent(ratio: number): string {
  const percent = ratio * 100;
  if (percent === 0) return "0%";
  if (percent < 1) return `${percent.toFixed(2)}%`;
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

/** A labelled figure with an optional unit and a note underneath. */
function Figure({
  label,
  value,
  unit,
  note,
  accent,
}: {
  label: string;
  value: string | number;
  unit?: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div className={`figure ${accent ? "figure--accent" : ""}`}>
      <span className="figure__label">{label}</span>
      <span className="figure__value">
        {value}
        {unit && <span className="figure__unit">{unit}</span>}
      </span>
      {note && <span className="figure__note">{note}</span>}
    </div>
  );
}

/**
 * The statistics page.
 *
 * It answers four questions in order: how much has been learnt, how consistent
 * the habit is, how well the recent answers went, and which wordbook needs
 * attention. Every card carries a figure plus a small explanation, so a card is
 * never a number floating in white space.
 */
export default function StatsPage({ stats, books }: StatsPageProps) {
  const week = stats.weekly.length === 7 ? stats.weekly : [0, 0, 0, 0, 0, 0, 0];
  const weekMax = Math.max(1, ...week);
  const weekTotal = week.reduce((sum, value) => sum + value, 0);
  const weekDays = useMemo(() => weekDayLabels(), []);

  const hours = Math.floor(stats.studySeconds / 3600);
  const minutes = Math.floor((stats.studySeconds % 3600) / 60);
  const remaining = Math.max(0, stats.started - stats.mastered);

  /** Average words per study day, over the days that have any activity. */
  const activeDays = week.filter((value) => value > 0).length;
  const dailyAverage = activeDays > 0 ? Math.round(weekTotal / activeDays) : 0;

  /** The busiest day of the week, named rather than numbered. */
  const busiest = useMemo(() => {
    let index = 0;
    week.forEach((value, at) => {
      if (value > week[index]) index = at;
    });
    return week[index] > 0 ? weekDays[index].label : null;
  }, [week, weekDays]);

  /** Books with progress, worst first: those are the ones to work on. */
  const booksInProgress = useMemo(
    () =>
      [...books]
        .filter((book) => book.started > 0)
        .sort((a, b) => {
          const left = a.total ? a.mastered / a.total : 0;
          const right = b.total ? b.mastered / b.total : 0;
          return left - right;
        }),
    [books],
  );

  const accuracy = stats.weekAccuracy ?? 0;
  const reviews = stats.weekReviews ?? 0;

  return (
    <div className="stats">
      {/* --- the four headline figures ------------------------------- */}
      <section className="stats__headline">
        <Figure
          label="已学习"
          value={stats.started.toLocaleString()}
          unit="词"
          note={`其中 ${stats.mastered} 词已掌握，${remaining} 词还在巩固`}
        />
        <Figure
          label="本周新词"
          value={weekTotal}
          unit="词"
          note={
            busiest
              ? `最多的一天是周${busiest}，平均每天 ${dailyAverage} 词`
              : "这七天还没有学习记录"
          }
        />
        <Figure
          label="本周正确率"
          value={reviews > 0 ? accuracy : "—"}
          unit={reviews > 0 ? "%" : undefined}
          note={reviews > 0 ? `共 ${reviews} 次作答` : "还没有作答记录"}
          accent={reviews > 0 && accuracy >= 80}
        />
        <Figure
          label="连续学习"
          value={stats.streak}
          unit="天"
          note={`最长记录 ${stats.bestStreak ?? stats.streak} 天`}
        />
      </section>

      {/* --- weekly chart and time investment ------------------------ */}
      <section className="stats__split">
        <div className="card">
          <div className="card__body">
            <div className="stats__card-head">
              <div>
                <h2 className="section-title">近七天</h2>
                <p className="section-subtitle">每天首次学习的新词数</p>
              </div>
              <span className="stats__badge">
                {weekTotal > 0 ? `共 ${weekTotal} 词` : "暂无记录"}
              </span>
            </div>

            <div className="bars bars--roomy">
              {week.map((value, index) => (
                <div className="bar" key={`${weekDays[index].label}-${index}`}>
                  <span className="bar__value">{value || ""}</span>
                  <div className="bar__track">
                    <div
                      className={`bar__fill ${weekDays[index].isToday ? "" : "bar__fill--muted"}`}
                      style={{ height: `${(value / weekMax) * 100}%` }}
                    />
                  </div>
                  <span
                    className={`bar__label ${weekDays[index].isToday ? "bar__label--today" : ""}`}
                  >
                    {weekDays[index].label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__body">
            <div className="stats__card-head">
              <div>
                <h2 className="section-title">学习投入</h2>
                <p className="section-subtitle">累计在练习上花的时间</p>
              </div>
            </div>

            <div className="stats__time">
              <span className="stats__time-value">
                {hours}
                <span className="stats__time-unit">时</span>
                {minutes}
                <span className="stats__time-unit">分</span>
              </span>
              <span className="stats__time-note">
                {stats.streak > 0
                  ? `已连续 ${stats.streak} 天，最长 ${stats.bestStreak ?? stats.streak} 天`
                  : "今天开始第一轮吧"}
              </span>
            </div>

            <div className="stats__time-split">
              <figure className="stats__time-part">
                <span className="stats__time-part-value">{activeDays}</span>
                <span className="stats__time-part-label">这七天有学习</span>
              </figure>
              <figure className="stats__time-part">
                <span className="stats__time-part-value">{dailyAverage}</span>
                <span className="stats__time-part-label">每天平均新词</span>
              </figure>
              <figure className="stats__time-part">
                <span className="stats__time-part-value">{reviews}</span>
                <span className="stats__time-part-label">本周作答次数</span>
              </figure>
            </div>
          </div>
        </div>
      </section>

      {/* --- per-book progress -------------------------------------- */}
      <section className="card">
        <div className="card__body">
          <div className="stats__card-head">
            <div>
              <h2 className="section-title">各词书掌握度</h2>
              <p className="section-subtitle">
                只显示已经开始学习的词书，掌握度低在前
              </p>
            </div>
            <span className="stats__badge">{booksInProgress.length} 本在学</span>
          </div>

          {booksInProgress.length === 0 ? (
            <div className="empty">
              <div className="empty__title">还没有学习记录</div>
              <p style={{ margin: 0 }}>完成一轮练习后，这里会出现进度。</p>
            </div>
          ) : (
            <div className="bookbars">
              {booksInProgress.map((book) => {
                const ratio = book.total ? book.mastered / book.total : 0;
                return (
                  <div className="bookbar" key={book.id}>
                    <div className="bookbar__head">
                      <span className="bookbar__name">{book.name}</span>
                      <span className="bookbar__count">
                        {book.mastered.toLocaleString()} / {book.total.toLocaleString()}
                      </span>
                    </div>
                    <div className="bookbar__track">
                      {/*
                        A book with a tiny ratio would otherwise render as a
                        dot. The minimum is a share of the track, so even one
                        mastered word of four thousand shows as a mark and the
                        bar reads as "some progress" rather than empty.
                      */}
                      <div
                        className={`bookbar__fill ${ratio >= 0.5 ? "bookbar__fill--solid" : ""} ${
                          ratio === 0 ? "bookbar__fill--none" : ""
                        }`}
                        style={{ width: ratio === 0 ? "0" : `${Math.max(ratio * 100, 2.5)}%` }}
                      />
                    </div>
                    <span className="bookbar__pct">{formatPercent(ratio)}</span>
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
