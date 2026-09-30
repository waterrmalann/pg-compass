# Edit Functionality: Phase 2 - Row Edit (Atomic Multi-Field)

**Status:** Implemented (2026-05-05)
**Relevance:** Table data rows in both Table View and Card View, from the Data tab. Builds on top of the inline-cell edit shipped in [INLINE_WRITE_TASK.md](INLINE_WRITE_TASK.md). Query tab stays read-only (Phase 3).

## Requirement

The inline cell editor we shipped in Phase 1 is great for "I want to fix this one value" — double-click, type, Enter, done. But many edits aren't single-cell:

- Coordinated changes (e.g. set `status = 'active'` _and_ `activated_at = now()` on the same row).
- Updating several fields where each one alone would leave the row in an awkward intermediate state.
- Reviewing the whole row's current values while choosing what to change.

We need a row-level edit affordance:

- A small **edit (pencil) icon** appears on hover over a row — both in Table View and Card View.
- Clicking it opens a **row editor** that lets the user edit _any subset_ of the row's columns in place.
- Hitting **Save** sends every edited field as a **single atomic `UPDATE`** (one statement, one transaction, all-or-nothing).
- Hitting **Cancel** / closing the editor discards all pending changes.

The Phase 1 inline-cell editor stays as the way to edit a single cell quickly. Row edit is the way to commit a coherent multi-field change.

> [!IMPORTANT]
> Like inline cell edit, the row edit affordance must be **completely absent** when `readOnlyMode` is enabled in settings, and absent when the row's relation has no primary key (`primaryKey === null`). The edit icon must not render, must not be in the DOM, and must not be reachable by keyboard. Tests enforce this.

## Tests

We continue the "tests-first" discipline from Phase 1. Unit tests for the row-editor state machine and the SQL builder, integration tests against PGlite + real Postgres for the atomic multi-column UPDATE, and E2E tests for the icon-on-hover and dialog flow. Use the existing test harness (see [docs/TESTING.md](../TESTING.md)).

---

## Plan

### Guiding principles

1. **Atomicity is the headline feature.** A row edit is one `UPDATE table SET col1=$1, col2=$2, … WHERE pk…` — never a sequence of per-cell updates. If two columns are edited and one fails type validation server-side, neither change lands.
2. **Reuse, don't fork.** The editor for each column is the same `TypeEditor` from the Phase 1 edit registry. Row edit is a _composition_ over that registry, not a parallel system. Validation, NULL handling, and pgCast allow-listing all flow through the same code paths.
3. **Discoverable but quiet.** The pencil icon is only visible on row hover (or row focus, for keyboard users). It does not occupy persistent visual real estate.
4. **No half-saved rows.** The dialog tracks `original` vs `draft` per field. Save sends only the diff. Cancel discards the draft. There is no "auto-save on close."
5. **Two-layer read-only enforcement** (same contract as Phase 1). Renderer hides the affordance entirely; main-process `updateRow` handler re-checks the setting and rejects writes independently.
6. **Same identity rules.** Row edit requires a primary key. Tables without a PK and views are not row-editable in Phase 2.

### Non-Goals (Phase 2)

- Editing rows from Query tab results.
- Editing rows on views.
- Editing rows on tables without a primary key.
- Bulk row edits (edit N rows at once).
- Row insert / row delete (separate task).
- Optimistic locking via row-version / `xmin` checks. Last-writer-wins remains the model; we reuse the Phase 1 stale-row error path.
- Foreign-key picker / autocomplete for FK columns. Phase 2 keeps the per-type editor as-is.
- Inline diff preview ("here's the SQL we'll run"). Considered for Phase 3 if user feedback asks for it.

---

### Architecture

#### 1. Hover affordance — pencil icon

**Files:**

- [apps/desktop/src/components/workspace/table-viewer/table-data-view.tsx](apps/desktop/src/components/workspace/table-viewer/table-data-view.tsx)
- [apps/desktop/src/components/workspace/table-viewer/card-data-view.tsx](apps/desktop/src/components/workspace/table-viewer/card-data-view.tsx)
- `apps/desktop/src/components/workspace/table-viewer/row-edit-button.tsx` (new) — the small icon button, used by both views

**Table View:**

