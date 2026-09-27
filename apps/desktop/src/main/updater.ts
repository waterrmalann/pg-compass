import { app, autoUpdater, BrowserWindow, dialog, net } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  updateElectronApp,
  UpdateSourceType,
  type IUpdateElectronApp,
} from "update-electron-app";
import { GITHUB_REPO_URL } from "../shared/constants/help";
import { UpdateChannels } from "../shared/constants/ipc-channels";
import type { UpdateStatus } from "../shared/types/updates";
import { registerIpcHandler } from "./ipc-security";
import { openAllowedExternalUrl } from "./window-security";

// Update checks. See docs/decisions/AUTO_UPDATE_ADR.md.
//
// Two mechanisms share one setting (privacy.automaticUpdates):
// - A GitHub "latest release" check on every platform drives the in-app banner.
// - On Windows, update-electron-app lets Squirrel download the update in the
//   background so it installs on restart.

const GITHUB_REPO = "waterrmalann/pg-compass";
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
// update-electron-app takes a human-readable interval; the release check takes ms.
const CHECK_INTERVAL = "4 hours";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;

interface LatestRelease {
  version: string;
  url: string;
}

let status: UpdateStatus = { kind: "up-to-date" };
let releaseCheckTimer: ReturnType<typeof setInterval> | null = null;
let squirrelUpdater: IUpdateElectronApp | null = null;

type Version = [major: number, minor: number, patch: number];

function parseVersion(raw: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `candidate` is a higher `x.y.z` version than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const candidateVersion = parseVersion(candidate);
  const currentVersion = parseVersion(current);
  if (!candidateVersion || !currentVersion) {
    return false;
  }

  const [candidateMajor, candidateMinor, candidatePatch] = candidateVersion;
  const [currentMajor, currentMinor, currentPatch] = currentVersion;
  if (candidateMajor !== currentMajor) {
    return candidateMajor > currentMajor;
  }
  if (candidateMinor !== currentMinor) {
    return candidateMinor > currentMinor;
  }
  return candidatePatch > currentPatch;
}

async function fetchLatestRelease(): Promise<LatestRelease> {
  const response = await net.fetch(LATEST_RELEASE_API_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub responded with status ${response.status}.`);
  }

  const body = (await response.json()) as { tag_name?: unknown };
  const tag = body.tag_name;
  if (typeof tag !== "string" || parseVersion(tag) === null) {
    throw new Error("GitHub returned a release without a version tag.");
  }

  return {
    version: tag.replace(/^v/, ""),
    url: `${GITHUB_REPO_URL}/releases/tag/${encodeURIComponent(tag)}`,
  };
}

function setStatus(next: UpdateStatus): void {
  // A downloaded update outranks a release check: keep offering the restart.
  if (status.kind === "ready" && next.kind !== "ready") {
    return;
  }

  status = next;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(UpdateChannels.STATUS_CHANGED, status);
  }
}

async function checkLatestRelease(): Promise<LatestRelease> {
  const latest = await fetchLatestRelease();
  const isNewer = isNewerVersion(latest.version, app.getVersion());

  if (isNewer) {
    setStatus({
      kind: "available",
      version: latest.version,
      releaseUrl: latest.url,
    });
  } else {
    setStatus({ kind: "up-to-date" });
  }
  return latest;
}

function runScheduledReleaseCheck(): void {
  checkLatestRelease().catch((error: Error) => {
    console.warn(`[updates] Release check failed: ${error.message}`);
  });
}

function canInstallUpdatesInPlace(): boolean {
  if (!app.isPackaged || process.platform !== "win32") {
    return false;
  }

  // Only Squirrel installs can update in place. Squirrel puts Update.exe one
  // folder above the app, so a copied or unzipped build has none.
  const squirrelUpdateExe = path.resolve(
    path.dirname(process.execPath),
    "..",
    "Update.exe",
  );
  const isSquirrelInstall = fs.existsSync(squirrelUpdateExe);
  // Squirrel holds a lock during the first run after install, so skip that run.
  const isFirstRun = process.argv.includes("--squirrel-firstrun");
  return isSquirrelInstall && !isFirstRun;
}

function startAutomaticChecks(): void {
  if (releaseCheckTimer !== null) {
    return;
  }

  runScheduledReleaseCheck();
  releaseCheckTimer = setInterval(runScheduledReleaseCheck, CHECK_INTERVAL_MS);

  if (canInstallUpdatesInPlace()) {
    // Each call re-adds update-electron-app's logging listeners. Toggling the
    // setting is rare, so the duplicates are harmless.
    squirrelUpdater = updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: GITHUB_REPO,
      },
      updateInterval: CHECK_INTERVAL,
      // The in-app banner offers the restart instead of a native dialog.
      notifyUser: false,
    });
  }
}

function stopAutomaticChecks(): void {
  if (releaseCheckTimer !== null) {
    clearInterval(releaseCheckTimer);
    releaseCheckTimer = null;
  }

  squirrelUpdater?.stopUpdates();
  squirrelUpdater = null;
}

/** Starts or stops automatic checks to match the user's setting. */
export function applyUpdateSettings(automaticUpdates: boolean): void {
  // Development builds never check on their own. The menu item still works.
  if (!app.isPackaged) {
    return;
  }

  if (automaticUpdates) {
    startAutomaticChecks();
  } else {
    stopAutomaticChecks();
  }
}

async function showMessage(options: Electron.MessageBoxOptions) {
  const window = BrowserWindow.getFocusedWindow();
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return result.response;
}

/** Help → Check for Updates. Runs even when automatic checks are off. */
export async function checkForUpdatesNow(): Promise<void> {
  const currentVersion = app.getVersion();

  let latest: LatestRelease;
  try {
    latest = await checkLatestRelease();
  } catch (error) {
    await showMessage({
      type: "warning",
      message: "Couldn't check for updates.",
      detail: (error as Error).message,
    });
    return;
  }

  if (status.kind === "ready") {
    const response = await showMessage({
      type: "info",
      message: "An update is ready to install.",
      detail: "Restart PG Compass to finish updating.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
    return;
  }

  if (status.kind === "up-to-date") {
    await showMessage({
      type: "info",
      message: "You're on the latest version.",
      detail: `PG Compass ${currentVersion}`,
    });
    return;
  }

  if (squirrelUpdater !== null) {
    autoUpdater.checkForUpdates();
    await showMessage({
      type: "info",
      message: `PG Compass ${latest.version} is available.`,
      detail:
        "It's downloading in the background. PG Compass will offer a restart when it's ready.",
    });
    return;
  }

  const response = await showMessage({
    type: "info",
    message: `PG Compass ${latest.version} is available.`,
    detail: `You're on ${currentVersion}.`,
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    await openAllowedExternalUrl(latest.url);
  }
}

export function registerUpdateHandlers(): void {
  registerIpcHandler(UpdateChannels.GET_STATUS, () => {
    return { success: true, data: status };
  });

  registerIpcHandler(UpdateChannels.INSTALL, () => {
    if (status.kind !== "ready") {
      return { success: false, error: "No update is ready to install." };
    }
    autoUpdater.quitAndInstall();
    return { success: true, data: undefined };
  });

  if (process.platform === "win32") {
    autoUpdater.on("update-downloaded", () => {
      const version = status.kind === "available" ? status.version : null;
      setStatus({ kind: "ready", version });
    });
  }
}
