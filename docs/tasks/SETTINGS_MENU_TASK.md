# Settings Menu

We need a settings menu for the app to allow users to configure app-wide preferences, which are persisted using `electron-store`.

Add a "cog" icon in the sidebar header (besides the title "PG Compass") that opens a settings modal when clicked. Ensure that the modal follows the design system (and supports dark/light modes) and is implemented using idiomatic shadcn/ui.

The settings modal will have a 2-part layout:

- Sidebar on the left with different settings categories
  1. General
  2. Appearance
  3. Privacy
- Main content area on the right that shows the settings for the selected category.

> [!NOTE]
> For toggles, show the name and a description for each setting. The state of the toggles should be persisted using `electron-store` so that user preferences are saved across app restarts.

## General Settings

**Set Read-Only Mode:**

Limit PG-Compass strictly to read operations, with all write and delete capabilities disabled.

We do not need to implement the actual read-only mode for now. We will tackle this at a later stage, we just expose the toggle for the user to enable or disable read-only mode. By default, this will be turned off.

**Enable shell access:**

Allow users to open a terminal directly connected to their PostgreSQL database for advanced operations.

We do not need to implement the actual shell access for now. We will tackle this at a later stage, we just expose the toggle for the user to enable or disable shell access. By default, this will be turned off.

**Enable DevTools:**

Allow users to toggle the Electron DevTools for debugging purposes.

This will be a simple toggle that enables or disables the Electron DevTools. When enabled, users can open the DevTools using a keyboard shortcut (e.g., `Ctrl+Shift+I` on Windows/Linux or `Cmd+Option+I` on macOS) to inspect the app's internals, debug issues, and view console logs. By default, this will be turned on.

**Hide Internal Schemas:**

Toggle the visibility of internal PostgreSQL schemas (like `pg_catalog`, `information_schema`, etc.) across the app.

Currently, when we connect to a database and load schemas, we also load the internal schemas like `pg_temp`, `pg_toast`, `pg_catalog`, and `information_schema`. These are not relevant for most users and add noise to the sidebar. We should filter these out and only show user-created schemas by default. But we should also provide an option in the settings menu to toggle the visibility of these internal schemas for power users who might want to see them. By default, we'll keep it turned off.

## Appearance Settings

**Theme Selection:**

Show a tabbed (big boxes with skeleton previews) interface to select between Light, Dark, and System themes.

We already have a theme system which forces dark mode. With this toggle, we make it configurable so that users can select their preferred theme. The "System" option will follow the OS-level theme preference, while "Light" and "Dark" will force the app into the respective themes regardless of the OS setting. Dark mode is already well-implemented, but ensure that white mode is also polished and visually appealing.

## Privacy

**Enable automatic updates:**

Allow PG-Compass to automatically check for and install updates.

We do not need to implement the update mechanism for now. We will tackle this at a later stage, we just expose the toggle for the user to enable or disable automatic updates. By default, this will be turned on.

## Implementation Progress (2026-03-09)

- [x] Added a settings entrypoint in the sidebar header using a cog icon button next to "PG Compass".
- [x] Implemented a shadcn-style settings modal with a 2-part layout:
  - [x] Left category navigation: General, Appearance, Privacy.
  - [x] Right content panel for category-specific settings.
- [x] Added persisted app settings storage using `electron-store` (separate settings store file).
- [x] Added settings IPC API (`get`, `update`) and preload bridge (`window.settingsApi`).
- [x] Implemented all scoped toggles with persistence:
  - [x] `General.readOnlyMode` (default `false`, UI-only for now)
  - [x] `General.shellAccess` (default `false`, gates the database shell; see `DB_SHELL_TASK.md`)
  - [x] `General.enableDevTools` (default `true`, behavior wired)
  - [x] `General.hideInternalSchemas` (default `true`, behavior wired)
  - [x] `Privacy.automaticUpdates` (default `true`, UI-only for now)
- [x] Implemented Appearance theme selection cards for `Light`, `Dark`, and `System`, persisted via settings.
- [x] Replaced hardcoded dark mode with settings-driven theme application at document root.
- [x] Wired `Enable DevTools` behavior:
  - [x] `Ctrl+Shift+I` (Windows/Linux) and `Cmd+Option+I` (macOS) are now gated by settings.
  - [x] DevTools closes automatically when the setting is turned off.
- [x] Wired `Hide Internal Schemas` behavior:
  - [x] Internal schemas are hidden by default.
  - [x] Schema tree query supports including internal schemas when toggle is disabled.
  - [x] Expanded/connected sidebar tree refreshes after this setting changes.

## Deferred (Intentionally Out of Scope)

- Read-only enforcement logic across write/delete surfaces.
- Auto-update mechanism (checking/downloading/installing updates).
