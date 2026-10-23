/**
 * Checking for and installing updates.
 *
 * The updater compares the running version against the release manifest, and
 * an update has to be signed with the private key that matches the public key
 * baked into the build. An unsigned or tampered package is rejected, which is
 * what makes automatic installation safe.
 */

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import { fetchSetting, saveSetting } from "./api";

/** What a check found. */
export type UpdateStatus =
  | { kind: "current"; version: string }
  | { kind: "available"; version: string; notes: string; date: string | null }
  | { kind: "failed"; reason: string };

/** Where releases are published, shown when a check fails. */
export const RELEASES_URL = "https://github.com/ChenRy-1019/lexiflow/releases/latest";

/** Progress while downloading. */
export interface DownloadProgress {
  /** Bytes received so far. */
  downloaded: number;
  /** Total bytes, or 0 when the server did not report a length. */
  total: number;
}

/**
 * Ask the release server whether a newer version exists.
 *
 * `updater` is null when a check was already done and the same handle is
 * reused for the download, so the work is not repeated.
 */
export async function checkForUpdate(): Promise<{
  status: UpdateStatus;
  update: Update | null;
}> {
  try {
    const update = await check();

    if (!update) {
      // No update means the running version is the newest one.
      const { getVersion } = await import("@tauri-apps/api/app");
      const version = await getVersion();
      return { status: { kind: "current", version }, update: null };
    }

    return {
      status: {
        kind: "available",
        version: update.version,
        notes: update.body ?? "",
        date: update.date ?? null,
      },
      update,
    };
  } catch (error) {
    return {
      status: {
        kind: "failed",
        reason: error instanceof Error ? error.message : String(error),
      },
      update: null,
    };
  }
}

/**
 * Download an update and hand it to the installer.
 *
 * The download is staged first and installed afterwards, so a failed download
 * leaves the running application untouched.
 */
export async function downloadAndInstall(
  update: Update,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress?.({ downloaded: 0, total });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, total });
        break;
      case "Finished":
        onProgress?.({ downloaded, total });
        break;
      default:
        break;
    }
  });

  // The installer has replaced the files; a relaunch picks up the new build.
  await relaunch();
}

/** Whether updates are checked when the application starts. */
export async function autoCheckEnabled(): Promise<boolean> {
  const value = await fetchSetting("autoCheckUpdates");
  return value === null ? true : value === "true";
}

/** Remember whether to check on start. */
export async function setAutoCheck(enabled: boolean): Promise<void> {
  await saveSetting("autoCheckUpdates", String(enabled));
}

/** `1.2.3` becomes `[1, 2, 3]`, for comparisons in the interface. */
export function parseVersion(version: string): number[] {
  return (version.match(/\d+/g) ?? []).map(Number);
}
