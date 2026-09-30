# Project Overview

**PG Compass** is a lightweight desktop database viewer for PostgreSQL inspired by the usability and simplicity of MongoDB Compass.

The goal is not to compete with full IDE tools like pgAdmin or DataGrip. Instead, the objective is to provide a **fast, intuitive database exploration tool** that focuses on the most common workflows developers perform when inspecting a database.

The app should feel:

- Fast
- Minimal
- Predictable
- Developer-friendly

The emphasis is **inspection and exploration**, not complex schema design.

---

## Core Philosophies

1. Fast over Feature-Heavy: Focus on core use cases and avoid feature bloat. We only focus on browsing schemas, viewing tables, editing fields, inspecting rows, and running queries. Everything else is secondary.
2. Schema First Navigation: Unlike MongoDB, PostgreSQL has structure. Schemas are first-class citizens and should be clearly visible in the UI.
3. Data exploration first: The primary use case is quickly seeing what's inside a table. The UI should optimize for filtering, sorting, pagination, and searching. Quick edits should also be possible.
4. Zero configuration: The app should work out of the box with minimal setup. Connecting to a database should be as simple as entering a connection string.

## Target Users

Primary users are developers who need a **quick GUI to inspect PostgreSQL data**.

Typical use cases:

- Debugging production issues
- Viewing table contents
- Running ad-hoc queries
- Understanding schema structure
- Inspecting indexes and constraints

---

## Core Features

The GUI is split into 2 main sections:

1. **Sidebar**: Displays connections and database schemas in a tree view.
2. **Main Area**: The main workspace for the rest of the app. This is a tabbed interface where users can open multiple views for tables, query results, and schema inspectors.

### Connection Management

Users can create and store multiple PostgreSQL connections. An URI (or individual fields), a label, and an optional color can be saved for each connection. A connection can be favourited for quick access.

**Connections Listing:**
Connections are available in the sidebar. A "Connect" button is visible on hover, which can be clicked to establish a connection. This connection can now be expanded (it works like an accordion) to show the database schemas. The schemas can be expanded to show the tables which is as far as the sidebar goes.

### Table Listing

Clicking on a schema opens a new tab in the main area with the table listing. Clicking on a table (from this listing or from the sidebar) opens a new tab with the table viewer. The table listing has the following columns: name, storage size, row count, indexes count, and last vaccum time.

### Table Viewer

The table viewer consists of multiple tabs: Data, Structure, Indexes, Constraints, and Query. 

1. **Data:** Shows all the rows in the table with pagination (upto 100 rows per page, can be selected from 25, 50, 75, 100). There is an alternate view where the documents are shown in a card view (which better represents JSONB columns as its natural). Rows can be narrowed with **Filter** (`status = 'active' AND score > 10`), **Project** (`id, name AS label`, or `-notes` to drop a column), **Sort** (`created_at DESC` or `created_at -1`), **Skip** and **Limit**. They use a restricted query language, not raw SQL, that the main process checks against the table's columns and runs with parameters. Projected rows are read-only. Export uses the whole active query and can show its SQL; delete uses only the filter.
2. **Structure:** Shows the table structure with column names, data types, and other metadata.
3. **Indexes:** Shows the indexes on the table with their definitions. It's type and size is also shown. Usage statistics is also shown if available.
4. **Constraints:** Shows the constraints on the table with their definitions.
5. **Query:** Shows a simple SQL editor where users can run queries on the table and preview output in the same way like the data tab (pagination, card view, etc.).

The data view (and the query's data view) supports exporting the data as CSV or JSON.

### Users & Roles

A Users view lets superusers manage roles for the active connection: create, alter, clone, rename and drop roles, manage memberships, set per-database access (no access, read only, read + write), inspect effective permissions, enable or disable triggers, and review a local audit log. Every mutation is refused in Read-only mode. Non-superusers only see their own role. See `docs/decisions/USERS_RBAC_ADR.md`.

### Backup & Restore

The Database Manager can back up a database to a local dump and restore a dump into a database, using `pg_dump`/`pg_restore` from the user's `PATH`. It is optional; the rest of the app needs no client tools. See `docs/decisions/BACKUP_RESTORE_ADR.md`.

### Database Shell

An Open shell button beside Refresh opens a new tab running `psql` for the current connection in an embedded terminal. Each tab is its own session. It needs a local `psql` (found on `PATH`, in the usual install folders, or at a path set in Settings) and the Shell access setting, which is off by default. Turning it off keeps open shell tabs but locks them until it is turned back on. Without `psql`, the button is disabled and its tooltip explains how to install it. In Read-only mode, transactions start read-only. See `docs/decisions/DB_SHELL_ADR.md`.

### Updates

The app checks GitHub for a new release at launch and every few hours. Windows installs download updates in the background and install them on restart. Linux shows a banner that links to the release. Settings → Privacy turns automatic checks off, and Help → Check for Updates still works when they're off. See `docs/decisions/AUTO_UPDATE_ADR.md`.

## Design Principles

1. Minimal UI
2. Instant feedback
3. Fast data loading
4. Clear schema navigation
5. Keyboard-friendly

---

## Non Goals

The following are **out of scope** for v1:

* migrations
* schema editing
* stored procedure management
* live database-to-database sync
* ORM integrations

These belong to full database IDE tools.


## Long-Term Vision

PG Compass should become the **MongoDB Compass equivalent for PostgreSQL**.

A tool developers open when they need to:

> "Quickly inspect a database without fighting the tool."

It should feel fast, focused, and frictionless.