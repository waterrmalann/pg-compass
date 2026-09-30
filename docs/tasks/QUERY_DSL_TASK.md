# Query DSL for the Data Tab

> **Status:** Complete
> **Scope:** Data tab only. The Query tab remains a raw, read-only SQL workspace.

## Summary

The Data tab's raw `WHERE` fragment is replaced by a small, table-scoped query language with three independent inputs:

1. **Filter**: which rows match (`status = 'active' AND score > 10`).
2. **Project**: which columns come back and what they are called (`id, display_name AS name`).
3. **Sort**: row order (`created_at DESC, name` or `created_at -1`).

The renderer parses and binds drafts for instant feedback and completion. The main process is the security boundary: on every row load, export and delete it re-parses the raw text, binds it to the relation's catalog columns inside the operation's transaction, and compiles SQL from closed internal enums, quoted catalog identifiers and positional parameters.

## Language

- **Filter:** `column op value`, `column [NOT] IN (v, …)`, `column IS [NOT] NULL`, joined by `AND`/`OR` with parentheses. `AND` binds tighter than `OR`. Operators: `= != <> > >= < <= LIKE ILIKE`.
- **Values:** single-quoted strings (`''` escapes a quote), numbers (kept as lossless text), `TRUE`/`FALSE`. Dates, UUIDs, enums and JSON are strings. Bare words are not values.
- **Identifiers:** unquoted names fold to lowercase; double-quoted names are exact (`""` escapes a quote). DSL keywords must be quoted to be used as columns.
- **Project:** `column [AS alias]`, comma-separated. Empty means all columns. Duplicate columns and duplicate output names are rejected.
- **Sort:** `column [ASC|DESC|1|-1]`, comma-separated. Missing primary-key columns are appended ascending for stable paging. Sort columns are qualified with the relation, so an alias never shadows them.
- Rejected with a field-specific error: comments, semicolons, newlines, casts, dollar quotes, functions, arithmetic, subqueries, `BETWEEN`, `NOT` outside `NOT IN`/`IS NOT NULL`, `NULLS FIRST/LAST`, implicit aliases, `*`.
- **Limits:** 10,000 characters per field, 200 filter nodes, nesting depth 32, 1,000 `IN` values, and no more projection or sort items than the relation has columns.

## Type families

| Family                                                                    | Filter operations                                      | Literal |
| ------------------------------------------------------------------------- | ------------------------------------------------------ | ------- |
| Text (`text`, `varchar`, `char`, `name`, `citext`, and domains over them) | equality, ordering, `IN`, `LIKE`, `ILIKE`, null checks | string  |
| Numeric                                                                   | equality, ordering, `IN`, null checks                  | number  |
| Temporal (date/time and interval)                                         | equality, ordering, `IN`, null checks                  | string  |
| Boolean                                                                   | equality, `IN`, null checks                            | boolean |
| Enum                                                                      | equality, ordering, `IN`, null checks                  | string  |
| UUID, JSONB                                                               | equality, `IN`, null checks                            | string  |
| JSON, arrays, ranges, geometric, network, vector, PostGIS, unknown types  | null checks only                                       | —       |

Domains, including domains over domains, inherit their base type's family.

## Implementation

- **Shared DSL module:** types, a hand-written tokenizer, a recursive-descent parser and a pure binder. Errors carry a stable code, the field and a source range. The binder suggests the closest column and explains mixed-case names that need quoting.
- **Main process:** a catalog loader (relation kind, columns, base-type family, primary key) and a compiler that returns select, where and order-by fragments plus parameters. Row loading runs catalog binding, count and page in one read-only transaction. Projected results return `primaryKey: null` and display-only column metadata. Export compiles the same query without pagination. Delete compiles only the filter, refuses views, and runs one parameterized `DELETE` in its own transaction, so a column changed since the preview fails closed.
- **IPC:** `getRows` takes `query` (`filter`, `projection`, `sort`) instead of `whereClause`; `deleteRows` takes `filter`; `exportData` accepts `query` alongside `schema` and `table`. A new `getQueryColumns` call returns the relation's columns and type families for completion and linting. Failures keep the `error` string and add a structured `failure` (`query-dsl` with errors, or `database`).
- **Renderer:** a focused CodeMirror editor for DSL fields (highlighting, type-aware completion that inserts safely quoted names, error ranges, Enter and Ctrl+Enter to apply, pasted newlines flattened). The toolbar keeps Filter visible and puts Project and Sort behind Query options, which shows an active count when collapsed. Drafts are separate from the active query: only a query that parses and binds in the main process becomes active (a PostgreSQL error on a valid query, such as an invalid date, uses the normal result error state), so invalid drafts never replace results, pagination or export and delete context. Stale responses are ignored. Projected results replace Add with a read-only notice.
- **Export and delete:** "Export selected query" is offered whenever any active field is non-empty and sends the DSL, not SQL. The delete dialog shows the active filter verbatim and previews complete rows with the active filter and sort.

## Deviations from the plan

- The binder is pure and lives in the shared module so the renderer can report semantic errors before a round trip. Catalog lookup and SQL compilation stay in the main process, which re-binds on every call.
- Completion metadata comes from a dedicated `getQueryColumns` call instead of the Structure tab's query, so both sides use the same catalog-based type families.
- Backslashes inside string literals are ordinary characters, since values are parameters. Backslashes outside strings are rejected.
- The codebase-consistency ADR's filtered-delete bullet was updated to describe the compiled, parameterized delete.

## Testing

Parser, binder, compiler, completion, editor and Data-tab behaviour have unit tests. The integration suite covers combined queries, type families, quoting, views, sort tie-breakers, rollback after conversion errors, export, delete, schema changes between preview and delete, and injection payloads, against both PGlite and PostgreSQL. A Playwright scenario drives filter, project, sort, inline errors and export in the packaged app.
