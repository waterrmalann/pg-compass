# Edit Functionality: Phase 1 - Inline Writes

**Status:** Implemented (2026-04-20)
**Relevance:** Table data cells in both Table View and Card View, from the Data tab (Query tab stays read-only in Phase 1 — see Non-Goals).

## Requirement

It's time we implement write functionality. Like the goal of this project, writes are meant to be simple and not so in your face.

Double clicking on the column entry should open a text box where we can edit the data inline and set it as whatever. But the type must be validated before sending it to the db. Ensure types like JSONB have proper edit functionality. Types like PostGIS should open a modal with map-specific editing functionality.

This should work in both card view and table view.

> [!IMPORTANT]
> Edit functionality should be completely absent completely if we have it in read only mode in the settings. No sign of it should be there. Ensure tests enforce this.

## Tests

We've got to ensure we have enough test harness prior to implementation. All edge cases must be carefully thought about and covered. Both unit tests and end to end tests are required. Ensure pglite and real db are used, see testing setup in the project.

---

## Plan

### Guiding principles

1. **Low-friction UX.** Double-click commits users to the edit path immediately — no inspector, no menu, no mode toggle. Enter saves, Escape cancels, blur saves. One click away from getting out.
2. **Two-layer read-only enforcement.** The UI renders zero edit affordances when `readOnlyMode` is on, AND the main-process IPC handler rejects any write even if one slipped through. Tests assert both layers independently.
3. **Type-aware, not stringly-typed.** Each Postgres type gets a dedicated editor contributed through the same registry that already drives display renderers. The editor owns parsing, validation, and serialization.
4. **Row identity is explicit.** A cell update requires primary-key columns and values. Tables without a PK are non-editable in Phase 1 (flagged, not hacked around with `ctid`).
5. **Thin blast radius.** One cell, one column, one row at a time. No bulk edits, no row-add, no row-delete in Phase 1.

### Non-Goals (Phase 1)

- Editing results from the Query tab (needs FROM/JOIN resolution — Phase 2).
- Editing cells on views (even updatable views — Phase 2).
- Editing rows on tables without a primary key (Phase 2 will consider `ctid` with a warning).
- Bulk edits, paste-multiple-cells, row insertion, row deletion.
- Dirty-buffer / staged-commit flow. Every edit is an autonomous `UPDATE`.
- Full map-drawing editor for polygons/lines in PostGIS (Phase 1 does Points + WKT textarea only).
- Editing composite types, domain types, enum-text mismatch repair, range types.
- Undo/redo stack. The DB is the source of truth; a toast with an "Undo" action that reverts by re-running the prior value is Phase 2.

---

### Architecture

#### 1. Row identity — PK resolution

**File:** [apps/desktop/src/main/table-data-rows.ts](apps/desktop/src/main/table-data-rows.ts), [apps/desktop/src/shared/types/table-data.ts](apps/desktop/src/shared/types/table-data.ts)

- Extend `TableRowsResult` with `primaryKey: string[] | null` (`null` when the relation has no PK or is a view).
- In `getRows`, when `params` targets a real table, run an extra small query (`pg_index`/`pg_attribute` for `indisprimary`) to collect PK column names. Cache per (connectionId, schema, table) for the session (in-memory `Map`, invalidated on connection pool destroy).
- If the relation is a view or has no PK, return `primaryKey: null`. The renderer will not offer editing.

```ts
// shared/types/table-data.ts
export interface TableRowsResult {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  totalCount: number;
  primaryKey: string[] | null; // NEW
}
```

#### 2. Settings — plumb readOnlyMode to renderer

**File:** [apps/desktop/src/hooks/use-settings.tsx](apps/desktop/src/hooks/use-settings.tsx), [apps/desktop/src/components/settings/SettingsDialog.tsx](apps/desktop/src/components/settings/SettingsDialog.tsx)

- The `readOnlyMode` field already exists (default `false`); UI copy currently says "coming soon" — remove that caveat as part of this change.
- Renderer consumers use `useSettings().settings.general.readOnlyMode` to gate the entire edit subsystem.
- The main process reads `getSettings()` inside the write IPC handler for belt-and-suspenders enforcement (see §5).

