import { useEffect, useState } from "react";

import {
  fetchDatabasePath,
  fetchLexiconTotal,
  fetchSetting,
  resetProgress,
  saveSetting,
} from "../lib/api";

interface SettingsPageProps {
  onReset: () => void;
  notify: (message: string) => void;
}

/** The preferences page: data location, backup and resets. */
export default function SettingsPage({ onReset, notify }: SettingsPageProps) {
  const [dbPath, setDbPath] = useState("");
  const [lexiconTotal, setLexiconTotal] = useState(0);
  const [dailyGoal, setDailyGoal] = useState("20");
  const [accent, setAccent] = useState("us");

  useEffect(() => {
    void fetchDatabasePath().then(setDbPath);
    void fetchLexiconTotal().then(setLexiconTotal);
    void fetchSetting("dailyGoal").then((value) => {
      if (value) setDailyGoal(value);
    });
    void fetchSetting("voiceAccent").then((value) => {
      if (value) setAccent(value);
    });
  }, []);

  /** Persist a preference. */
  const persist = async (key: string, value: string) => {
    await saveSetting(key, value);
    notify("已保存");
  };

  /** Wipe the learning history. */
  const wipe = async () => {
    if (!window.confirm("确定要清空所有学习进度吗？此操作无法撤销。")) return;
    await resetProgress();
    onReset();
    notify("学习进度已清空");
  };

  return (
    <div className="grid" style={{ gap: 18, maxWidth: 720 }}>
      <section className="card">
        <div className="card__body">
          <h2 className="section-title">学习偏好</h2>
          <p className="section-subtitle">这些设置会立即生效，并保存在本机。</p>

          <div className="grid grid--2" style={{ gap: 16 }}>
            <label className="field">
              <span className="field__label">每日目标（词）</span>
              <input
                className="input"
                type="number"
                min={5}
                max={200}
                value={dailyGoal}
                onChange={(event) => setDailyGoal(event.target.value)}
                onBlur={() => void persist("dailyGoal", dailyGoal)}
              />
            </label>

            <label className="field">
              <span className="field__label">发音口音</span>
              <select
                className="input"
                value={accent}
                onChange={(event) => {
                  setAccent(event.target.value);
                  void persist("voiceAccent", event.target.value);
                }}
              >
                <option value="us">美式</option>
                <option value="uk">英式</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__body">
          <h2 className="section-title">数据与备份</h2>
          <p className="section-subtitle">
            所有学习记录都保存在本机，不会上传到任何服务器。
          </p>

          <div className="field" style={{ marginBottom: 16 }}>
            <span className="field__label">数据库位置</span>
            <code
              style={{
                display: "block",
                padding: "9px 12px",
                background: "var(--accent-soft)",
                borderRadius: "var(--radius)",
                fontSize: 12,
                wordBreak: "break-all",
              }}
            >
              {dbPath || "正在读取…"}
            </code>
          </div>

          <div className="field">
            <span className="field__label">内置词库</span>
            <span className="gloss" style={{ color: "var(--ink-muted)" }}>
              共 {lexiconTotal.toLocaleString()} 条词条，随应用一起分发。
            </span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__body">
          <h2 className="section-title">重置</h2>
          <p className="section-subtitle">
            清空学习进度、生词本和统计记录。词库本身不受影响。
          </p>
          <button type="button" className="button button--danger" onClick={() => void wipe()}>
            清空学习数据
          </button>
        </div>
      </section>
    </div>
  );
}
