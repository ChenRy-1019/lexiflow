"""Wire the updater into App.tsx and the settings page."""

from pathlib import Path

app = Path("src/App.tsx")
src = app.read_text(encoding="utf-8")

# Imports.
old_import = 'import SettingsPage from "./pages/SettingsPage";'
new_import = 'import UpdateDialog from "./components/UpdateDialog";\nimport SettingsPage from "./pages/SettingsPage";'
if old_import in src:
    src = src.replace(old_import, new_import, 1)
    print("import added")
else:
    print("IMPORT ANCHOR NOT FOUND")

old_updater = 'import { fetchBooks, fetchStats, isTauri, loadSession, type BookWithStats } from "./lib/api";'
new_updater = ('import { fetchBooks, fetchStats, isTauri, loadSession, type BookWithStats } from "./lib/api";\n'
               'import { autoCheckEnabled, checkForUpdate, type UpdateStatus } from "./lib/updater";')
if old_updater in src:
    src = src.replace(old_updater, new_updater, 1)
    print("updater import added")
else:
    print("UPDATER ANCHOR NOT FOUND")

# State.
old_state = "  const [resumeSession, setResumeSession] = useState(false);"
new_state = ("  const [resumeSession, setResumeSession] = useState(false);\n"
             "  /** The update check result, shown in a dialog when present. */\n"
             "  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);\n"
             "  const [pendingUpdate, setPendingUpdate] = useState<Awaited<ReturnType<typeof checkForUpdate>>[\"update\"]>(null);")
if old_state in src:
    src = src.replace(old_state, new_state, 1)
    print("state added")
else:
    print("STATE ANCHOR NOT FOUND")

# Manual check handler plus the automatic one on startup.
old_notify = """  /** Show a short message at the bottom of the window. */"""
new_notify = """  /**
   * Check for an update.
   *
   * Called on startup when the setting is on, and from the settings page when
   * the learner asks. `showResult` is false for the startup check so a current
   * version does not interrupt the learner with a dialog.
   */
  const runUpdateCheck = useCallback(async (showResult: boolean) => {
    if (!isTauri()) {
      if (showResult) {
        setUpdateStatus({ kind: "failed", reason: "此功能需要在桌面应用中运行" });
      }
      return;
    }

    const { status, update } = await checkForUpdate();
    setPendingUpdate(update);

    // A startup check only speaks up when there is something to install.
    if (showResult || status.kind === "available") {
      setUpdateStatus(status);
    }
  }, []);

  useEffect(() => {
    void autoCheckEnabled().then((enabled) => {
      if (enabled) {
        void runUpdateCheck(false);
      }
    });
  }, [runUpdateCheck]);

  /** Show a short message at the bottom of the window. */"""
if old_notify in src:
    src = src.replace(old_notify, new_notify, 1)
    print("update check added")
else:
    print("NOTIFY ANCHOR NOT FOUND")

# Pass the check handler to the settings page.
old_settings = '        return <SettingsPage onReset={refresh} notify={notify} />;'
new_settings = '        return (\n          <SettingsPage\n            onReset={refresh}\n            notify={notify}\n            onCheckUpdate={() => void runUpdateCheck(true)}\n          />\n        );'
if old_settings in src:
    src = src.replace(old_settings, new_settings, 1)
    print("settings props wired")
else:
    print("SETTINGS ANCHOR NOT FOUND")

# Render the dialog.
old_toast = "      {toast && <div className=\"toast\">{toast}</div>}"
new_toast = """      {updateStatus && (
        <UpdateDialog
          status={updateStatus}
          update={pendingUpdate}
          onClose={() => setUpdateStatus(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}"""
if old_toast in src:
    src = src.replace(old_toast, new_toast, 1)
    print("dialog rendered")
else:
    print("TOAST ANCHOR NOT FOUND")

app.write_text(src, encoding="utf-8")
