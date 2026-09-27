import { app, BrowserWindow, Menu } from "electron";
import {
  BUG_REPORT_URL,
  FEATURE_REQUEST_URL,
  GITHUB_REPO_URL,
} from "../shared/constants/help";
import {
  HelpChannels,
  WorkspaceChannels,
} from "../shared/constants/ipc-channels";
import { getShortcut } from "../shared/constants/shortcuts";
import { checkForUpdatesNow } from "./updater";
import { openAllowedExternalUrl } from "./window-security";

function sendToFocusedWindow(channel: string) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.webContents.send(channel);
  }
}

export function buildAppMenu(): Menu {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    // On macOS the first menu is the "app" menu (PG Compass)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),

    // Edit menu (for copy/paste/undo/redo support)
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },

    // View menu
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },

    // Window menu
    {
      label: "Window",
      submenu: [
        {
          label: "Close Tab",
          accelerator: getShortcut("close-tab").accelerator,
          click: () => sendToFocusedWindow(WorkspaceChannels.CLOSE_TAB),
        },
        { role: "minimize" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : []),
      ],
    },

    // Help menu
    {
      role: "help",
      submenu: [
        {
          label: "Keyboard Shortcuts",
          click: () => sendToFocusedWindow(HelpChannels.SHOW_SHORTCUTS),
        },
        { type: "separator" },
        {
          label: "License",
          click: () => sendToFocusedWindow(HelpChannels.SHOW_LICENSE),
        },
        { type: "separator" },
        {
          label: "View Source on GitHub",
          click: () => void openAllowedExternalUrl(GITHUB_REPO_URL),
        },
        {
          label: "Suggest a Feature",
          click: () => void openAllowedExternalUrl(FEATURE_REQUEST_URL),
        },
        {
          label: "Report a Bug",
          click: () => void openAllowedExternalUrl(BUG_REPORT_URL),
        },
        { type: "separator" },
        {
          label: "About PG Compass",
          click: () => sendToFocusedWindow(HelpChannels.SHOW_ABOUT),
        },
        {
          label: "Check for Updates…",
          click: () => void checkForUpdatesNow(),
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
