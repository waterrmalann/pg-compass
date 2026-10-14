# Schema Tree Size Estimates

## Status

Accepted

## Context

Connecting to a database loads its schema tree, including a row count and a size for every table (shown in the schema's table listing). The size used `pg_total_relation_size`, which stats every file of the table, its TOAST table and its indexes. With 1,500 tables on Windows that query took 69 s warm and over 3 minutes cold, so the sidebar, the database view and the ER diagram all waited on it. The row count was already a catalog estimate (`reltuples`).

## Decision

Estimate sizes from the catalog, like row counts: `relpages` of the table, its TOAST table and all their indexes, times `block_size`. Show the size as unknown (like the row count) until the table has been vacuumed or analyzed.

## Rationale

- `docs/PERFORMANCE.md`: metadata queries must not add load; row counts already use `reltuples`.
- The estimate reads only `pg_class` (57 ms for the same 1,500 tables) and is exact for the data pages as of the last VACUUM/ANALYZE.
- Both figures come from the same statistics, so they are consistent with each other.

## Consequences

- Sizes can lag behind recent writes until autovacuum or ANALYZE runs, and exclude the small free space and visibility map forks.
- A table that has never been vacuumed or analyzed shows no size.
- Covered by an integration test that compares the estimate with the actual relation sizes after `VACUUM ANALYZE`.
