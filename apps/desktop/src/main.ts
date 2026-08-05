import { app, BrowserWindow, Menu, session, type Input } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import started from "electron-squirrel-startup";
import { registerConnectionHandlers } from "./main/connection-ipc";
import { registerSettingsHandlers } from "./main/settings-ipc";
import { registerTableDataHandlers } from "./main/table-data-ipc";
import { registerClipboardHandlers } from "./main/clipboard-ipc";
import { registerRolesHandlers } from "./main/roles-ipc";
import { registerDbSyncHandlers } from "./main/db-sync-ipc";
import { destroyAllPools } from "./main/pg-utils";
import { getSettings } from "./main/settings-store";
import { buildAppMenu } from "./main/app-menu";
import { WorkspaceChannels } from "./shared/constants/ipc-channels";
import { matchesShortcut } from "./shared/constants/shortcuts";
import {
  configureContentSecurityPolicy,
  configureWindowSecurity,
} from "./main/window-security";
import { configureIpcSecurity } from "./main/ipc-security";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

app.commandLine.appendSwitch(
  "disable-features",
  // No Chromecast routing, no Google Translate, no cloud autofill,
  // no media-key interception, no Windows occlusion-check CPU overhead,
  // no BFCache memory overhead (SPA — no navigation history to cache).
  "MediaRouter,TranslateUI,AutofillServerCommunication,HardwareMediaKeyHandling,CalculateNativeWinOcclusion,BackForwardCache",
);
// No auto-updating Chromium components at runtime.
app.commandLine.appendSwitch("disable-component-update");
// No domain reliability telemetry pings.
app.commandLine.appendSwitch("disable-domain-reliability");
// Disables all background network activity: translate, safe-browsing,
// autofill-server, reporting — none of which apply to a local DB tool.
app.commandLine.appendSwitch("disable-background-networking");
// Keep the renderer at full priority when the window is backgrounded.
// Critical for long-running queries the user starts then alt-tabs away from.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
// Prevent JS timer throttling in background windows (same reason as above).
app.commandLine.appendSwitch("disable-background-timer-throttling");
// Skip Chromium first-run initialization tasks.
app.commandLine.appendSwitch("no-first-run");
// No Chrome profile sync.
app.commandLine.appendSwitch("disable-sync");

// Cache settings to avoid reading from disk on every keystroke.
let cachedSettings = getSettings();

const rendererUrl =
  MAIN_WINDOW_VITE_DEV_SERVER_URL ??
  pathToFileURL(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
  ).toString();
configureIpcSecurity(rendererUrl);

// Register IPC handlers before window creation.
registerConnectionHandlers();
registerTableDataHandlers();
registerClipboardHandlers();
registerRolesHandlers();
registerDbSyncHandlers();
registerSettingsHandlers((settings) => {
  cachedSettings = settings;
  if (!settings.general.enableDevTools) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.isDevToolsOpened()) {
        window.webContents.closeDevTools();
      }
    }
  }
});

function isDevToolsShortcut(input: Input): boolean {
  const key = input.key.toLowerCase();

  if (process.platform === "darwin") {
    return input.meta && input.alt && key === "i";
  }

  return input.control && input.shift && key === "i";
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, "../../resources/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });

  configureWindowSecurity(mainWindow);
  mainWindow.webContents.on("console-message", (details) => {
    if (details.message === "[pg-compass] renderer-mounted") {
      console.info(details.message);
    }
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (isDevToolsShortcut(input)) {
      event.preventDefault();
      const devToolsEnabled = cachedSettings.general.enableDevTools;

      if (!devToolsEnabled) {
        return;
      }

      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: "detach" });
      }
      return;
    }

    const shortcutInput = {
      key: input.key,
      ctrlKey: input.control,
      metaKey: input.meta,
      shiftKey: input.shift,
    };
    const shortcutPlatform = process.platform === "darwin" ? "mac" : "windows";
    const nextTab = matchesShortcut(
      "next-tab",
      shortcutInput,
      shortcutPlatform,
    );
    const previousTab = matchesShortcut(
      "previous-tab",
      shortcutInput,
      shortcutPlatform,
    );
    if (input.type === "keyDown" && (nextTab || previousTab)) {
      event.preventDefault();
      const channel = previousTab
        ? WorkspaceChannels.PREV_TAB
        : WorkspaceChannels.NEXT_TAB;
      mainWindow.webContents.send(channel);
    }
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  configureContentSecurityPolicy(
    session.defaultSession,
    MAIN_WINDOW_VITE_DEV_SERVER_URL,
  );
  Menu.setApplicationMenu(buildAppMenu());
  createWindow();
});

app.on("will-quit", () => {
  destroyAllPools();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
