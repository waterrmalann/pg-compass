# Plan: Rich SQL Editor with Syntax Highlighting & Autocomplete

> **Status: COMPLETED**

## Implementation Summary

Both plain inputs have been replaced with CodeMirror 6-powered `SqlEditor` components:

| Location | Component | Before | After |
|----------|-----------|--------|-------|
| query-tab.tsx | `QueryTab` | `<textarea>` | `<SqlEditor>` with line numbers, Ctrl+Enter submit |
| data-tab.tsx | `DataTab` | `<Input>` | `<SqlEditor singleLine>` with search icon overlay |

### New Files Created
- `src/components/sql-editor/pg-theme.ts` — Theme using CSS custom properties (auto dark/light)
- `src/components/sql-editor/use-codemirror.ts` — Hook managing CM lifecycle, value sync, schema compartment, linter
- `src/components/sql-editor/SqlEditor.tsx` — Reusable React wrapper

### Packages Added
- `@codemirror/view`, `@codemirror/state`, `@codemirror/lang-sql`, `@codemirror/autocomplete`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/search`, `@codemirror/lint`

### Features Delivered
- SQL syntax highlighting (PostgreSQL dialect)
- Schema-aware autocomplete using nested `SQLNamespace` format (schemas → tables → columns)
- `defaultSchema` / `defaultTable` support — tables and columns complete at top level in context
- Column completions show PostgreSQL data type as detail label (e.g. `text`, `int4`, `jsonb`)
- Identifier auto-quoting: non-lowercase identifiers (e.g. `CreatedAt`) insert as `"CreatedAt"` via custom `Completion.apply`
- SQL value-quote linter (`@codemirror/lint`): warns when double quotes are used for string values (e.g. `= "hello"`) with one-click fix to `= 'hello'`
- Ctrl+Enter to run queries
- Single-line mode (WHERE filter) with Enter suppressed
- Theme reads CSS variables — auto-follows dark/light mode
- Dynamic schema reconfiguration via CM Compartment API

### Architecture Decisions

- **Nested `SQLNamespace`** over flat `Record<string, string[]>` — gives CodeMirror proper hierarchy for dot-completion (`public.` → tables, `users.` → columns)
- **`CompletionColumn` type** (`{ name, type? }`) carries PG data type through to completions
- **`SAFE_IDENT` regex** (`/^[a-z_][a-z0-9_]*$/`) determines which identifiers need double-quoting
- **Linter over auto-insert** — rather than auto-inserting `= ''` or `= ` on column selection (too opinionated), a linter flags `"double-quoted"` values in operator positions and offers a fix action

---

## Original Plan

There were **two plain inputs** that needed upgrading:

| Location | Component | Current Element | Purpose |
|----------|-----------|----------------|---------|
| query-tab.tsx | `QueryTab` | `<textarea>` | Full SQL queries (SELECT only) |
| data-tab.tsx | `DataTab` | `<Input>` | WHERE clause filter |

No editor library exists in the project today. Schema/table names are available via `schemaCache` in the workspace hook; column names are fetched reactively from query results but not pre-cached.

---

### Library Choice: CodeMirror 6

**CodeMirror 6** is the right fit over Monaco. Rationale:

| Criteria | CodeMirror 6 | Monaco |
|----------|-------------|--------|
| Bundle size | ~150 KB (modular) | ~5 MB |
| Embeddability | Excellent — designed for embedding | Heavy, full IDE frame |
| SQL support | `@codemirror/lang-sql` with dialect configs | Needs custom language |
| Theming | CSS-in-JS theme objects, easy to match design tokens | Complex theme API |
| React integration | Lightweight via `useRef` + effects | Needs `@monaco-editor/react` wrapper |
| Project philosophy | Aligns with "fast, minimal, lightweight" | Overkill |

---

### Packages to Add

```
@codemirror/view          # Core editor view
@codemirror/state         # Editor state management
@codemirror/lang-sql      # SQL language (syntax highlighting + dialect-aware completions)
@codemirror/autocomplete  # Completion framework
@codemirror/commands       # Keybindings (defaultKeymap)
@codemirror/search        # Find/replace (optional, for query tab)
@codemirror/language      # Language infrastructure
```

All are peer packages of the same CodeMirror ecosystem. Total addition is ~150–180 KB gzipped.

---

### Architecture

```
src/components/
  sql-editor/
    SqlEditor.tsx          # Reusable React wrapper around CodeMirror 6
    use-codemirror.ts      # Hook: mounts CM instance, syncs value/onChange
    pg-theme.ts            # Dark theme mapped to design system CSS variables
    pg-completions.ts      # Custom completion source: schemas, tables, columns