#### 3. Edit registry — type-aware editors

**File:** `apps/desktop/src/components/workspace/renderers/edit-registry.ts` (new), sibling to [type-registry.ts](apps/desktop/src/components/workspace/renderers/type-registry.ts)

Parallel registry to the display registry. Keeping them separate (rather than adding optional methods to `TypeRenderer`) preserves the Strategy pattern and means a missing editor is a type we've not yet made editable, not a broken renderer.

```ts
export interface EditResult {
  /** The JS value to send to the main process. Already validated. */
  value: unknown;
  /** Explicit cast fragment to apply in the UPDATE (e.g. "jsonb", "int4"). */
  pgCast: string;
}

export type EditValidation =
  | { ok: true; result: EditResult }
  | { ok: false; error: string };

export interface TypeEditor {
  /** Editor kind — drives which UI the cell mounts. */
  kind: "inline" | "modal";
  /** Serialize DB value to the string the editor starts with. */
  toInput(value: unknown): string;
  /** Parse + validate editor output. */
  validate(raw: string): EditValidation;
  /**
   * Optional custom React component for modal editors (PostGIS, later JSONB
   * tree editor). When absent, the cell uses a standard inline <Input>.
   */
  Component?: React.ComponentType<TypeEditorProps>;
}
```

Built-in editors registered at startup (mirrors `registerDefaultRenderers()`):

| PG type(s)                                                   | Editor                                             | Validation                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `text`, `varchar`, `char`, `bpchar`, `name`, `citext`, `xml` | inline text                                        | (none; empty string is stored as empty string — NULL is a separate affordance) |
| `int2`, `int4`, `int8`                                       | inline text                                        | integer regex, range check per type                                            |
| `float4`, `float8`, `numeric`, `money`                       | inline text                                        | finite number parse                                                            |
| `bool`                                                       | inline select (true / false)                       | exact match                                                                    |
| `date`, `time`, `timetz`, `timestamp`, `timestamptz`         | inline text                                        | ISO-8601 parse; server casts the string (Postgres is the authoritative parser) |
| `uuid`                                                       | inline text                                        | UUID regex                                                                     |
| `json`, `jsonb`                                              | modal (textarea with monospace, JSON pretty-print) | `JSON.parse` before submit                                                     |
| `_int4`, `_text`, … (array types)                            | modal (textarea)                                   | must parse as JSON array of matching primitive                                 |
| `geometry`, `geography`                                      | **modal with map**                                 | see §4                                                                         |
| `vector`                                                     | modal (textarea)                                   | must parse as `[n, n, …]` of finite numbers                                    |
| `interval`                                                   | inline text                                        | pass through; server validates                                                 |
| unknown / fallback                                           | inline text                                        | pass through as text                                                           |

**Null handling.** Cell editor has an always-available "Set NULL" affordance (small button inside the popover / a keyboard shortcut — `Ctrl+Del` on the editor). Empty string ≠ NULL — we do not coerce. NOT NULL columns surface a post-submit error from the DB, not a pre-flight block (simpler, and honest).

**The registry is also where read-only gating lives for rendering.** The cell wrapper checks:

- `readOnlyMode === false`
- `primaryKey !== null`
- `editRegistry.has(col.dataType)` (unknown types fall back to text editor; still editable)

If any of those fails, no double-click handler is bound, no edit icon is shown, no edit-capable DOM node is emitted.

#### 4. PostGIS modal editor

**File:** `apps/desktop/src/components/workspace/renderers/postgis-editor.tsx` (new)

Phase 1 scope — opens a dialog with three regions:

1. **Map preview.** Embed a small Leaflet map (already in bundle? if not, use an `<iframe>` on OpenStreetMap embed for read, and click-to-place pin for Points). Decision: use Leaflet + `react-leaflet` — it's the standard, small enough, and gives us click-to-place for Points + visualize-only for other geoms.
2. **Structured input.** For Points (geomType 1), two numeric fields: longitude, latitude, plus an SRID input (default 4326). The map pin and these fields are two-way bound.
3. **WKT/EWKT textarea.** Authoritative fallback. Any geometry the map can't draw (MultiPolygon, GeometryCollection) is edited here. On save, we send WKT to the server with `ST_GeomFromEWKT($1)`.