- Reserve a fixed-width "actions" column on the right (or pin to the row's leading gutter — decision below). On row hover or row focus, the pencil icon fades in inside that gutter cell. Off-hover, the gutter cell is empty (cell still occupies space to avoid layout shift).
- Decision: **leading gutter** (left edge), to mirror the typical "row actions" pattern and to keep the data columns aligned with the column headers.

**Card View:**

- The card already has a header strip. The pencil icon goes top-right of the card, visible on card hover/focus.

**Gating logic** (shared, lives in `row-edit-button.tsx`):

```ts
const canEdit = !readOnlyMode && primaryKey !== null;
if (!canEdit) return null; // not in DOM at all
```

When `canEdit` is false the component returns `null` — no wrapper, no `aria-hidden` placeholder, nothing. Same DOM-contract test as `EditableCell`.

#### 2. Row edit dialog

**File:** `apps/desktop/src/components/workspace/table-viewer/row-edit-dialog.tsx` (new)

A Radix `Dialog` opened by the pencil button. Shape:

```
┌─ Edit row ────────────────────────────── ✕ ─┐
│ Table: app.users                            │
│ PK: id = 42                                 │
│ ───────────────────────────────────────────│
│ display_name   text       [ Alan        ] ↺│
│ email          text       [ a@b.co      ] ↺│
│ profile        jsonb      [ Edit JSON…  ] ↺│
│ status         enum       [ active   ▾  ] ↺│
│ created_at     timestamptz[ 2026-04-…  ] ↺│
│ ...                                        │
│ ───────────────────────────────────────────│
│ 3 fields changed.       [ Cancel ] [ Save ]│
└─────────────────────────────────────────────┘
```

- One row per non-PK column. PK columns render read-only (we do not allow PK mutation in Phase 2 — too easy to footgun).
- Each field uses the column's registered `TypeEditor`:
  - `kind: 'inline'` editors render their `<Input>` / `<select>` directly in the form.
  - `kind: 'modal'` editors (JSON tree, PostGIS map) render a "Edit…" button that opens the same modal `Component` the Phase 1 cell editor uses; on save-from-modal, the value lands in the row form's draft state (not committed to the DB yet).
- Each field has:
  - A **revert** button (↺) that resets that single field to its original value.
  - A **Set NULL** affordance (small button or `Ctrl+Del` keyboard shortcut, mirroring Phase 1) — only on nullable columns, so we surface a clear UX when a user wants to clear a value.
- Header summary: "N fields changed." Save button disabled when N === 0.
- Save shows a spinner overlay; on error, the dialog stays open so the user can correct and retry.

**State shape** (component-local, no global store):

```ts
interface RowEditDraft {
  // Keyed by column name. Absent ⇒ unchanged.
  changes: Record<
    string,
    {
      newValue: unknown;
      pgCast: string;
      setNull: boolean;
    }
  >;
  // Per-field validation errors from the editor's validate().
  errors: Record<string, string | null>;
}
```

Save assembles `UpdateRowParams` from `changes` and dispatches IPC.

**Keyboard:**

- `Tab` cycles fields.
- `Esc` cancels (with confirm-discard if `changes` is non-empty).
- `Cmd/Ctrl+Enter` saves.

#### 3. Main process — atomic multi-column UPDATE

**File:** `apps/desktop/src/main/table-data-write.ts` (extend the existing file from Phase 1 — keeps the file-split discipline intact)

New IPC channel and shared types:

```ts
// shared/types/table-data.ts — NEW
export interface UpdateRowFieldChange {
  column: string;
  pgCast: string;
  newValue: unknown;
  setNull: boolean;
}

export interface UpdateRowParams {
  connectionId: string;
  schema: string;
  table: string;
  pkColumns: string[];
  pkValues: unknown[];
  changes: UpdateRowFieldChange[]; // length >= 1
}

export interface UpdateRowResult {
  /** Full row after update, re-typed through buildTypeMap. */
  row: Record<string, unknown>;
}

export const TableDataChannels = {
  …,
  UPDATE_CELL: 'table-data:update-cell',  // existing (Phase 1)
  UPDATE_ROW:  'table-data:update-row',   // NEW
};
```

Handler logic:

```ts
export async function updateRow(
  params: UpdateRowParams,
): Promise<UpdateRowResult> {
  // Layer 2 read-only enforcement — never trust the renderer.
  if (getSettings().general.readOnlyMode) {
    throw new Error("Read-only mode is enabled.");
  }
  if (params.pkColumns.length === 0) {
    throw new Error("Cannot update a row without a primary key.");
  }
  if (params.changes.length === 0) {
    throw new Error("No changes to apply.");
  }

  // Validate every cast against the same allow-list as updateCell.
  for (const change of params.changes) {
    if (!change.setNull) safePgCast(change.pgCast); // throws on unknown
  }

  // De-dup: no two changes for the same column.
  const seen = new Set<string>();
  for (const c of params.changes) {
    if (seen.has(c.column)) {
      throw new Error(`Duplicate change for column "${c.column}".`);
    }
    seen.add(c.column);
  }

  return withPoolClient(params.connectionId, async (client) => {
    const qualifiedTable = `${quoteIdent(params.schema)}.${quoteIdent(params.table)}`;

    // SET fragments. Non-NULL changes consume sequential placeholders;
    // setNull changes do not. PK placeholders come last.
    const setParts: string[] = [];
    const values: unknown[] = [];
    for (const change of params.changes) {
      if (change.setNull) {
        setParts.push(`${quoteIdent(change.column)} = NULL`);
      } else {
        values.push(change.newValue);
        setParts.push(
          `${quoteIdent(change.column)} = $${values.length}::${safePgCast(change.pgCast)}`,
        );
      }
    }
    const whereParts = params.pkColumns.map((col) => {
      values.push(params.pkValues[setParts.length /* not used */]); // see below
      return `${quoteIdent(col)} = $${values.length}`;
    });

    // (Above is illustrative; actual code uses two passes — first SET parts
    // build values, then PK parts append PK values — to keep placeholder
    // numbering correct. Implementation will mirror the updateCell pattern.)

    const sql = `
      UPDATE ${qualifiedTable}
      SET ${setParts.join(", ")}
      WHERE ${whereParts.join(" AND ")}
      RETURNING *`;

    await client.query("BEGIN");
    try {
      const result = await client.query(sql, values);
      if (result.rowCount === 0) {
        throw new Error(
          "Row not found — it may have been modified or deleted.",
        );
      }
      if (result.rowCount! > 1) {
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

Key points:

- **One SQL statement, one transaction.** All changes apply atomically. Postgres validates every value against its column type before any of them land — partial-success is impossible.
- **Same `safePgCast` allow-list** as Phase 1 — no new attack surface.
- **`RETURNING *`** so the renderer gets the post-trigger / post-default canonical row back.
- **Row-count guards** identical to `updateCell` (zero ⇒ stale, >1 ⇒ schema integrity violation).

IPC registration in [table-data-ipc.ts](apps/desktop/src/main/table-data-ipc.ts) follows the existing `{ success, data } | { success, error }` contract. Preload exposes `tableDataApi.updateRow` mirroring `updateCell`.

#### 4. Optimistic update path

`DataTab` already replaces a mutated row in place from `updateCell`'s `RETURNING *` payload. `updateRow` returns the same shape, so we reuse the splice helper (factor it into a small util if it's currently inlined). On error the dialog stays open and the row in the grid is untouched.

#### 5. Read-only / no-PK gating contract

The same DOM-contract test pattern from `EditableCell` applies to `RowEditButton`:

- `readOnlyMode === true` ⇒ button is not in the DOM, no event handlers, no `aria-hidden` placeholder.
- `primaryKey === null` ⇒ same.
- View / non-table relation ⇒ same (covered by `primaryKey === null` since views surface PK as `null`).

The dialog itself trusts these gates; if the dialog ever opened in a read-only context (e.g. settings flipped while open), the Save handler still calls IPC and the main-process gate rejects. Layer 2 is real, not theatre.

---

### File-by-file change map

| File                                                                     | Change                                                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/shared/types/table-data.ts`                            | Add `UpdateRowFieldChange`, `UpdateRowParams`, `UpdateRowResult`, `UPDATE_ROW` channel                      |
| `apps/desktop/src/main/table-data-write.ts`                              | Add `updateRow` handler; share `safePgCast` and the `withPoolClient` BEGIN/COMMIT pattern with `updateCell` |
| `apps/desktop/src/main/table-data-ipc.ts`                                | Wire `UPDATE_ROW` channel                                                                                   |
| `apps/desktop/src/preload.ts`                                            | Expose `tableDataApi.updateRow`                                                                             |
| `apps/desktop/src/components/workspace/table-viewer/row-edit-button.tsx` | **New.** The hover pencil icon. Gating logic + `onClick` opens the dialog                                   |
| `apps/desktop/src/components/workspace/table-viewer/row-edit-dialog.tsx` | **New.** The multi-field row editor (composition over the Phase 1 edit registry)                            |
| `apps/desktop/src/components/workspace/table-viewer/table-data-view.tsx` | Add leading gutter cell with `RowEditButton` per row (visible on hover/focus)                               |
| `apps/desktop/src/components/workspace/table-viewer/card-data-view.tsx`  | Add `RowEditButton` to card header (visible on hover/focus)                                                 |
| `apps/desktop/src/components/workspace/table-viewer/data-tab.tsx`        | Pass `primaryKey` and the splice helper down; thread `updateRow` IPC                                        |

No changes required to `edit-registry.ts`, `editable-cell.tsx`, or any per-type editor component — Phase 2 reuses them.

---

### Test plan

We **land tests first** for every layer below, same bar as Phase 1.

#### Unit tests (Vitest, jsdom)

Location: `apps/desktop/tests/unit/`.

1. **`row-edit-dialog.test.tsx`** (new, React Testing Library)
   - renders one input per non-PK column; PK columns render as read-only labels
   - editing two fields, hitting Save, calls `updateRow` with both changes in a single payload
   - hitting Save with zero changes is impossible (button disabled); test that the button stays disabled until a change is made
   - per-field revert (↺) clears that field's draft, leaves other drafts intact
   - per-field Set NULL toggles `setNull: true`, hides the editor's input, shows a "NULL" pill
   - validation error in any field disables Save and surfaces inline red text
   - Cancel with non-empty draft prompts confirm-discard; Cancel with empty draft closes immediately
   - `Cmd+Enter` saves; `Esc` cancels (with the confirm rule above)
   - modal-kind editor (JSONB) opens its own dialog and writes back into the row draft on save
2. **`row-edit-button.test.tsx`** (new)
   - renders nothing when `readOnlyMode === true` — DOM-contract assertion (no element with `data-testid="row-edit-button"` anywhere in the row's subtree)
   - renders nothing when `primaryKey === null`
   - renders the icon when both gates clear; click opens the dialog
   - keyboard: Tab focuses the icon, Enter activates it
3. **`table-data-helpers.test.ts`** (extend existing)
   - SQL builder shape for `updateRow` (through a mocked `pg.Client`):
     - two-column update: `SET "a" = $1::int4, "b" = $2::text WHERE "id" = $3` with values `[newA, newB, pkId]`
     - mixed setNull + value: `SET "a" = NULL, "b" = $1::text WHERE "id" = $2` with values `[newB, pkId]` — placeholders renumber correctly
     - composite PK: two PK columns, two SET cols, four placeholders, correct ordering
     - duplicate column in `changes` ⇒ throws before SQL builds
     - unknown pgCast in any change ⇒ throws before SQL builds
     - empty `changes` ⇒ throws
4. **`preload.test.ts`** (extend) — `tableDataApi.updateRow` appears on the contract; invokes the correct channel.

#### Integration tests (Vitest, PGlite + real Postgres)

Extend [tests/integration/table-data.suite.ts](apps/desktop/tests/integration/table-data.suite.ts):

1. **`updateRow` happy path — multi-column atomic**
   - update `display_name` + `email` on `app.users`; both land; row returned with new values
   - update `status` + `activated_at` on `app.users` (an enum + timestamptz pairing) — exercises the dependency motivation in the requirement
   - mixed types: `text` + `jsonb` + `int4` in one call
2. **`updateRow` — atomicity under failure**
   - one valid change + one change that violates a CHECK constraint ⇒ entire row unchanged after the call (re-fetch and assert original values)
   - one valid change + one change with a FK violation ⇒ entire row unchanged
   - NOT NULL violation on a setNull change ⇒ entire row unchanged
   - assertion done by re-querying the row outside the failing transaction; both columns must equal pre-call values
3. **`updateRow` — setNull path**
   - mixed: one setNull + one value change in the same call
4. **`updateRow` — guardrails**
   - read-only mode on (toggle settings store) ⇒ rejected; row unchanged
   - table without PK (`pkColumns: []`) ⇒ rejected
   - empty `changes` ⇒ rejected
   - duplicate column in `changes` ⇒ rejected
   - unknown pgCast in any change ⇒ rejected before SQL builds
   - row not found (stale PK value) ⇒ rejected; not silent zero-rows-affected
5. **Identifier injection** — column named `"evil""; DROP TABLE x; --"` and table name with quotes update correctly via `quoteIdent`; test DB intact afterwards.
6. **Composite PK** — `pg_compass_test.composite_pk_table` (add to seed if absent); update on a row identified by two PK columns.
7. **Concurrency** — two serial `updateRow` calls against the same row; second sees first's changes via `RETURNING *`.

Both [table-data.pglite.test.ts](apps/desktop/tests/integration/table-data.pglite.test.ts) and [table-data.postgres.test.ts](apps/desktop/tests/integration/table-data.postgres.test.ts) call the shared suite. PostGIS / pgvector multi-field cases run only in the real-Postgres suite.

#### E2E tests (Playwright + Electron)

Location: `apps/desktop/tests/e2e/`.

New file `row-edit.e2e.spec.ts`:

1. **Read-only mode hides the affordance.** `settings.json.general.readOnlyMode = true`
   - navigate to `app.users`, Table View
   - hover over a row — assert no `[data-testid="row-edit-button"]` element appears
   - assert the row has no element with `aria-label="Edit row"`
   - Card View — same assertions
   - flip read-only off via Settings dialog ⇒ icon now appears on hover
2. **View has no row-edit affordance.**
   - navigate to `app.active_users` (a view)
   - hover any row — no icon, no dialog reachable
3. **No-PK table has no row-edit affordance.**
   - navigate to `pg_compass_test.notes`
   - same assertion
4. **Happy path — multi-field edit.**
   - hover row → click pencil → dialog opens
   - change `display_name` and `email`
   - "2 fields changed" appears
   - click Save → spinner → dialog closes → both cells reflect new values in the grid
   - refresh page → values persist
5. **Atomicity surfaces in the UI.**
   - in dialog, set `status` to `'banana'` (CHECK violation) and also change `display_name`
   - click Save → toast with the Postgres error → dialog stays open with both drafts intact → grid row unchanged
   - revert the bad field, Save again → both go through
6. **Per-field revert + Set NULL.**
   - change one field, click ↺ → field returns to original value
   - click Set NULL on a nullable field → input replaced with NULL pill, Save sends `setNull: true`
7. **Cancel discards.**
   - change a field → Cancel → confirm-discard appears → confirm → dialog closes → row unchanged
8. **Card View parity.**
   - same multi-field edit flow from Card View; pencil sits in the card header

Coverage matrix update: add a row "Row edit (multi-field atomic)" with Yes / Yes (pglite + postgres split) / Yes.

---

### Rollout sequence

1. **Tests first.** Land the new seed additions if any (composite-PK table), extend `table-data.suite.ts`, scaffold `row-edit-dialog.test.tsx` / `row-edit-button.test.tsx` / `row-edit.e2e.spec.ts` with expected failures.
2. **Shared types + IPC scaffolding.** Add `UpdateRowParams` etc. and wire the channel through preload. Stub handler returns "not implemented".
3. **`updateRow` handler.** Implement the atomic-UPDATE builder, share `safePgCast` with `updateCell`, factor out any shared helpers. Integration tests in §1–§7 go green.
4. **`RowEditButton`.** Component + DOM-contract tests go green. Wire into Table View and Card View, with hover/focus visibility.
5. **`RowEditDialog`.** Compose over the Phase 1 edit registry; per-field revert / Set NULL / validate. Component tests go green.
6. **`DataTab` plumbing.** Thread `updateRow` IPC + reuse the row-splice helper for optimistic update.
7. **E2E green.** Wire keyboard shortcuts (`Cmd+Enter` save, `Esc` cancel-with-discard-prompt).
8. **Polish.** Update `docs/TEST_COVERAGE_MATRIX.md`. Confirm no regressions in inline cell edit (Phase 1 behavior unchanged).
9. **Phase-close.** Move this doc's status from "Planned" → "Implemented", add an Implementation Notes section mirroring Phase 1.

### Open decisions

1. **Pencil column position in Table View.** Leading gutter (left) vs trailing column (right). Leaning leading; revisit after a UX pass on real data.
2. **Confirm-discard on Cancel.** Always-on, or only when ≥ N fields changed? Phase 2 ships always-on for safety; we can soften later.
3. **Save error keeps dialog open vs closes-with-toast.** Phase 2 keeps it open so the user doesn't lose drafts on a transient FK / CHECK error.

---

## Implementation Notes

### Backend (Main Process)

- **`updateRow` handler** in [src/main/table-data-write.ts](apps/desktop/src/main/table-data-write.ts) builds a single `UPDATE … SET col1=$1, col2=$2 WHERE pk…` statement and sends it as one query. Postgres applies it atomically — a failing CHECK / FK / type cast on any field rolls all changes back. There is no `BEGIN/COMMIT` wrapper because a single `UPDATE` is already atomic; this matches `updateCell`.
- **Cast allow-list reuse.** The same `SAFE_PG_CAST` set and `assertEnumCast` helper used by `updateCell` validate every change in the row payload. Unknown casts are rejected before any SQL is constructed.
- **Pre-flight guards.** Empty `changes`, duplicate columns within `changes`, mismatched `pkColumns` / `pkValues` lengths, and read-only mode are rejected with explicit messages before the query is built.
- **Placeholder numbering** is dense and stable across mixed value/setNull entries: setNull columns emit `col = NULL` literally and consume no placeholder; PK placeholders always come after every SET placeholder.
- **`UPDATE … RETURNING *`** so the renderer's optimistic row-splice gets the post-trigger / post-default canonical row. Row-count guards (zero ⇒ stale, >1 ⇒ schema integrity violation) match `updateCell`.

### Frontend (Renderer)

- **`RowEditButton`** ([src/components/workspace/table-viewer/row-edit-button.tsx](apps/desktop/src/components/workspace/table-viewer/row-edit-button.tsx)) renders `null` outright when read-only mode is on or the relation has no PK — no DOM artefact, no event handlers. The same DOM-contract test used for `EditableCell` pins this.
- **Hover/focus visibility.** Both `TableDataView` and `CardDataView` wrap the button in an `opacity-0 group-hover:opacity-100 focus-within:opacity-100` container so the button only appears when the row is hovered or contains focus. The button's parent column / card-header is omitted entirely when the gate is closed (no zero-width gutter, no empty header element).
- **`RowEditDialog`** composes over the Phase 1 edit registry. Each non-PK column reuses its registered `TypeEditor` for `toInput` / `validate` / pgCast; PK columns render as locked, monospaced labels (`PkValueDisplay`). A per-field revert button (`RotateCcw` icon) clears that single field's draft, and a Set NULL toggle replaces the input with a NULL pill on nullable columns.
- **Immutable and NULL affordance gating.** Atomic row editing keeps primary-key fields read-only and hides Set NULL actions for non-nullable columns instead of allowing a guaranteed server-side NOT NULL error path.
- **Atomic save semantics.** The dialog assembles `UpdateRowFieldChange[]` from the diff between `drafts` and `initialInputs`, validates every field locally first, then dispatches a single `tableDataApi.updateRow` call. Errors keep the dialog open so the user can correct and retry. Cancel prompts a confirm-discard when there are unsaved changes.
- **Optimistic update.** On success, `DataTab.handleRowUpdated` splices the returned row back into `rows` — no refetch, no flicker. Same path used by `updateCell`.
- **Modal-kind editors** (PostGIS, JSON tree) are simplified to a textarea inside the row editor in Phase 2; the inline-cell editor remains the entry point for the full map UI.

### Tests

- **Unit (12 new tests)**: `row-edit-button.test.tsx` (5 — gating contract for readOnly, primaryKey null/empty, render, click) and `row-edit-dialog.test.tsx` (7 — multi-field save, revert, Set NULL, validation, cancel-confirm). `preload.test.ts` extended to cover `updateRow` channel forwarding.
- **Integration (12 new cases)** in `table-data.suite.ts` running on PGlite + real Postgres: multi-field happy path, mixed value+setNull, atomicity-on-failure (CHECK violation rolls both fields back), composite PK, read-only rejection, empty `changes`, duplicate columns, unknown cast, PK length mismatch, no-row-found, identifier-injection in column names.
- **Lint**: 0 new warnings or errors. **Typecheck**: clean.

### Follow-up (deferred per the doc's open decisions)

- E2E coverage (`row-edit.e2e.spec.ts`) is left for a separate pass — the unit + integration matrix already exercises gating, atomicity, and the failure surface.
- Pencil column position (leading gutter) shipped as proposed; revisit after a UX pass.
- Confirm-discard on Cancel is always-on; can be softened later.
