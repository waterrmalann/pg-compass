# JSON and JSONB in the Query DSL

> **Status:** Complete (all five phases)
> **Builds on:** [Query DSL for the Data Tab](QUERY_DSL_TASK.md). Same security model, same three fields, no new UI surfaces.

## Summary

Before this task, a `jsonb` column only supported whole-value `=`, `!=`, `IN` and null checks, and a `json` column only supported null checks. That wasn't enough to look inside documents, which is the main reason people open the card view.

This task adds MongoDB-style **dot paths** (`payload.status`, `payload.items.0.sku`) to Filter, Sort and Project. It also adds two word operators, **`CONTAINS`** and **`HAS`**, which map to PostgreSQL's `@>` and `?`. Comparisons are type-aware, so `payload.count > 10` compares numbers, and a row whose value has a different JSON type is never matched and never causes an error.

```
payload.status = 'active' AND payload.retries >= 3
payload.items.0.sku ILIKE 'ab-%'
payload.deleted_at IS NULL
payload CONTAINS '{"plan": "pro"}'
tags HAS 'urgent'
```

## Language

### Paths

- A path is a column followed by one or more `.segment`s, with no spaces around the dots: `payload.address.city`.
- **Key segments** are words or double-quoted names. Keys are **case-sensitive as typed** (`payload.userId` looks up `userId`), unlike column names, which still fold to lowercase. Quote a key that has spaces, dots, hyphens or other symbols: `payload."content-type"`. DSL keywords are fine as keys (`payload.desc`), because the position makes the meaning clear.
- **Index segments** are unsigned integers: `items.0`. To use a key that is all digits, quote it: `payload."2024"`.
- Paths are only allowed on `json` and `jsonb` columns, including domains over them. Any other column gets a `path-not-supported` error naming its type.
- Limits: at most 16 segments per path, and index segments must fit in a 32-bit integer.

### What each target supports

| Target                         | Operations                                     | Literals                       | Meaning                                                                                                                                       |
| ------------------------------ | ---------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Whole `json`/`jsonb` column    | `=`, `!=`, `IN`, `NOT IN`                      | string (JSON text)             | Unchanged: compares the whole document. Key order and whitespace don't matter.                                                               |
| Whole column or path           | `CONTAINS`                                     | string (JSON text)             | The value contains this JSON (`@>`). The text must be valid JSON; it is checked as you type.                                                  |
| Whole column or path           | `HAS`                                          | string                         | The object has this top-level key, or the array has this string element (`?`).                                                                |
| Path                           | `=`, `!=`, `IN`, `NOT IN`                      | string, number, boolean        | Typed comparison: `'10'` matches the JSON string `"10"`, not the number `10`. `10` also matches `10.0`.                                        |
| Path                           | `>`, `>=`, `<`, `<=`                           | string, number                 | Only matches values of the literal's JSON type, so `payload.count > 10` skips rows where `count` is a string or a boolean.                     |
| Path                           | `LIKE`, `ILIKE`                                | string                         | Only matches JSON string values, using their text.                                                                                            |
| Column                         | `IS [NOT] NULL`                                | —                              | Unchanged: SQL `NULL`.                                                                                                                        |
| Path                           | `IS [NOT] NULL`                                | —                              | `IS NULL` matches a missing key or a JSON `null`, as MongoDB does. `IS NOT NULL` matches the opposite.                                          |

- `!=` and `NOT IN` keep SQL behaviour: a row where the key is missing doesn't match, just as a `NULL` column doesn't match `!=` today.
- To compare an object or an array, use `CONTAINS` (`payload.address CONTAINS '{"city": "Pune"}'`). On a path, a quoted string is always a JSON string value.
- `CONTAINS` and `HAS` are **contextual operator words**. They only mean something right after a column or path, so columns named `contains` or `has` keep working without quotes.
- PostgreSQL operator spellings are rejected, and the error suggests the DSL form: `->`, `->>` and `#>` suggest dot paths, `@>` suggests `CONTAINS`, and `?` suggests `HAS`.

### Sort and Project

- **Sort:** `payload.priority DESC`. Values are ordered by PostgreSQL's `jsonb` ordering, which never raises an error on mixed types. Primary-key tie-breakers are still added. Sorting by a path leaves rows editable, because the select list is unchanged.
- **Project:** `payload.status`, or `payload.status AS status`. The output name defaults to the path as typed, and duplicate output names are rejected as they are today. Values come back as `jsonb`, so the existing JSON renderers, card view and export handle them. Projected results stay read-only.
- **Exclusions take whole columns only:** `-payload.secret` is an error.

### `json` columns

`json` columns join the `jsonb` family. The compiler converts them to `jsonb` before applying any operator, so they get the same features. This is a per-row conversion with no index support, which is acceptable for a viewer. It is documented next to the index note below.

## Compilation

- Every key, index and literal is a positional parameter. JSON type names and the `jsonb` conversion come from closed internal enums. No user text is ever spliced into SQL.
- A path compiles to a chain of `->` steps, with each key passed as a text parameter and each index as an integer parameter. Typed comparisons convert the literal to `jsonb`. Ordering and `LIKE`/`ILIKE` also check the value's JSON type first.
- Paths in Sort and Project add parameters outside the `WHERE` clause. The compiled query will keep two parameter lists: filter parameters first (`$1…$k`), followed by the select-list and order-by parameters. The count query and delete use only the filter parameters. The page query, export and SQL preview use all of them. Without this split, the count query would send parameters it doesn't reference, and PostgreSQL would reject them.
- **Index use:** `CONTAINS` and `HAS` on a whole `jsonb` column can use a GIN index. Path comparisons generally scan the table. The plan accepts that, matching how plain Filter conditions don't promise index use today, but adds a short note to the docs suggesting `CONTAINS` for large tables.

