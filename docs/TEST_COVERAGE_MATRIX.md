# Test Coverage Matrix

This matrix tracks which currently implemented behaviors are covered by unit, integration, and Playwright tests.

| Capability                                                                                           | Unit / Component | Integration                                              | Playwright |
| ---------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------- | ---------- |
| Connection store persistence and favourites                                                          | Yes              | No                                                       | Indirect   |
| Connection form parsing, validation, and certificate/key file picking                                | Yes              | No                                                       | Indirect   |
| Settings persistence and theme state                                                                 | Yes              | No                                                       | Yes        |
| Workspace tab state and schema caching                                                               | Yes              | No                                                       | Indirect   |
| Preload API contract, including connection file dialog, roles, backup                                | Yes              | No                                                       | Indirect   |
| Query read-only guards and pagination helpers                                                        | Yes              | Yes, via PGlite and PostgreSQL                           | Yes        |
| Export SQL and CSV formatting helpers                                                                | Yes              | No                                                       | Yes        |
| Table row loading                                                                                    | No               | Yes, via PGlite and PostgreSQL                           | Yes        |
| Data-tab query DSL (parse, bind, compile, toolbar, export, delete)                                   | Yes              | Yes, via PGlite and PostgreSQL                           | Yes        |
| Cell edit (text, json, postgis)                                                                      | Yes              | Yes, via PGlite (postgis gated on PostgreSQL)            | Yes        |
| Enum metadata and dropdown editing                                                                   | Yes              | Yes, via PGlite and PostgreSQL                           | Indirect   |
| Read-only-mode gate (no edit affordance in DOM)                                                      | Yes              | Yes                                                      | Yes        |
| Data grid scrolling (one scroll box, sticky header and gutter)                                       | No               | No                                                       | Yes        |
| Structure, index, and constraint metadata                                                            | No               | Yes, via PGlite and PostgreSQL                           | Partial    |
| Schema tree (tables, views, estimated row counts and sizes)                                          | No               | Yes, via PGlite and PostgreSQL                           | Indirect   |
| Connection-to-schema navigation flow                                                                 | No               | No                                                       | Yes        |
| Ctrl+R in editors does not reload the window                                                         | No               | No                                                       | Yes        |
| ER diagram (catalog snapshot, layout, culling, find, select, drag)                                   | Yes              | Yes, via PGlite and PostgreSQL                           | Yes        |
| Export and import progress throttling                                                                | Yes              | No                                                       | Indirect   |
| Import (streamed CSV/JSON, chunk boundaries, exact numbers, typed values, atomic batches)            | Yes              | Yes, via PGlite and PostgreSQL                           | No         |
| Query tab execution                                                                                  | No               | Yes                                                      | Yes        |
| Export flow (relation, raw SQL read-only, COPY dump, partial-file cleanup)                           | No               | Yes, via PGlite and PostgreSQL                           | Yes        |
| Role DDL (SCRAM passwords, atomicity, read-only gate, trigger toggle, access-level and table grants) | Yes              | Yes, via PGlite; sign-in and access levels on PostgreSQL | No         |
| Backup/restore guards (paths, conninfo, SSL env, production confirm, run locks, cancel, exit codes)  | Yes              | No                                                       | No         |
| Users view, triggers pane, backup/restore tabs, sidebar roles summary                                | Yes              | No                                                       | No         |
| `.env` paste parsing                                                                                 | Yes              | No                                                       | No         |

## Current Gaps

Still targeted for expansion:

- direct IPC handler registration tests for `settings-ipc.ts` and `table-data-ipc.ts` (`connection-ipc.ts` covers only the connection test handler)
- deeper Playwright coverage for create, edit, delete, and keyboard tab shortcuts
- renderer component tests for table pagination and query result mode switching
- end-to-end `pg_dump`/`pg_restore` runs
