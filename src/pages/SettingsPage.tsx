import { useEffect, useState } from "react";

import { getVersion } from "@tauri-apps/api/app";

import {
  clearAudioCache,
  fetchAudioCacheInfo,
  fetchDatabasePath,
  fetchLexiconTotal,
  fetchSetting,
  resetProgress,
  saveSetting,
  type AudioCacheInfo,
} from "../lib/api";

interface SettingsPageProps {
  onReset: () => void;
  notify: (message: string) => void;
  /** Check the release server and show the result in a dialog. */
  onCheckUpdate?: () => void;
  /** Report a new daily goal so the home page and the ring follow. */
  onGoalChange?: (goal: number) => void;
}

/** The preferences page: data location, backup and resets. */
export default function SettingsPage({
  onReset,
  notify,
  onCheckUpdate,
  onGoalChange,
}: SettingsPageProps) {
  const [dbPath, setDbPath] = useState("");
  const [lexiconTotal, setLexiconTotal] = useState(0);
  const [dailyGoal, setDailyGoal] = useState("20");
  const [accent, setAccent] = useState("us");
  const [autoSpeak, setAutoSpeak] = useState("true");
  const [typingSound, setTypingSound] = useState("true");
  const [autoUpdate, setAutoUpdate] = useState("true");
  const [appVersion, setAppVersion] = useState("");
  const [cache, setCache] = useState<AudioCacheInfo>({ count: 0, sizeBytes: 0, directory: "" });

  /** Refresh the cache counters. */
  const refreshCache = async () => {
    setCache(await fetchAudioCacheInfo());
  };

  useEffect(() => {
    void fetchDatabasePath().then(setDbPath);
    void fetchLexiconTotal().then(setLexiconTotal);
    void fetchSetting("dailyGoal").then((value) => {
      if (value) setDailyGoal(value);
    });
    void fetchSetting("voiceAccent").then((value) => {
      if (value) setAccent(value);
    });
    void fetchSetting("autoSpeak").then((value) => {
      if (value !== null) setAutoSpeak(value);
    });
    void fetchSetting("typingSound").then((value) => {
      if (value !== null) setTypingSound(value);
    });
    void fetchSetting("autoCheckUpdates").then((value) => {
      if (value !== null) setAutoUpdate(value);
    });
    void fetchCurrentVersion().then(setAppVersion);
    void refreshCache();
  }, []);

  /** Read the version of the running application. */
  async function fetchCurrentVersion(): Promise<string> {
    try {
      return await getVersion();
    } catch {
      return "";
    }
  }

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
                min={1}
                max={200}
                value={dailyGoal}
                onChange={(event) => {
                  const raw = event.target.value;
                  setDailyGoal(raw);
                  // Persist on every valid change and tell the parent, so the
                  // home page and the sidebar ring follow immediately. Saving
                  // only on blur left the ring showing the old denominator.
                  const parsed = Number(raw);
                  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 200) {
                    void saveSetting("dailyGoal", String(parsed));
                    onGoalChange?.(parsed);
                  }
                }}
                onBlur={() => {
                  // Restore a sensible value if the field was left empty or
                  // with something out of range.
                  const parsed = Number(dailyGoal);
                  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
                    setDailyGoal("20");
                    void saveSetting("dailyGoal", "20");
                    onGoalChange?.(20);
                  }
                }}
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

            <label className="field">
              <span className="field__label">自动朗读</span>
              <select
                className="input"
                value={autoSpeak}
                onChange={(event) => {
                  setAutoSpeak(event.target.value);
                  void persist("autoSpeak", event.target.value);
                }}
              >
                <option value="true">开启</option>
                <option value="false">关闭</option>
              </select>
            </label>

            <label className="field">
              <span className="field__label">打字音效</span>
              <select
                className="input"
                value={typingSound}
                onChange={(event) => {
                  setTypingSound(event.target.value);
                  void persist("typingSound", event.target.value);
                }}
              >
                <option value="true">开启</option>
                <option value="false">关闭</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__body">
          <h2 className="section-title">发音缓存</h2>
          <p className="section-subtitle">
            单词发音首次播放时会联网下载并缓存，之后离线也能播放。
          </p>

          <div className="grid grid--2" style={{ gap: 16, marginBottom: 16 }}>
            <div className="stat">
              <span className="stat__label">已缓存发音</span>
              <span className="stat__value" style={{ fontSize: 22 }}>
                {cache.count}
                <span className="stat__unit">条</span>
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">占用空间</span>
              <span className="stat__value" style={{ fontSize: 22 }}>
                {(cache.sizeBytes / 1024 / 1024).toFixed(1)}
                <span className="stat__unit">MB</span>
              </span>
            </div>
          </div>

          {cache.directory && (
            <div className="field" style={{ marginBottom: 16 }}>
              <span className="field__label">缓存位置</span>
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
                {cache.directory}
              </code>
            </div>
          )}

          <button
            type="button"
            className="button button--danger"
            onClick={async () => {
              await clearAudioCache();
              await refreshCache();
              notify("发音缓存已清空");
            }}
          >
            清空发音缓存
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card__body">
          <h2 className="section-title">软件更新</h2>
          <p className="section-subtitle">
            安装包由签名验证，下载后自动替换并重启。
          </p>

          <div className="update-row">
            <div className="update-row__info">
              <span className="update-row__version">
                当前版本 v{appVersion || "—"}
              </span>
              <label className="update-row__toggle">
                <input
                  type="checkbox"
                  checked={autoUpdate === "true"}
                  onChange={(event) => {
                    const next = event.target.checked ? "true" : "false";
                    setAutoUpdate(next);
                    void saveSetting("autoCheckUpdates", next);
                    notify(next === "true" ? "启动时自动检查更新" : "已关闭自动检查");
                  }}
                />
                启动时自动检查更新
              </label>
            </div>

            <button
              type="button"
              className="button"
              onClick={onCheckUpdate}
              disabled={!onCheckUpdate}
            >
              检查更新
            </button>
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
