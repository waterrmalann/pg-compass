# New Features

This document explains the changes introduced on top of `c2d47e6` (RBAC/users
management), grouped by area. It's written for reviewers of the upstream PR —
each section says what changed and why.

> **Note on scope:** `docs/PROJECT_CONTEXT.md` lists *database backups* as
> out of scope for v1. This PR extends the existing Database Manager's
> backup/restore flow (already present on `main` before this PR) rather than
> introducing it from scratch, but it's worth flagging for maintainer
> discussion since it touches a documented non-goal.

## Connections

### Paste from `.env`

A "Paste from .env" button now sits next to the connection-mode toggle in the
connection form. It opens a small dialog where you paste a raw `.env` block —
`POSTGRES_HOST`, `PGPORT`, `DATABASE_URL`, etc. — and the matching fields (or
a full connection URI, or an inline SSL CA cert) get filled in automatically.
Recognizes common aliases per field (e.g. `POSTGRES_DB` / `PGDATABASE` /
`DB_NAME` all map to "database"), so it works with most frameworks' default
env-var naming without configuration.

## Database Manager

### Backup list: inspect and delete

Each saved backup now records metadata alongside the `.dump` file (source
connection label, database name, creation timestamp) instead of only a raw
filename and mtime.

The backups list is now expandable per entry — clicking a backup reveals:

- when it was taken and which connection/database it came from
- object counts (schemas, tables, views, sequences, functions) read directly
  from the dump's own table of contents via `pg_restore --list`, so no
  separate scan or the source database is needed
- a delete action (with confirmation) that removes the dump and its metadata
  file from disk

### Removed the live Database Sync tab

The "Database Syncing" tab (row-level two-way sync between two live
databases) has been removed from the Database Manager, along with its
Settings toggle ("Show Production Databases in Database Sync"). Only **Back
Up** and **Restore** remain.

## Roles & Permissions (RBAC)

### Simplified role creation

The "Create role" dialog has been trimmed down:

- Dropped the `Create role` / `Create database` attribute toggles and the
  "member of" role picker — these added surface area without matching how
  people actually create a role or user day to day; memberships are still
  assignable afterward from the Roles tab.
- Password field is now hidden until `Login` is enabled (a role without
  login can't authenticate anyway), and includes a generate + copy option.
- Retitled to match Postgres's own mental model: a role without `Login` is a
  role; with `Login` enabled, it's a user.

### Predefined roles hidden by default

Postgres ships a fixed set of `pg_*` predefined roles (`pg_monitor`,
`pg_checkpoint`, etc.) in every cluster. These cluttered the Roles list and
the membership-grant table. They're now hidden by default across the RBAC
pane, tied to the existing Settings → General → **Hide Internal Schemas**
toggle — turning that off shows them again.

The membership-grant table (`Roles` tab on a role's detail view) also no
longer lists other login users as grantable — only actual group roles, since
granting membership in another user account isn't a meaningful action.

### Trigger enable/disable

Triggers previously only supported creation and dropping. This adds:

- a per-trigger enable/disable toggle (`ALTER TABLE ... ENABLE/DISABLE
  TRIGGER`)
- a top-level toggle that flips every listed trigger at once

The delete/drop-trigger action and the trigger/trigger-function creation
dialogs have been removed from this pane — it's now a focused
enable/disable management view rather than a full CRUD surface.

### Scroll area fixes

Fixed a `ScrollArea` bug where lists without a flex-based definite height
(e.g. the Effective Permissions tab's readable/writable table lists) would
grow past their intended bounds and visually overlap the section below
instead of clipping and scrolling. Also added optional horizontal-scroll
support for lists with long, unwrappable content (e.g. `schema.table`
names).

## Workspace

### Close All Tabs

Right-clicking a workspace tab now opens a context menu with **Close** and
**Close All Tabs**, instead of only being able to close one tab at a time via
its `×` button.