Save flow: validate WKT is non-empty → main process wraps in `ST_GeomFromEWKT` cast. If the server rejects, the error toast surfaces the Postgres message verbatim.

#### 5. Main process — UPDATE path

**File:** `apps/desktop/src/main/table-data-write.ts` (new) — sibling to `table-data-rows.ts` / `table-data-export.ts` to keep the file-split discipline from commit `d234aea`.

```ts
// shared/types/table-data.ts — NEW
export interface UpdateCellParams {
  connectionId: string;
  schema: string;
  table: string;
  pkColumns: string[];
  pkValues: unknown[];
  column: string;
  pgCast: string;        // 'jsonb', 'int4', 'geometry', …
  newValue: unknown;     // JS value; pg driver parameterizes it
  setNull: boolean;      // if true, newValue is ignored and we SET col = NULL
}

export interface UpdateCellResult {
  /** Full row after update, re-typed through buildTypeMap. */
  row: Record<string, unknown>;
}

export const TableDataChannels = {
  …,
  UPDATE_CELL: 'table-data:update-cell', // NEW
};
```

Handler logic (main/table-data-write.ts):

```ts
export async function updateCell(
  params: UpdateCellParams,
): Promise<UpdateCellResult> {
  // Layer 2 read-only enforcement — never trust the renderer.
  if (getSettings().general.readOnlyMode) {
    throw new Error("Read-only mode is enabled.");
  }
  if (params.pkColumns.length === 0) {
    throw new Error("Cannot update a row without a primary key.");
  }

  return withPoolClient(params.connectionId, async (client) => {
    const qualifiedTable = `${quoteIdent(params.schema)}.${quoteIdent(params.table)}`;
    const setClause = params.setNull
      ? `${quoteIdent(params.column)} = NULL`
      : `${quoteIdent(params.column)} = $1::${safePgCast(params.pgCast)}`;

    const whereParts = params.pkColumns.map(
      (col, i) => `${quoteIdent(col)} = $${i + (params.setNull ? 1 : 2)}`,
    );

    const sql = `
      UPDATE ${qualifiedTable}
      SET ${setClause}
      WHERE ${whereParts.join(" AND ")}
      RETURNING *`;

    const values = params.setNull
      ? params.pkValues
      : [params.newValue, ...params.pkValues];

    await client.query("BEGIN");
    try {
      const result = await client.query(sql, values);
      if (result.rowCount === 0) {
        throw new Error(
          "Row not found — it may have been modified or deleted.",
        );
      }
      if (result.rowCount! > 1) {
        // PK violation in schema. Abort.
        throw new Error(`Unsafe: ${result.rowCount} rows matched — aborting.`);
      }
      await client.query("COMMIT");
      return { row: result.rows[0]! };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  });
}
```

`safePgCast` is a whitelist function that accepts only type names we registered. Unknown casts throw before SQL is constructed — defence against a malicious/broken renderer.

IPC registration in [table-data-ipc.ts](apps/desktop/src/main/table-data-ipc.ts) follows the existing `{ success, data } | { success, error }` contract.

#### 6. Renderer — cell editing UX

**Files:**

- `apps/desktop/src/components/workspace/table-viewer/editable-cell.tsx` (new) — wraps `TableCell` and card field value
- [table-data-view.tsx](apps/desktop/src/components/workspace/table-viewer/table-data-view.tsx) and [card-data-view.tsx](apps/desktop/src/components/workspace/table-viewer/card-data-view.tsx) — delegate display to the new wrapper

`EditableCell` responsibilities:

