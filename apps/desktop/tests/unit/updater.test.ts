import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateChannels } from "@/shared/constants/ipc-channels";

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => "1.2.0" },
  handle: vi.fn(),
  autoUpdaterOn: vi.fn(),
  quitAndInstall: vi.fn(),
  checkForUpdates: vi.fn(),
  send: vi.fn(),
  showMessageBox: vi.fn(),
  fetch: vi.fn(),
  openExternal: vi.fn(),
  updateElectronApp: vi.fn(),
  stopUpdates: vi.fn(),
}));

vi.mock("electron", () => ({
  app: mocks.app,
  ipcMain: { handle: mocks.handle },
  autoUpdater: {
    on: mocks.autoUpdaterOn,
    quitAndInstall: mocks.quitAndInstall,
    checkForUpdates: mocks.checkForUpdates,
  },
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: mocks.send } }],
    getFocusedWindow: () => null,
  },
  dialog: { showMessageBox: mocks.showMessageBox },
  net: { fetch: mocks.fetch },
  shell: { openExternal: mocks.openExternal },
}));

vi.mock("update-electron-app", () => ({
  UpdateSourceType: { ElectronPublicUpdateService: 0, StaticStorage: 1 },
  updateElectronApp: mocks.updateElectronApp,
}));

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform });
}

function respondWithRelease(tag: string) {
  mocks.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ tag_name: tag }),
  });
}

async function loadUpdater() {
  const { configureIpcSecurity } = await import("@/main/ipc-security");
  configureIpcSecurity("file:///app/index.html");
  return import("@/main/updater");
}

function getHandler(channel: string) {
  const mainFrame = { url: "file:///app/index.html" };
  const event = { senderFrame: mainFrame, sender: { mainFrame } };
  const registration = mocks.handle.mock.calls.find(
    ([registered]) => registered === channel,
  );
  const handler = registration?.[1] as (event: unknown) => unknown;
  return () => handler(event);
}

function lastBroadcastStatus() {
  const statusCalls = mocks.send.mock.calls.filter(
    ([channel]) => channel === UpdateChannels.STATUS_CHANGED,
  );
  return statusCalls.at(-1)?.[1];
}

describe("updater", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    for (const mock of Object.values(mocks)) {
      if (typeof mock === "function") mock.mockReset();
    }
    mocks.app.isPackaged = true;
    mocks.updateElectronApp.mockReturnValue({ stopUpdates: mocks.stopUpdates });
    mocks.showMessageBox.mockResolvedValue({ response: 1 });
    setPlatform("linux");
    respondWithRelease("v1.2.0");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setPlatform(originalPlatform);
  });

  it("compares x.y.z versions", async () => {
    const { isNewerVersion } = await loadUpdater();

    expect(isNewerVersion("v1.2.1", "1.2.0")).toBe(true);
    expect(isNewerVersion("1.10.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.99.99")).toBe(true);
    expect(isNewerVersion("1.2.0", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.1.9", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.3.0-beta.1", "1.2.0")).toBe(false);
  });

  it("never checks on its own in development builds", async () => {
    mocks.app.isPackaged = false;
    const { applyUpdateSettings } = await loadUpdater();

    applyUpdateSettings(true);

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.updateElectronApp).not.toHaveBeenCalled();
  });

  it("checks GitHub at launch and every four hours until turned off", async () => {
    respondWithRelease("v1.3.0");
    const { applyUpdateSettings } = await loadUpdater();

    applyUpdateSettings(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.updateElectronApp).not.toHaveBeenCalled();
    expect(lastBroadcastStatus()).toEqual({
      kind: "available",
      version: "1.3.0",
      releaseUrl:
        "https://github.com/waterrmalann/pg-compass/releases/tag/v1.3.0",
    });

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);

    applyUpdateSettings(false);
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("hands Windows downloads to update-electron-app and stops it when turned off", async () => {
    setPlatform("win32");
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const { applyUpdateSettings } = await loadUpdater();

    applyUpdateSettings(true);

    expect(mocks.updateElectronApp).toHaveBeenCalledWith(
      expect.objectContaining({
        updateSource: { type: 0, repo: "waterrmalann/pg-compass" },
        updateInterval: "4 hours",
        notifyUser: false,
      }),
    );

    applyUpdateSettings(false);
    expect(mocks.stopUpdates).toHaveBeenCalled();
  });

  it("leaves Windows builds without Squirrel to the release check", async () => {
    setPlatform("win32");
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const { applyUpdateSettings } = await loadUpdater();

    applyUpdateSettings(true);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.updateElectronApp).not.toHaveBeenCalled();
  });

  it("offers a restart only once Squirrel has downloaded the update", async () => {
    setPlatform("win32");
    const { registerUpdateHandlers } = await loadUpdater();
    registerUpdateHandlers();
    const install = getHandler(UpdateChannels.INSTALL);

    expect(install()).toEqual({
      success: false,
      error: "No update is ready to install.",
    });

    const downloaded = mocks.autoUpdaterOn.mock.calls.find(
      ([event]) => event === "update-downloaded",
    )?.[1] as () => void;
    downloaded();

    expect(lastBroadcastStatus()).toEqual({ kind: "ready", version: null });
    expect(install()).toEqual({ success: true, data: undefined });
    expect(mocks.quitAndInstall).toHaveBeenCalled();
  });

  it("reports an up-to-date app from the menu check", async () => {
    const { checkForUpdatesNow } = await loadUpdater();

    await checkForUpdatesNow();

    expect(mocks.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ message: "You're on the latest version." }),
    );
  });

  it("opens the release page when the user downloads from the menu check", async () => {
    respondWithRelease("v1.4.0");
    mocks.showMessageBox.mockResolvedValue({ response: 0 });
    const { checkForUpdatesNow } = await loadUpdater();

    await checkForUpdatesNow();

    expect(mocks.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ message: "PG Compass 1.4.0 is available." }),
    );
    expect(mocks.openExternal).toHaveBeenCalledWith(
      "https://github.com/waterrmalann/pg-compass/releases/tag/v1.4.0",
    );
  });

  it("explains a failed menu check", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 403 });
    const { checkForUpdatesNow } = await loadUpdater();

    await checkForUpdatesNow();

    expect(mocks.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Couldn't check for updates.",
        detail: "GitHub responded with status 403.",
      }),
    );
  });
});