## Phases

Each phase can ship on its own. All five are done.

1. **Paths in Filter.** Tokenizer: a `.` directly after a column or segment is a path separator. Word tokens keep their raw spelling so keys stay case-sensitive. Add hint errors for PostgreSQL JSON operators. Parser: introduce a field reference (column plus path) wherever a column is accepted in Filter. Binder: path rules, the literal and operator rules for each target, and the `path-not-supported` error code. Compiler: path expressions and typed comparisons. Catalog loader: map `json` to the JSON family.
2. **`CONTAINS` and `HAS`.** Parser support for the contextual operator words. The binder validates `CONTAINS` JSON and reports an `invalid-json` error over the string's range.
3. **Paths in Sort and Project.** Parser and binder support, the output-name rule, the exclusion error, and splitting the parameter lists in the compiler and its consumers (row loading, export, SQL preview, delete).
4. **Editor.** Highlight dots and the operator words. Completion offers `CONTAINS`/`HAS` after JSON columns, and the path operators after a path.
5. **Key completion (optional).** After `payload.` or `payload.address.`, suggest keys sampled from the first few hundred rows. This needs a new read-only IPC call that checks the column against the catalog, runs under the usual statement timeout, and is cached per tab and path. Skipping it doesn't block the other phases.

## Out of scope

- JSONPath (`@?`, `@@`), `<@`, `?|` and `?&`. Use `OR` with `HAS`, or the Query tab.
- MongoDB-style array matching, where `tags = 'a'` would match an array containing `a`. Use `HAS` or `CONTAINS`.
- Excluding paths in Project, and editing values through a path.
- Compiling path equality into an index-friendly form (`->>` or `@>`).
- `json[]`/`jsonb[]` columns and `hstore`.

## Testing

- **Unit:**
  - Tokenizer: dot adjacency, quoted and numeric segments, raw spelling of keys, operator hint errors.
  - Parser: field references in all three fields, contextual operator words, columns named `contains`/`has`.
  - Binder: family errors, literal kinds for each operator, `invalid-json` ranges, path limits, output names, the exclusion error.
  - Compiler: SQL shape, parameter order, and the filter versus full parameter lists.
  - Completion.
- **Integration (PGlite and PostgreSQL):**
  - Typed equality, and ordering that skips mixed types.
  - Missing keys versus JSON `null`, and array indexes.
  - `CONTAINS` and `HAS` on whole columns and on paths.
  - `json` columns and domains over `jsonb`.
  - Sort by path with paging and Skip/Limit counts.
  - Projected paths.
  - Export and its SQL preview, and delete with a path filter.
  - Injection-shaped keys: quotes, backslashes, `$1`, Unicode.
- **E2E:** one Playwright step that filters and sorts by a path.

## Implementation

- **Shared DSL module:** the tokenizer emits a dot token only when `.` directly follows a column or segment, and word tokens keep their raw spelling for keys. The parser reads a column plus its path wherever a column is accepted, and treats `CONTAINS`/`HAS` as operators only in operator position. The binder resolves the path, flags `json` columns for conversion, and checks each operator's literal kinds. Projected paths are named as typed.
- **Main process:** the compiler turns a path into a `->` chain of key and index parameters and adds the JSON type checks described above. `CompiledDataQuery` carries the filter's parameters separately, and row counts and delete use only those. The catalog loader maps `json` to its own family, which has the same capabilities as `jsonb`.
- **Key completion:** a `getJsonKeys` IPC call checks the column against the catalog and returns up to 200 distinct object keys. They are sampled from the first 500 rows where the column isn't null, in a read-only transaction with a 5-second statement timeout. The Data tab caches results per column and path until the table is refreshed, and failed lookups aren't cached.
- **Editor:** completion offers `CONTAINS`/`HAS` for JSON columns and every path operator after a path. Right after a dot, it shows keys loaded asynchronously, quoted where needed. Highlighting colours segments after a dot as keys, even when they spell a keyword. The Project hint mentions paths.

## Deviations from the plan

- Project and Sort count paths separately from whole columns. Whole-column items are still capped at the relation's column count, and each field allows at most 100 paths.
- A path sort never stands in for a primary-key tie-breaker, even when it sorts inside the key column.
- Sorting a whole `json` column now works, because it is converted to `jsonb`. Before, PostgreSQL rejected it because `json` has no ordering operator.
- Completion now finds an unclosed quoted name with the tokenizer instead of a regular expression, which used to mistake `"a b".na` for an open quote.

## Testing

- Unit tests cover the tokenizer, parser, binder, compiler, completion, the editor's async key completion, IPC validation and preload. All DSL unit tests pass.
- The new integration tests pass on both PGlite and PostgreSQL 18. They cover typed comparisons, missing keys, indexes, `CONTAINS`/`HAS`, `json` columns, domains, path sorting with Skip/Limit, projection, export and its SQL preview, delete, key sampling, and injection-shaped keys.
- A Playwright scenario filters and sorts by a path and checks live key completion. It passes against the production bundle. Like the existing Data-query scenario, it can't attach to the packaged binary on this machine, because the packaged app disables Electron's inspect fuse, which Playwright's `electron.launch` needs.
