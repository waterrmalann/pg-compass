# Task: Database ER Diagram

> **Status:** Completed

Show the whole database as an entity-relationship diagram, like Supabase's schema visualizer: every table as a card listing its columns, with a line for each foreign key from the referencing column to the referenced column.

## Requirements

- Opening a database (the schema listing tab) shows two sub-tabs, **Schemas** (the existing list) and **Diagram**, in the same segmented switcher the schema and table viewers use.
- The diagram must stay light on the database: catalog queries only, run once per load, never per table, and never touching table data or relation files.
- It must stay usable on databases with hundreds or thousands of tables and many foreign keys.
- It follows `docs/DESIGN.md`: neutral surfaces, hairline borders, mono identifiers, no decorative colour.

## Plan

### Data (main process)

One new IPC call, `connections:get-schema-diagram`, takes a connection and a list of schemas and returns:

- tables (ordinary and partitioned, without partitions) with their columns: name, formatted type, nullable, primary key, single-column unique;
- foreign keys whose referencing table is in those schemas, with source and target columns in key order.

It runs two `pg_catalog` queries on one pooled client inside a read-only transaction with a short statement timeout. It does not use `information_schema` (slow on big catalogs), row counts or size functions. Partitions and the foreign-key copies PostgreSQL makes for them are left out, so a partitioned table shows once.

### Scope

The diagram loads one schema at a time by default (`public` when it has tables, otherwise the schema with the most tables), with an **All schemas** option. Nothing is queried until the Diagram tab is first opened. After that the tab stays mounted, so switching sub-tabs or workspace tabs keeps the data and the viewport. Refresh in the top bar reloads both the schema list and a loaded diagram.

### Layout

A small built-in layout instead of a graph library (see `docs/decisions/ER_DIAGRAM_ADR.md`):

1. Split tables into connected components by foreign keys.
2. Inside a component, rank tables so referenced tables sit left of the tables that reference them (longest path, back edges of cycles and self-references ignored).
3. Order each rank with a few barycenter sweeps to reduce crossings, then stack it vertically.
4. Pack components into rows, largest first, aiming for a landscape canvas. Tables without relationships end up packed together at the end.

The layout is pure and deterministic, so it is unit tested directly.

### Rendering

- One canvas element, transformed by a single `translate/scale`. Tables are absolutely positioned cards; relationships are one SVG of cubic curves from the foreign-key column to the referenced column.
- Only tables and lines inside the visible area (plus a margin) are rendered, so DOM size follows what is on screen, not the database size.
- Below a zoom threshold cards render only their name, not their column rows.
- Pan by dragging the background, zoom with the wheel toward the pointer, and use the keyboard: arrows pan, `+`/`-` zoom, `0` fits.
- Drag a table by its header to move it; **Reset layout** returns to the computed layout.
- Clicking a table selects it: its relationships are drawn in the foreground colour and unrelated tables dim. Escape clears the selection. Each card has an **Open table** button.
- **Find table** jumps to and selects the first table whose name matches.
- The panel footer shows a legend for the column icons (primary key, foreign key, unique, nullable).

### Tests

- Unit: layout (ranking, no overlaps, cycles and self-references, determinism), edge geometry, viewport maths, IPC validation, preload contract, and the Diagram tab (lazy loading, empty, error and retry, selection, open table).
- Integration (PGlite and PostgreSQL): the catalog query against the seeded database, including partitions, composite and cross-schema foreign keys.
- Playwright: a generated database with hundreds of tables and foreign keys (cycles, self-references, composite and cross-schema keys, partitions), checking the diagram loads, culls off-screen tables, finds and opens a table, and switches to all schemas.

## Implementation Progress

- [x] Main-process catalog query, IPC channel, validation and preload API
- [x] Layout, geometry and viewport helpers
- [x] Diagram canvas, table cards, toolbar and legend
- [x] Schemas / Diagram sub-tabs on the database tab
- [x] Unit, integration and Playwright coverage
- [x] Docs (project context, design notes, coverage matrix, ADR)

## Implementation Notes

- The catalog snapshot for 2,004 tables and 3,196 foreign keys took about 0.3 s on PostgreSQL 16.
- Long chains of foreign keys gave a very wide, flat layout, so a group with many ranks wraps into bands. Chains of up to eight ranks always stay on one band, so small schemas keep a plain left-to-right reading.
- Changing schema used to fit the view to the previous diagram, because the fit ran before the new data arrived. The fit now waits for the loaded scope, and a new scope shows the loading state instead of the old diagram. A unit test and the Playwright spec cover this.
- `format_type` spellings are shortened on cards (`timestamp with time zone` → `timestamptz`). The full type shows on hover.
- Review follow-ups:
  - Unique markers count index key columns only, so `UNIQUE … INCLUDE (…)` still marks its column.
  - Foreign keys a user declares into a partition are kept; only PostgreSQL's per-partition copies are dropped.
  - Cards show the key or unique marker and the foreign-key marker together, so junction-table and one-to-one columns show both.
- Screenshots are in `docs/screenshots/er-diagram`. They are produced by the Playwright spec with `PG_COMPASS_E2E_SCREENSHOT_DIR` set.
