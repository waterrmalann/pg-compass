# Keyboard Shortcuts

## Overview

Since pgCompass works with a tabbed interface, there are a number of keyboard shortcuts that can be used to quickly navigate between tabs and perform common actions. Users who are familiar with browser shortcuts should be able to use pgCompass without needing to learn a whole new set of shortcuts. Below is a list of the keyboard shortcuts that we will implement in pgCompass:

CTRL + W - Closes current tab
CTRL + Tab - Switches to next tab. Support wrap around (eg. from last tab to first tab)
CTRL + Shift + Tab - Switches to previous tab. Support wrap around (eg. from first tab to last tab)
CTRL + R - Reloads the current tab (already there i think, we may not need to override)
CTRL + F - Focuses on the query editor if exists (eg. table details page). If not, do nothing.

Make sure that you implement the shortcuts in the idiomatically correct way for each platform (eg. CMD instead of CTRL on Mac). You can use Electron's `accelerator` syntax to define the shortcuts in a cross-platform way.

You should also ensure not to cause conflicts with any existing shortcuts in Electron or the underlying OS. For example, CMD + W is a common shortcut for closing windows on Mac, so we should use that instead of CTRL + W on Mac.

> A minor bug to fix while you're at it: Pressing Enter key after entering a query in the query editor (in table details page) does not execute the query.

## Implementation

**Status: Complete**

### Keyboard Shortcuts

| Shortcut | Windows/Linux | macOS | Implementation |
|---|---|---|---|
| Close tab | Ctrl+W | Cmd+W | Electron menu accelerator (`CmdOrCtrl+W`) → IPC → renderer |
| Next tab | Ctrl+Tab | Ctrl+Tab | `before-input-event` in main process → IPC → renderer |
| Previous tab | Ctrl+Shift+Tab | Ctrl+Shift+Tab | `before-input-event` in main process → IPC → renderer |
| Reload | Ctrl+R | Cmd+R | Already handled by Electron's `reload` menu role |
| Focus query editor | Ctrl+F | Cmd+F | Renderer-side `keydown` listener (skips if CodeMirror already focused, so CM's own search still works) |

### Files Changed

- **`src/shared/constants/workspace.ts`** — New IPC channel constants for workspace shortcuts
- **`src/main/app-menu.ts`** — Added `Close Tab` menu item with `CmdOrCtrl+W` accelerator; removed conflicting `close` role
- **`src/main.ts`** — Added `Ctrl+Tab` / `Ctrl+Shift+Tab` handling in `before-input-event`
- **`src/preload.ts`** — Added `workspaceApi` with `onCloseTab`, `onNextTab`, `onPrevTab` IPC listeners
- **`src/electron.d.ts`** — Added `WorkspaceApi` type declaration
- **`src/components/workspace/Workspace.tsx`** — Wired up IPC listeners and `Ctrl+F` keydown handler

### Enter Key Bug Fix

- **`src/components/sql-editor/use-codemirror.ts`** — Single-line Enter keymap now calls `onSubmit` (previously only consumed the event)
- **`src/components/workspace/table-viewer/data-tab.tsx`** — Added `onSubmit` prop to the WHERE clause `SqlEditor` so Enter submits the filter


