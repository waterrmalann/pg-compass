## Feasibility: Searchable FK dropdown

**Status:** Implemented (2026-05-05)

Yes — fully feasible, and the building blocks are already in place. Quick read of the codebase:

- FK metadata is already discoverable. [main/table-data-meta.ts:148](apps/desktop/src/main/table-data-meta.ts:148) (`getConstraints`) returns `foreignTable` (schema-qualified) and `foreignColumns` per constraint via `pg_constraint`. No new pg-catalog work needed.
- `ColumnInfo` already carries side-channel metadata (`enumLabels`, `enumPgCast`) that `getRows` populates per query. Adding `foreignKey` follows the exact same pattern.
- `RowEditDialog` and `EditableCell` both look up a `TypeEditor` via the registry. We can short-circuit at the registry call site when the column has FK metadata, returning a dedicated FK editor instead of the type-default.
- IPC contract is uniform — adding a `SEARCH_FK` channel mirrors `UPDATE_CELL` / `UPDATE_ROW`.

**Risks / open product questions:**

1. **No "display column" concept in Postgres.** We have to pick something to show next to the PK. Heuristic + override is the only realistic answer.
2. **Composite FKs.** Rare; v1 should fall back to the plain editor when `foreignColumns.length > 1`.
3. **Permissions.** If the user can't `SELECT` the parent table, the dropdown should fail soft to the plain editor with a tooltip.
4. **Result-set size.** Tables with millions of rows need server-side LIMIT + ILIKE — never client-side filtering.

---

## Plan (Phase 3 — FK picker)

### Scope

- **In:** Single-column FKs on Data-tab edits (both `EditableCell` and `RowEditDialog`). Searchable, paginated, with a label heuristic and a clearly-shown PK.
- **Out (v1):** Composite FKs, query-tab edits, write-back of the _referenced_ row, "create new referenced row" inline, custom per-column label override (defer to settings later).

### Architecture

#### 1. Carry FK metadata on `ColumnInfo`

[shared/types/table-data.ts](apps/desktop/src/shared/types/table-data.ts):

```ts
export interface ForeignKeyRef {
  schema: string;
  table: string;
  /** Single-column FK in v1 — composite ⇒ undefined (falls back). */
  column: string;
  /** Heuristic-picked display column on the parent table; null when none found. */
  labelColumn: string | null;
  /** pg type of the value column, used for the cast on the search query. */
  valuePgCast: string;
}

export interface ColumnInfo {
  // …existing
  foreignKey?: ForeignKeyRef;
}
```

Resolution lives in [main/table-data-rows.ts](apps/desktop/src/main/table-data-rows.ts) next to PK and enum resolution. One catalog query joins `pg_constraint` (where `contype = 'f'` and exactly one entry in `conkey`) onto the result columns; second pass picks each parent's label column.

**Label-column heuristic (run once per parent table, session-cached):**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = $1 AND table_name = $2
  AND data_type IN ('text','character varying','character','citext')
  AND lower(column_name) ~ '^(name|title|label|email|slug|code|description|display_name)$'
ORDER BY array_position(
  ARRAY['name','display_name','title','label','email','slug','code','description'],
  lower(column_name)
)
LIMIT 1;
```

If no match, `labelColumn = null` and the dropdown shows just the PK.

#### 2. New IPC: `SEARCH_FK`

[shared/types/table-data.ts](apps/desktop/src/shared/types/table-data.ts):

```ts
export interface SearchForeignKeyParams {
  connectionId: string;
  schema: string;
  table: string;
  valueColumn: string;
  labelColumn: string | null;
  query: string; // user's search text; '' = first page
  limit: number; // default 50, max 200
}

export interface ForeignKeyOption {
  value: unknown; // the PK value (typed via buildTypeMap)
  label: string | null; // null when there is no label column
}

export interface SearchForeignKeyResult {
  options: ForeignKeyOption[];
  /** True when more rows exist beyond `limit` — surfaced as a "refine search" hint. */
  hasMore: boolean;
}
```

Handler in `main/table-data-rows.ts` (or a new `table-data-fk.ts` to keep the file small):

```sql
SELECT
  <quoteIdent(valueColumn)> AS value
  <, quoteIdent(labelColumn) AS label>?
FROM <quoteIdent(schema)>.<quoteIdent(table)>
WHERE
  <quoteIdent(valueColumn)>::text ILIKE $1
  <OR quoteIdent(labelColumn) ILIKE $1>?
