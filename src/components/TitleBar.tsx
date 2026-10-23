import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

import { isTauri } from "../lib/api";

/**
 * The custom title bar.
 *
 * The window is frameless (`decorations: false`), so the title bar has to
 * provide the drag handle and the window buttons itself.
 */
export default function TitleBar({ title }: { title: string }) {
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void getCurrentWindow()
      .isMaximized()
      .then(setMaximised)
      .catch(() => undefined);
  }, []);

  const toggleMaximise = async () => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
    setMaximised(await appWindow.isMaximized());
  };

  const minimise = () => {
    if (!isTauri()) return;
    void getCurrentWindow().minimize();
  };

  const close = () => {
    if (!isTauri()) return;
    void getCurrentWindow().close();
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand">
        <span className="titlebar__mark">词</span>
        <span className="titlebar__title">{title}</span>
      </div>
      <div className="titlebar__spacer" data-tauri-drag-region />
      <div className="titlebar__buttons">
        <button type="button" className="titlebar__button" onClick={minimise} aria-label="最小化">
          ─
        </button>
        <button
          type="button"
          className="titlebar__button"
          onClick={() => void toggleMaximise()}
          aria-label={maximised ? "还原" : "最大化"}
        >
          {maximised ? "❐" : "☐"}
        </button>
        <button type="button" className="titlebar__button titlebar__button--close" onClick={close} aria-label="关闭">
          ✕
        </button>
      </div>
    </div>
  );
}
