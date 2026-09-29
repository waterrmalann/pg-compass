# DB Shell Task

## Goal

An Open shell button beside Refresh opens a new tab with a working `psql` session for the current connection, rendered in an embedded terminal. See `docs/decisions/DB_SHELL_ADR.md`.

## Status

Done.

- [x] `psql` runs in a pseudo-terminal (`node-pty`) in the main process, bridged over a `shellApi` preload bridge.
- [x] xterm.js terminal with the fit (auto-resize) and search addons, themed from the design tokens and following theme changes.
- [x] Open shell button in every connection-scoped top bar; every click opens an independent shell tab.
- [x] Sessions are killed when their tab closes, the window reloads or the app quits.
- [x] Gated by the Shell access setting, enforced in the main process. The button offers to turn it on.
- [x] Read-only mode starts `psql` with read-only transactions by default.
- [x] Copy and paste: platform clipboard shortcuts; on Windows and Linux Ctrl+C copies a selection and otherwise interrupts `psql`.
- [x] Find bar (Ctrl/⌘+F), Restart after exit, clear errors for a missing `psql` or an SSH-tunnelled connection.
- [x] Packaging: `node-pty` is installed in the packaged app and unpacked from the asar archive.

## Not done

- Structured (JSON) result rendering.
- An SSH tunnel for the shell.