- Receive `{ col, value, rowPkValues, schema, table, connectionId, primaryKey }`.
- If `readOnlyMode || primaryKey === null` → render the existing display renderer with **no** interaction handlers. No wrapping `<button>`, no `onDoubleClick`, no `data-editable` attribute. The DOM should be indistinguishable from the current read-only output.
- Otherwise:
  - Attach `onDoubleClick` → opens inline editor (for `kind: 'inline'`) or modal (`kind: 'modal'`).
  - Inline editor: `<Input>` inside a `Popover` anchored to the cell. Enter commits; Escape cancels; blur commits.
  - Modal editor: renders the editor component in a `<Dialog>`.
  - Optimistic update: immediately show new value; on IPC success, replace with returned row (types are authoritative); on failure, revert and show `toast.error(message)`.
  - Disable further interaction while in-flight (spinner overlay, aria-busy).

**Table view** mounts `EditableCell` per cell. **Card view** mounts `EditableCell` per field, using the card field as the anchor instead of a `TableCell`.

The edit path does **not** refetch the page — it splices the returned row into the in-memory page. This matches the optimistic model and keeps the current pagination state stable.

#### 7. Error surfacing

- Type-level validation errors (e.g. "not valid JSON") → inline red text beneath the input, do not submit.
- DB-level errors (constraint violation, serialization failure, row-not-found, permissions) → `toast.error` with the message, value reverts.
- Read-only mode hit at IPC layer → same error toast ("Read-only mode is enabled."); this is a defense-in-depth case that should only fire if the UI gate is bypassed.

---

### File-by-file change map