```

#### Component API

```tsx
interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;            // Ctrl+Enter handler
  placeholder?: string;
  schema?: CompletionSchema;        // Schema metadata for autocomplete
  minHeight?: string;               // e.g. "96px" for query tab, "32px" for inline
  singleLine?: boolean;             // true for WHERE clause input (no line numbers)
  className?: string;
  readOnly?: boolean;
}

interface CompletionSchema {
  schemas: string[];
  tables: Record<string, string[]>;          // schema → table names
  columns: Record<string, ColumnInfo[]>;     // "schema.table" → columns
}
```

---

### Implementation Steps

#### Step 1 — Install dependencies

```bash
pnpm --filter desktop add @codemirror/view @codemirror/state @codemirror/lang-sql \
  @codemirror/autocomplete @codemirror/commands @codemirror/language @codemirror/search
```

#### Step 2 — Build the theme (pg-theme.ts)

Create a CodeMirror `EditorView.theme()` + `HighlightStyle` that reads from the app's CSS custom properties (`--background`, `--foreground`, `--muted`, `--ring`, etc.) so it automatically respects dark/light mode without duplication.

Key mappings:
- Editor background → `var(--background)` / `bg-background`
- Gutter → `var(--muted)` / slightly dimmed
- Selection → `var(--accent)` with opacity
- Keywords → bold, slightly tinted
- Strings → green-ish accent
- Numbers → blue-ish accent
- Autocomplete tooltip → `var(--popover)` + `var(--popover-foreground)`
- Cursor/caret → `var(--foreground)`
- Font → `JetBrains Mono, monospace` at `text-xs` (12px) to match current styling

#### Step 3 — Build custom completion source (pg-completions.ts)

Use `@codemirror/lang-sql`'s built-in `PostgreSQL` dialect which already provides:
- SQL keyword completions (SELECT, FROM, WHERE, JOIN, etc.)
- Syntax-aware completions based on cursor context

Layer on top of that a **custom schema completion source** via the `schema` option of `sql()`:

```ts
import { sql, PostgreSQL } from '@codemirror/lang-sql';

