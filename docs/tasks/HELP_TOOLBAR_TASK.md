# Toolbar > Help

> **Status: ✅ Completed**

Let's clear out whatever is default in the toolbar "Help" section and add the following items:

- License
- View source on Github
- Suggest a feature
- Report a bug
- About PG Compass
- Check for updates

### License

Opens the "MIT" license in a modal with a scrollable text area. Ensure that the modal follows the design guidelies for modals in PG Compass. Put the license text in a constant string in the codebase and load it into the modal when the user clicks on this item.

### View Source on Github

This item should open the PG Compass repository on GitHub in the user's default web browser. The URL to use is: `https://github.com/waterrmalann/pg-compass`. Put this in a constant string in the codebase and use it when the user clicks on this item.

### Suggest a Feature

This item should open the "New Issue" page of the PG Compass repository on GitHub in the user's default web browser. We will put a template in the issue body to guide users on how to suggest a feature. The URL to use is: `https://github.com/waterrmalann/pg-compass/issues/new?template=feature_request.md`. Put this in a constant string in the codebase and use it when the user clicks on this item.

###  Report a Bug

This item should open the "New Issue" page of the PG Compass repository on GitHub in the user's default web browser. We will put a template in the issue body to guide users on how to report a bug. The URL to use is: `https://github.com/waterrmalann/pg-compass/issues/new?template=bug_report.md`. Put this in a constant string in the codebase and use it when the user clicks on this item.

### About PG Compass

This item should open a modal that displays information about PG Compass, including the version number, a brief description of the application, and links to the website and GitHub repository. Ensure that the modal follows the design guidelines for modals in PG Compass. The version number should be dynamically loaded from the application's metadata.

### Check for Updates

Leave the entry disabled for now, as we will implement the update checking functionality in a later task.

---

## Implementation Notes

- **Custom application menu** defined in `src/main/app-menu.ts` — replaces the default Electron menu with Edit, View, Window, and Help menus (plus macOS app menu).
- **Constants** in `src/shared/constants/help.ts` — all URLs (`GITHUB_REPO_URL`, `FEATURE_REQUEST_URL`, `BUG_REPORT_URL`), IPC channel names (`HelpChannels`), and the `LICENSE_TEXT` constant.
- **License** and **About** menu items send IPC messages (`help:show-license`, `help:show-about`) to the renderer, which opens in-app dialog modals.
- **View Source**, **Suggest a Feature**, **Report a Bug** open external URLs via `shell.openExternal`.
- **Check for Updates** is a disabled menu item (placeholder).
- **Version** is injected at build time via Vite `define` (`__APP_VERSION__` from `package.json`).
- Renderer-side modals: `LicenseDialog` and `AboutDialog` in `src/components/help/`.