| File                                                                                                            | Change                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/shared/types/table-data.ts`                                                                   | Add `primaryKey` to `TableRowsResult`; add `UpdateCellParams`, `UpdateCellResult`, `UPDATE_CELL` channel |
| `apps/desktop/src/main/table-data-rows.ts`                                                                      | Fetch primary-key columns alongside `getRows` (skip for query results — pass through `null`)             |
| `apps/desktop/src/main/table-data-write.ts`                                                                     | **New.** `updateCell` logic, `safePgCast` whitelist                                                      |
| `apps/desktop/src/main/table-data-ipc.ts`                                                                       | Wire `UPDATE_CELL` channel                                                                               |
| `apps/desktop/src/preload.ts`                                                                                   | Expose `tableDataApi.updateCell` (mirrors `getRows`)                                                     |
| `apps/desktop/src/components/settings/SettingsDialog.tsx`                                                       | Remove "coming soon" copy from read-only toggle                                                          |
| `apps/desktop/src/components/workspace/renderers/edit-registry.ts`                                              | **New.** Registry + default editors                                                                      |
| `apps/desktop/src/components/workspace/renderers/postgis-editor.tsx`                                            | **New.** Map modal editor                                                                                |
| `apps/desktop/src/components/workspace/renderers/register.ts` (if exists; else wire into existing registration) | Register default editors + PostGIS editor                                                                |
| `apps/desktop/src/components/workspace/table-viewer/editable-cell.tsx`                                          | **New.** Cell wrapper — handles gating, inline/modal editing, optimistic UI                              |
| `apps/desktop/src/components/workspace/table-viewer/table-data-view.tsx`                                        | Accept `primaryKey`, route cells through `EditableCell`                                                  |
| `apps/desktop/src/components/workspace/table-viewer/card-data-view.tsx`                                         | Same as above for card fields                                                                            |
| `apps/desktop/src/components/workspace/table-viewer/data-tab.tsx` (caller of the views)                         | Thread `primaryKey` from `TableRowsResult`; hold optimistic row state                                    |
| `package.json`                                                                                                  | Add `leaflet`, `react-leaflet`, `@types/leaflet` for PostGIS editor                                      |

---

### Test plan

We **land tests first** for every layer below. "Test harness prior to implementation" is the bar. The test pyramid mirrors the existing structure in [docs/TESTING.md](../TESTING.md).

#### Seed updates

[apps/desktop/tests/support/postgres-seed.sql](apps/desktop/tests/support/postgres-seed.sql) gains:

- a `geometry(Point, 4326)` column on `app.users` — gated behind `CREATE EXTENSION IF NOT EXISTS postgis` and a graceful `DO $$ BEGIN … EXCEPTION WHEN undefined_file THEN … END $$;` block so PGlite (no PostGIS) skips it and the real-Postgres suite exercises it. Suite files branch on capability.
- a `pg_compass_test.notes` table with no primary key (for non-editable assertion).
- a `vector(3)` column gated behind `CREATE EXTENSION IF NOT EXISTS vector` the same way.
- `bytea`, `interval`, `numeric(10,2)` columns on `app.orders` for type coverage.

#### Unit tests (Vitest, jsdom)

Location: `apps/desktop/tests/unit/`.

1. **`edit-registry.test.ts`** (new)
   - fallback for unknown type is a text editor
   - `registerMany` covers aliases
   - each type's `validate` table:
     - `int4`: `"42"` ok; `"42.5"` err; `"2147483648"` err (out of range); `""` err; `" 42 "` trimmed ok
     - `int8`: bigint boundary
     - `float8`: `"NaN"`/`"Infinity"` err
     - `bool`: only `"true"`/`"false"` exact
     - `uuid`: canonical form only, lowercase/uppercase both ok
     - `jsonb`: `"{}"` ok; `"{not-json}"` err; `"null"` ok (JSON null, not SQL NULL)
     - `_int4`: `"[1,2,3]"` ok; `"[1,\"x\"]"` err
     - `timestamptz`: passes strings through, rejects empty
     - `vector`: `"[1,2,3]"` ok; dimension-mismatch is server-side, not here
   - `toInput` round-trips for Date objects, Buffers, nested JSONB
2. **`editable-cell.test.tsx`** (new, React Testing Library)
   - renders display-only when `readOnlyMode` is true — asserts no `onDoubleClick`, no `data-testid="cell-editor"`, no edit-capable ARIA role in the tree
   - renders display-only when `primaryKey === null` — same assertions
   - renders editable when both conditions cleared — double-click opens input, Enter calls `updateCell` with correct params, Escape reverts
   - optimistic UI: on IPC failure, value reverts and toast fires
3. **`postgis-editor.test.tsx`** (new)
   - WKT textarea round-trips for Point, LineString, Polygon
   - Point lat/lng inputs and WKT stay in sync
   - click-to-place on map updates Point (mock Leaflet)
   - SRID 0 / missing is allowed and sent to the server for it to decide
4. **`table-data-helpers.test.ts`** (extend existing)
   - `safePgCast` — allowlist test; unknown cast throws
   - SQL builder shape (through `updateCell` with a mocked `pg.Client`): identifier quoting on exotic column names (`"col with ""quotes"""`, `"col; DROP"`) — asserts no string interpolation of user values, `$1`/`$2` placeholders only
5. **`preload.test.ts`** (extend)
   - `tableDataApi.updateCell` appears on the contract; invokes the correct channel

#### Integration tests (Vitest, PGlite + real Postgres)

Both [table-data.pglite.test.ts](apps/desktop/tests/integration/table-data.pglite.test.ts) and [table-data.postgres.test.ts](apps/desktop/tests/integration/table-data.postgres.test.ts) call a shared suite.

Extend [tests/integration/table-data.suite.ts](apps/desktop/tests/integration/table-data.suite.ts) with:

1. **`getRows` returns primary key**
   - `app.users.primaryKey === ['id']`
   - `app.active_users.primaryKey === null` (view)
   - `pg_compass_test.notes.primaryKey === null` (no-PK table)
2. **`updateCell` happy path — each type**
   - `text`: change `display_name`, row returned with new value
   - `int4`: change `total_cents`
   - `bool`: (add a `is_verified bool` — schema change in seed) toggle
   - `jsonb`: set nested object
   - `timestamptz`: set ISO string, server round-trips to `Date`
   - `_int4`: set array
   - `uuid`: set new UUID
   - **PostGIS (`geometry`)**: set WKT for Point — real-Postgres suite only (PGlite skips)
   - **pgvector (`vector`)**: real-Postgres suite only
3. **`updateCell` — set NULL path** for a nullable JSONB column
4. **`updateCell` failures**
   - read-only mode on (toggle settings store) → error message matches; row unchanged
   - table without PK (`pkColumns: []`) → error, row unchanged
   - row not found (stale PK value) → error, not zero-rows-affected-silent-pass
   - NOT NULL violation → DB error surfaces
   - CHECK violation (`status` → `'banana'`) → DB error surfaces
   - FK violation (`orders.user_id = 999999`) → DB error surfaces
   - JSON column with invalid JSON value → Postgres error (renderer-side validation is a separate unit test)
   - unknown pgCast (forged from renderer) → `safePgCast` throws before SQL
5. **Identifier injection**
   - Column named `"evil""; DROP TABLE x; --"` (test-only table) updates correctly and leaves the test DB intact
6. **Concurrency**
   - Two `updateCell` calls against the same row, serial: second sees first's change via `RETURNING *`

#### E2E tests (Playwright + Electron)

Location: `apps/desktop/tests/e2e/`.

New file `edit.e2e.spec.ts`. Because the E2E harness launches a packaged Electron app, we pre-seed the electron-store settings file during `global-setup.ts` per-test using `PG_COMPASS_STORE_DIR` (already used by integration tests). Two worlds:

1. **`edits are hidden in read-only mode`** — `settings.json.general.readOnlyMode = true`
   - navigate to `app.users`, Table View
   - assert `page.getByRole('textbox')` is not present after double-clicking any cell
   - assert no element with `data-testid="cell-editor"` exists anywhere
   - assert the cell's `ondblclick` is `null` (via `locator.evaluate`)
   - switch to Card View — same assertions
   - open Settings dialog — assert Read-Only toggle does not say "coming soon"
2. **`edits work when read-only mode is off`** — `readOnlyMode = false`
   - double-click a `display_name` cell in Table View → input appears → type → Enter → row reflects new value
   - refresh page → value persists
   - double-click a `profile` JSONB cell → modal dialog appears with JSON textarea
   - double-click a `created_at` cell → input, bad date shows inline error, good ISO string saves
   - Card View: double-click a field → edits apply
   - PostGIS cell (skipped on CI without PostGIS) → map modal appears
3. **`view is non-editable`**
   - navigate to `app.active_users`
   - no double-click handler anywhere
4. **`escape cancels`** — type → Escape → input closes, value unchanged
5. **`constraint error surfaces`** — set `status` to invalid value → toast with Postgres message; cell reverts

Coverage-matrix update: add a row "Cell edit (text, json, postgis)" with Yes / Yes (pglite + postgres split) / Yes.

---

### Rollout sequence

1. **Tests first.** Land the seed changes, extend `table-data.suite.ts`, add `edit-registry.test.ts` skeleton with `expect.fail` placeholders, add `edit.e2e.spec.ts` with expected failures. Suites red by design.
2. **PK resolution.** Wire `primaryKey` through `TableRowsResult`. Integration tests in §1 go green.
3. **Write path scaffolding.** `table-data-write.ts` + IPC + preload. The `safePgCast` / failure-matrix integration tests (§4) go green.
4. **Edit registry + built-in editors.** Unit tests (§1) go green.
5. **`EditableCell` wrapper.** Component tests (§2) go green. Wire into Table View.
6. **Card View.** Card-view component tests + E2E.
7. **PostGIS editor** (gated by PostGIS availability in the DB).
8. **Copy + polish.** Update settings dialog copy. Update `docs/TEST_COVERAGE_MATRIX.md`.
9. **Phase-close.** Move this doc's status from "Planned" → "Implemented", add an Implementation Notes section mirroring [EXPORT_DATA_TASK.md](docs/tasks/EXPORT_DATA_TASK.md).

### Decisions locked in (2026-04-20)

1. **PostGIS map.** Use Leaflet (`react-leaflet`) for click-to-place Point editing and visualization of other geometries.
2. **Undo toast.** Deferred to Phase 2.
3. **Query tab edits.** Deferred to Phase 2.
4. **`ctid`-based editing for no-PK tables.** Deferred to Phase 2.

---

## Implementation Notes

### Backend (Main Process)

- **IPC channel** `UPDATE_CELL` added to `TableDataChannels`. Handler lives in `src/main/table-data-write.ts` and is wired into `src/main/table-data-ipc.ts` / `src/preload.ts`.
- **Two-layer read-only gate.** The renderer hides every edit affordance when `settings.general.readOnlyMode` is true, and the main-process handler re-reads the setting from `electron-store` and rejects the write independently. Tests cover both layers.
- **`pgCast` allowlist.** The handler validates the pgCast string against a fixed allowlist (`text`, `int4`, `jsonb`, `geometry`, …) and refuses anything outside it. Unknown casts never reach the SQL builder.
- **`UPDATE … RETURNING *`.** On success, the fresh row is returned to the renderer so the optimistic replacement matches whatever defaults/triggers the database applied.
- **Row identity.** The handler requires non-empty `pkColumns` + `pkValues`. Views and PK-less tables surface `primaryKey: null` from `TableRowsResult`, which the renderer uses to disable edit affordances entirely.

### Frontend (Renderer)

- **`EditableCell` wrapper** (`src/components/workspace/table-viewer/editable-cell.tsx`) is the single audit point for the read-only gate. Non-editable cells render the display renderer's output bare — no wrapping element, no `data-editable` attribute, no double-click handler. A DOM-snapshot test pins this contract.
- **Edit registry** (`src/components/workspace/renderers/edit-registry.ts`) parallels the type registry. Each registered `TypeEditor` owns `toInput` / `validate` / optional modal `Component`. A fallback text editor catches unregistered types. 110 unit tests cover the validation matrix (integer ranges, JSONB NUL rejection, UUID normalisation, pgvector `[…]` vs `{…}`, etc.).
- **Dialog-backed edit flow.** Double-click opens a Radix Dialog with a compact `<Input>` or multi-line `<textarea>` depending on type. Enter saves (for inline editors); Shift+Enter is reserved for newlines; Escape / backdrop-click cancels. Save shows a spinner; errors surface inline AND via `toast.error` with the Postgres message verbatim.
- **PostGIS map editor** (`src/components/workspace/renderers/postgis-editor.tsx`) renders a Leaflet map, structured lat/lng/SRID inputs, and an authoritative WKT/EWKT textarea. Point geometries two-way-bind between the map pin and the structured form; other geometries (LineString, Polygon, …) are edited in the textarea and the map is purely visual. Click-to-place updates the form and regenerates the WKT.
- **Optimistic update.** `DataTab` replaces the mutated row in place from the `UPDATE … RETURNING *` payload. No refetch, no spinner, no flicker.
- **Immutable and NULL affordance gating.** Inline cell edit treats primary-key cells as immutable even when the row is otherwise editable, so double-clicking a PK value renders no editor. `ColumnInfo` carries table/view nullability from `getRows`; Set NULL controls are only rendered for nullable columns, including FK modal editors.

### Tests

- **Unit (168 tests)**: `edit-registry.test.ts` (110), `editable-cell.test.tsx` (6, includes DOM-contract), `postgis-editor.test.tsx` (9), plus pre-existing coverage.
- **Integration (PGlite)**: `table-data.pglite.test.ts` gains 14 cases spanning `updateCell` happy-path per type (text, int, numeric, bool, uuid, json, jsonb, array, timestamp, date), the `setNull` path, the `pgCast` allowlist, the read-only-mode rejection, and the no-PK rejection.
- **E2E (Playwright)**: `edit.e2e.spec.ts` covers the read-only gate (no edit affordance in either view), the happy-path edit dialog appearing, and the view-is-non-editable assertion. Gated on `PG_COMPASS_TEST_ADMIN_DATABASE_URL` / `PG_COMPASS_TEST_DATABASE_URL` so it skips when a real Postgres isn't configured.

### Follow-up polish

- **Enum dropdowns.** Enum columns no longer fall through to the text fallback. `ColumnInfo` carries `enumLabels` and a catalog-derived `enumPgCast`, the edit dialog renders a `<select>`, and the write path accepts schema-qualified enum casts so non-`public` enum types work correctly.