// The lang-sql package accepts a `schema` config:
sql({
  dialect: PostgreSQL,
  upperCaseKeywords: true,
  schema: {
    // "schema.table": ["col1", "col2", ...]
    // This is the exact format @codemirror/lang-sql expects
  },
});
```

This is the simplest path — `@codemirror/lang-sql` natively supports schema-aware completions when you feed it a `schema` map. No need to write a custom completion source from scratch.

#### Step 4 — Build the React wrapper (SqlEditor.tsx + use-codemirror.ts)

The `use-codemirror` hook:
1. Creates an `EditorState` with extensions (theme, SQL language, keybindings, completions)
2. Mounts `EditorView` into a container ref on mount
3. Uses `EditorView.dispatch` to sync external `value` prop → CM state (avoiding loops)
4. Uses `EditorView.updateListener` to emit `onChange` when CM state changes
5. Reconfigures the `sql()` extension's `schema` compartment when `CompletionSchema` prop changes (using CM's `Compartment` API for dynamic reconfiguration)
6. Cleans up on unmount

The `SqlEditor` component:
- Renders a `<div ref={containerRef}>` that CM mounts into
- Styled with Tailwind classes for border, rounding, focus ring (matching shadcn `<Input>` / `<textarea>` look)
- `singleLine` mode: hides line numbers/gutters, sets `min-height: 32px`, disables Enter (newline)
- Full mode: shows line numbers, allows resize, sets `min-height: 96px`

#### Step 5 — Cache column metadata for autocomplete

Currently `schemaCache` has schema names and table names, but **not column names**. Two options:

**Option A (recommended):** Lazy-fetch columns on tab open.  
When a table viewer tab opens (or the query tab mounts), call the existing `getStructure` IPC to fetch columns for the current table and cache them in component-local state. Pass them into `CompletionSchema.columns`. This is already nearly free since `getStructure` is called by the Structure tab anyway — just lift the cache.

**Option B:** Eagerly fetch columns for all tables in a schema.  
Add a new IPC `table-data:get-all-columns` that returns all column names for all tables in a schema at once. Better completions but heavier upfront cost. Not aligned with v1 "fast over feature-heavy" philosophy.

**Recommendation:** Start with Option A. The user is already focused on one table, so having columns for that table is the most valuable. Schema/table name completions from `schemaCache` cover cross-table references. Option B can be added later if needed.

#### Step 6 — Replace `<textarea>` in query-tab.tsx

```diff
- <textarea
-   className="min-h-24 w-full resize-y rounded-md border ..."
-   value={sql}
-   onChange={(e) => setSql(e.target.value)}
-   onKeyDown={handleKeyDown}
-   spellCheck={false}
- />
+ <SqlEditor
+   value={sql}
+   onChange={setSql}
+   onSubmit={handleRun}
+   placeholder="Write a SELECT query…"
+   schema={completionSchema}
+   minHeight="96px"
+ />
```

Remove the manual `handleKeyDown` for Ctrl+Enter — that's now handled inside the editor via CM keybindings.

#### Step 7 — Replace `<Input>` in data-tab.tsx

```diff
- <Input
-   placeholder="WHERE clause — e.g. id > 10 AND status = 'active'"
-   className="h-8 pl-7 font-mono text-xs"
-   value={pendingWhere}
-   onChange={(e) => setPendingWhere(e.target.value)}
- />
+ <SqlEditor
+   value={pendingWhere}
+   onChange={setPendingWhere}
+   placeholder="WHERE clause — e.g. id > 10 AND status = 'active'"
+   schema={completionSchema}
+   singleLine
+   minHeight="32px"
+ />
```

The search icon can be placed as a sibling positioned element, same as today.

---

### Completion Behavior

| Context | Completions offered |
|---------|-------------------|
| After `SELECT` | Column names of current table, `*`, SQL functions |
| After `FROM` / `JOIN` | Schema-qualified table names (`public.users`) |
| After `WHERE` / `AND` / `OR` | Column names of current table |
| After `.` (dot) | Columns of the preceding table, or tables of the preceding schema |
| General typing | SQL keywords (uppercase), table names, schema names |

All of this is handled natively by `@codemirror/lang-sql` when configured with the `PostgreSQL` dialect and a `schema` map — no custom completion logic needed for v1.

---

### Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| CodeMirror adds bundle weight | Modular imports keep it to ~150KB gzipped; acceptable for a desktop app |
| CM's controlled-value pattern causes cursor jumps | Use the standard CM React pattern: only dispatch external updates when the source-of-truth differs from CM's internal state |
| Theme drift from design system | Theme reads CSS variables at runtime, so it auto-updates with light/dark toggle |
| Electron CSP blocks CM's style injection | CM uses `document.createElement('style')` — this works fine with Electron's default CSP; no `unsafe-inline` issues since it's a local app |
| Performance with large schema maps | `@codemirror/lang-sql`'s completion is efficient; for very large DBs (1000+ tables), consider debouncing or limiting the schema map to the active schema only |

---

### What This Does NOT Include (future enhancements)

- **Inline error highlighting** (red squiggles for syntax errors) — would need a SQL parser like `pgsql-ast-parser`; skip for v1
- **Multi-cursor editing** — comes free with CM but not essential to expose
- **Query formatting / prettify** — could add via `sql-formatter` library later
- **Query history / snippets** — separate feature, orthogonal to the editor

### Notes

- `keymap.of([
  {
    key: "Enter",
    run: () => true
  }
])` for single line mode to disable newlines but keep autocomplete working on Enter
- Do not recreate the editor on every value change. use updateListener and dispatch
- lang-sql supports schema completion but it expects a specific format, so we need to transform our `schemaCache` + columns into that format before passing it in.

---

### Estimated File Changes Summary

| File | Change |
|------|--------|
| package.json | Add 7 `@codemirror/*` dependencies |
| `apps/desktop/src/components/sql-editor/SqlEditor.tsx` | **New** — React component |
| `apps/desktop/src/components/sql-editor/use-codemirror.ts` | **New** — CM lifecycle hook |
| `apps/desktop/src/components/sql-editor/pg-theme.ts` | **New** — Theme definition |
| query-tab.tsx | Replace `<textarea>` with `<SqlEditor>`, build `CompletionSchema` from props + cached columns |
| data-tab.tsx | Replace `<Input>` with `<SqlEditor singleLine>`, build `CompletionSchema` |

No IPC or backend changes required for v1 — all needed data (`schemaCache`, `columns` from `getStructure`) is already available.