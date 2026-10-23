"""Add the update section to the settings page."""

from pathlib import Path

path = Path("src/pages/SettingsPage.tsx")
src = path.read_text(encoding="utf-8")

old = """interface SettingsPageProps {
  onReset: () => void;
  notify: (message: string) => void;
}"""

new = """interface SettingsPageProps {
  onReset: () => void;
  notify: (message: string) => void;
  /** Check the release server and show the result in a dialog. */
  onCheckUpdate?: () => void;
}"""

if old in src:
    src = src.replace(old, new, 1)
    print("props extended")
else:
    print("PROPS ANCHOR NOT FOUND")

old_sig = "export default function SettingsPage({ onReset, notify }: SettingsPageProps) {"
new_sig = "export default function SettingsPage({ onReset, notify, onCheckUpdate }: SettingsPageProps) {"
if old_sig in src:
    src = src.replace(old_sig, new_sig, 1)
    print("signature updated")
else:
    print("SIGNATURE ANCHOR NOT FOUND")

old_state = '  const [autoSpeak, setAutoSpeak] = useState("true");'
new_state = ('  const [autoSpeak, setAutoSpeak] = useState("true");\n'
             '  const [typingSound, setTypingSound] = useState("true");\n'
             '  const [autoUpdate, setAutoUpdate] = useState("true");\n'
             '  const [appVersion, setAppVersion] = useState("");')
if old_state in src:
    src = src.replace(old_state, new_state, 1)
    print("state added")
else:
    print("STATE ANCHOR NOT FOUND")

old_load = """    void fetchSetting("autoSpeak").then((value) => {
      if (value !== null) setAutoSpeak(value);
    });
    void refreshCache();"""

new_load = """    void fetchSetting("autoSpeak").then((value) => {
      if (value !== null) setAutoSpeak(value);
    });
    void fetchSetting("typingSound").then((value) => {
      if (value !== null) setTypingSound(value);
    });
    void fetchSetting("autoCheckUpdates").then((value) => {
      if (value !== null) setAutoUpdate(value);
    });
    void fetchCurrentVersion().then(setAppVersion);
    void refreshCache();"""

if old_load in src:
    src = src.replace(old_load, new_load, 1)
    print("load wired")
else:
    print("LOAD ANCHOR NOT FOUND")

# The version comes from the running binary, not from the frontend bundle.
old_imports = 'import {\n  clearAudioCache,'
new_imports = 'import { getVersion } from "@tauri-apps/api/app";\n\nimport {\n  clearAudioCache,'
if old_imports in src:
    src = src.replace(old_imports, new_imports, 1)
    print("version import added")
else:
    print("IMPORTS ANCHOR NOT FOUND")

old_helper = """  /** Persist a preference. */"""
new_helper = """  /** Read the version of the running application. */
  async function fetchCurrentVersion(): Promise<string> {
    try {
      return await getVersion();
    } catch {
      return "";
    }
  }

  /** Persist a preference. */"""
if old_helper in src:
    src = src.replace(old_helper, new_helper, 1)
    print("helper added")
else:
    print("HELPER ANCHOR NOT FOUND")

path.write_text(src, encoding="utf-8")
