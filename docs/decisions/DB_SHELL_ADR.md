# Database Shell ADR

## Description

Developers often drop to `psql` for things a GUI does poorly: `\d` describes, `COPY`, `EXPLAIN`, quick multi-statement scripts. PG Compass already holds the connection details, so it should open that shell for them instead of making them rebuild a connection string in a separate terminal.

## Decision

- **Run the real `psql` in a pseudo-terminal.** The main process spawns `psql` from the user's `PATH` with `node-pty`. A renderer-side **xterm.js** terminal (with the fit and search addons) renders its output and sends keystrokes back over IPC (`shellApi`, channels prefixed `shell:*`). We do not reimplement history, completion, multiline editing, the pager or ANSI handling.
- **An Open shell button sits beside Refresh** in every connection-scoped top bar. Each click opens a new workspace tab (`shell` view) with its own session. Closing the tab, reloading the window or quitting the app kills its `psql`.
- **Shell access is opt-in.** The existing `general.shellAccess` setting (off by default) gates it. The main process refuses to start a shell while it is off. The button explains this and offers to turn it on, because `psql` can also run local commands with `\!`.
- **Connections are resolved like backup and restore.** `psql` gets the same `--dbname` conninfo and `PGPASSWORD`/`PGSSL*` environment as `pg_dump` (`resolvePgToolTarget`), so secrets never appear in process arguments. SSH-tunnelled connections are refused.
- **Read-only mode is a session default.** With Read-only mode on, `psql` starts with `PGOPTIONS=-c default_transaction_read_only=on`, and the shell header says "Read-only by default". A user can still `SET default_transaction_read_only = off`; a raw SQL shell cannot enforce more without a read-only role.
- **The terminal follows the design tokens.** Colours are resolved from the Quiet Utility CSS variables (card surface, foreground text, status hues for ANSI red/green/yellow/blue) and update with the theme. Text is Geist Mono at 12.5px.

## Rationale

The real CLI is the most faithful shell there is, and embedding it keeps our code to process and IPC plumbing. This is the same approach VS Code's integrated terminal takes (xterm.js + node-pty).

## Status

Accepted (2026-09-29).

## Consequences

- The shell needs `psql` on `PATH` (like backup and restore need `pg_dump`). The rest of the app stays zero-configuration. macOS apps launched from Finder see a minimal `PATH`, so Homebrew-only installs may not be found.
- `node-pty` is a native module. It ships prebuilt binaries for Windows and macOS and compiles on Linux at package time. It is N-API based, so it needs no Electron-specific rebuild. It is unpacked from the asar archive.
- Output is psql's native text format. Structured rendering (for example from `\pset format json`) is a possible later enhancement.
- On Windows and Linux, `Ctrl+W` is the app's Close tab shortcut, so it closes the shell tab instead of deleting a word in `psql`.
