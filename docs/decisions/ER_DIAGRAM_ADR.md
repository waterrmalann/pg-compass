# ER Diagram

## Status

Accepted

## Context

The database tab needed an entity-relationship diagram like Supabase's schema visualizer: every table with its columns, and a line for each foreign key. It has to stay light on the database, and it has to stay usable on databases with thousands of tables.

The usual building blocks are a graph library (React Flow, ~150 KB) plus a layout engine (dagre, unmaintained, or ELK, ~1.4 MB). Both are general tools: most of their weight goes to features an ER diagram does not use (custom handles, sub-flows, edge routing options), and neither culls off-screen nodes by default.

## Decision

1. **One catalog snapshot per load.** A single IPC call (`connections:get-schema-diagram`) runs two `pg_catalog` queries in a read-only transaction with a 15 s statement timeout: tables with columns, and foreign keys. It is scoped to the schemas asked for, and nothing is queried until the Diagram tab is opened. No `information_schema`, row counts or size functions are used. Partitions, and the foreign-key copies PostgreSQL creates for them, are left out.
2. **Built-in layout, no layout library.** A small, deterministic layered layout (`schema-diagram/layout.ts`):
   - tables are grouped by foreign keys;
   - referenced tables are ranked left of the tables that reference them (longest path, ignoring cycles);
   - ranks are ordered by barycenter sweeps;
   - tall ranks wrap into columns and long chains wrap into bands;
   - groups are shelf-packed, with unrelated tables in one block.
3. **Built-in canvas, no graph library.** A single CSS-transformed layer holds absolutely positioned table cards and one SVG of relationship lines. Card sizes come from fixed metrics, so lines anchor to column rows without measuring the DOM. Only the tables and lines near the view are rendered, and the render set changes only when the view crosses a 1,024px grid. Below 45% zoom, cards drop their column rows.
4. **One schema by default.** The diagram opens on `public` (or the largest schema), with an All schemas option.

## Rationale

- Two catalog queries return 2,000 tables and 3,000 foreign keys in about 0.3 s on PostgreSQL 16, with no table access, so opening the diagram cannot load the server.
- The model, layout, geometry, viewport and canvas modules total about 1,300 lines and add no dependency. Each piece except the canvas is a set of pure functions with direct unit tests.
- Viewport culling keeps the DOM proportional to what is on screen. In the Electron E2E run (software rendering under Xvfb), a 1,500-table schema is on screen about 2.6 s after the Diagram tab is clicked. That time covers the catalog queries, the layout and the first render. Zoomed in, only nearby tables are in the DOM.

## Consequences

- Layout quality is good for typical schemas but simpler than dagre's: no edge routing around cards, and crossings are reduced but not minimised. Users can drag tables, and Reset layout restores the computed layout.
- Moved positions live in the tab's state only and are not saved between sessions.
- Foreign keys into schemas outside the current scope show as a column marker with a tooltip, not a line.
- Views are not drawn (they have no foreign keys); they remain in the Schemas and schema viewers.