ORDER BY <labelColumn ?? valueColumn>
LIMIT $2
```

`$1 = '%' || query || '%'`. We fetch `limit + 1`, set `hasMore = rows.length > limit`. No write path — read-only mode does **not** gate this.

#### 3. FK editor in the registry

`components/workspace/renderers/edit-registry.ts` gains a factory:

```ts
function makeForeignKeyEditor(
  fk: ForeignKeyRef,
  valueEditor: TypeEditor,
): TypeEditor {
  return {
    kind: "modal", // dropdown is large enough; reuse modal slot
    toInput: valueEditor.toInput,
    validate: valueEditor.validate, // value still validated as the underlying type
    Component: ForeignKeyComboboxEditor, // new
  };
}
```

Resolution flow at the call site: when `col.foreignKey` is present and single-column, wrap the underlying type editor with `makeForeignKeyEditor`. Otherwise, current behavior.

#### 4. `ForeignKeyComboboxEditor`

New file `components/workspace/renderers/foreign-key-editor.tsx`. Uses `cmdk` (already shipped via shadcn) — a popover anchored to the cell with:

- Search input at top.
- Result list: `<label> · <value>` per row, monospace value, dimmed when label is missing.
- An always-present "(NULL)" entry at the top when the column is nullable.
- "Showing 50 of N — refine to narrow" footer when `hasMore`.
- "Use raw value…" escape hatch that swaps to the plain inline editor (covers permission failures and edge cases).

Debounce search at 200ms. Cancel in-flight queries on each keystroke (AbortController-style by tracking the latest request id).

Selecting an option commits via the existing `EditResult` shape — no special path through `updateCell` / `updateRow`.

#### 5. Row-editor integration

`row-edit-dialog.tsx` already routes through the registry and renders `kind: 'modal'` editors as a textarea today. Detect `foreignKey` and render the combobox inline (as a popover trigger inside the field row) instead of dropping to a textarea. One small branch in `FieldEditor`.

### File-by-file change map

| File                                                    | Change                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/types/table-data.ts`                            | Add `ForeignKeyRef`, `SearchForeignKeyParams`, `ForeignKeyOption`, `SearchForeignKeyResult`, `SEARCH_FK` channel; extend `ColumnInfo.foreignKey?` |
| `main/table-data-rows.ts`                               | Resolve single-column FK metadata and label column alongside PK / enums                                                                           |
| `main/table-data-fk.ts`                                 | **New.** `searchForeignKey` handler                                                                                                               |
| `main/table-data-ipc.ts`                                | Wire `SEARCH_FK`                                                                                                                                  |
| `preload.ts`, `electron.d.ts`                           | Expose `tableDataApi.searchForeignKey`                                                                                                            |
| `components/workspace/renderers/edit-registry.ts`       | `makeForeignKeyEditor` factory; resolution helper                                                                                                 |
| `components/workspace/renderers/foreign-key-editor.tsx` | **New.** cmdk-based combobox                                                                                                                      |
| `components/workspace/table-viewer/editable-cell.tsx`   | Route to FK editor when `col.foreignKey` is set                                                                                                   |
| `components/workspace/table-viewer/row-edit-dialog.tsx` | Same — render combobox inline for FK fields                                                                                                       |

### Tests (tests-first, same bar as Phase 1/2)

- **Unit**: label-column heuristic ranking; FK editor renders combobox; selecting commits with the right pgCast; Set NULL still works; permission-error fallback shows raw editor; debounce cancels stale requests.
- **Integration**: `searchForeignKey` happy path on `app.users.id` from `app.orders.user_id`; ILIKE on label column; `hasMore` boundary; composite FK ⇒ no metadata (falls back); identifier injection on schema/table/column; revoked SELECT ⇒ error surfaces.
- **End-to-end**: `getRows` carries FK metadata; row editor renders FK combobox for `orders.user_id`, search narrows, save sends correct value.

### Rollout

1. Tests + types first.
2. FK metadata in `getRows` (read-side only — nothing else changes).
3. `searchForeignKey` handler + IPC + preload.
4. `ForeignKeyComboboxEditor` + registry wiring.
5. Row editor + cell editor branches.
6. Doc + Implementation Notes.

---

## Implementation Notes

- `ColumnInfo.foreignKey` is populated for single-column foreign keys during `getRows`. Composite foreign keys intentionally fall back to the existing raw type editor.
- FK label selection uses a small ordered heuristic over non-null text-like parent columns such as `name`, `display_name`, `title`, `email`, `slug`, and `code`. If no label column matches, the picker shows only the referenced value.
- `searchForeignKey` lives in the main process and performs server-side `ILIKE` search over the referenced value column and optional label column. It fetches `limit + 1` rows to expose `hasMore` without loading large parent tables client-side.
- The renderer ships a compact `ForeignKeyPicker` plus `ForeignKeyModalEditor` adapter. Inline cell edit opens the picker through the existing modal editor path; row edit renders the same picker inside the row dialog.
- The shipped picker does not use `cmdk`; the current UI is a simple input plus bounded result list, matching the app's compact data-first design. The raw editor remains the fallback when FK metadata is absent or unsupported.
- Coverage added: unit tests for picker debounce, result selection, null option, errors, and modal save; integration tests for FK metadata, label-less parents, search filtering, `hasMore`, and identifier injection.
