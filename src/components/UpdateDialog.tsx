import { useState } from "react";

import type { Update } from "@tauri-apps/plugin-updater";

import { downloadAndInstall, RELEASES_URL, type UpdateStatus } from "../lib/updater";

interface UpdateDialogProps {
  status: UpdateStatus;
  /** The handle used to download, present when a update is available. */
  update: Update | null;
  onClose: () => void;
  /** Called after a successful install, before the relaunch. */
  onInstalled?: () => void;
}

/** Turn a release note into short list items. */
function noteLines(notes: string): string[] {
  return notes
    .split("\n")
    .map((line) => line.replace(/^\s*[-*#]+\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^v?\d+\.\d+/.test(line))
    .slice(0, 8);
}

/**
 * The update announcement.
 *
 * Two states, matching what the learner cares about: either the running
 * version is the newest, or there is something to install with its notes.
 */
export default function UpdateDialog({ status, update, onClose, onInstalled }: UpdateDialogProps) {
  const [progress, setProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startInstall = async () => {
    if (!update) return;
    setInstalling(true);
    setError(null);
    try {
      await downloadAndInstall(update, setProgress);
      onInstalled?.();
    } catch (thrown) {
      setInstalling(false);
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  };

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <div className="modal-backdrop" onClick={installing ? undefined : onClose}>
      <div
        className="modal update-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="软件更新"
        onClick={(event) => event.stopPropagation()}
      >
        {status.kind === "current" && (
          <>
            <header className="update-dialog__head">
              <h2 className="update-dialog__title">已是最新版本</h2>
              <p className="update-dialog__versions">
                当前 v{status.version} → 最新 v{status.version}
              </p>
            </header>
            <p className="update-dialog__note">你用的已经是最新版，没有需要更新的内容。</p>
            <footer className="update-dialog__foot">
              <button type="button" className="button" onClick={onClose}>
                关闭
              </button>
            </footer>
          </>
        )}

        {status.kind === "available" && (
          <>
            <header className="update-dialog__head">
              <h2 className="update-dialog__title">发现新版本</h2>
              <p className="update-dialog__versions">最新 v{status.version}</p>
            </header>

            <div className="update-dialog__body">
              <h3 className="update-dialog__section">本次更新</h3>
              {status.notes ? (
                <ul className="update-dialog__notes">
                  {noteLines(status.notes).map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="update-dialog__empty">这个版本没有附带更新说明。</p>
              )}

              {installing && (
                <div className="update-dialog__progress">
                  <div className="meter">
                    <div className="meter__fill" style={{ width: `${percent ?? 12}%` }} />
                  </div>
                  <span className="update-dialog__progress-text">
                    {percent === null ? "正在下载…" : `正在下载 ${percent}%`}
                  </span>
                </div>
              )}

              {error && <p className="update-dialog__error">安装失败：{error}</p>}
            </div>

            <footer className="update-dialog__foot">
              <button type="button" className="button" onClick={onClose} disabled={installing}>
                稍后
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void startInstall()}
                disabled={installing || !update}
              >
                {installing ? "正在安装…" : "下载并安装"}
              </button>
            </footer>
          </>
        )}

        {status.kind === "failed" && (
          <>
            <header className="update-dialog__head">
              <h2 className="update-dialog__title">无法检查更新</h2>
              <p className="update-dialog__versions">连接不到更新服务器</p>
            </header>
            <div className="update-dialog__body">
              <p className="update-dialog__empty">
                可能是网络问题。你也可以手动打开下载页，自己下载新版本覆盖安装。
              </p>
              {status.reason && <p className="update-dialog__error">{status.reason}</p>}
            </div>
            <footer className="update-dialog__foot">
              <a className="button" href={RELEASES_URL} target="_blank" rel="noreferrer">
                打开下载页
              </a>
              <button type="button" className="button button--primary" onClick={onClose}>
                关闭
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
