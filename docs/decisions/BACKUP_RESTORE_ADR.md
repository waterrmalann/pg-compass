# Backup & Restore ADR

## Description

Developers debugging an issue often want a quick snapshot of a database before poking at it, or want to load a known dump into a local database. Backups were a v1 non-goal. A contribution added backup and restore to the Database Manager, and we chose to keep it as a small, optional feature rather than build a general migration or sync tool.

## Decision

- **Use the PostgreSQL client tools.** Backups run `pg_dump -Fc --no-owner --no-acl` and restores run `pg_restore --clean`. They are spawned from the main process with argument arrays (no shell). Positional paths cannot be read as options, and database names are passed so libpq cannot reinterpret them as connection strings.
- **The Database Manager has two tabs, Back up and Restore.** A `backupApi` preload bridge (channels prefixed `backup:*`) streams progress lines and supports cancellation. Only one run may touch a target database at a time.
- **Backups live in the app's `userData/backups` directory.** Each `.dump` has a `.json` sidecar with the source connection, database and timestamp. The list shows object counts read from the dump's own table of contents (`pg_restore --list`). Delete and inspect only accept paths inside that directory.
- **Restores are confined too.** A restore source must be in the backups directory or chosen through the backup file dialog, which approves that one path for that renderer, following the existing approved-path pattern.
- **Restores are guarded.**
  - They are refused while Read-only mode is on.
  - Restoring into a target whose connection label, host or database looks like production (a `prod` or `production` word) needs a typed confirmation. The main process enforces it.
  - The user can dump the target first.
- **Connection security matches the app's own connections.** SSL settings apply for both URI and field connections: `verify-full` when certificates are verified, `require` otherwise. CA, certificate and key PEMs are written to a private temporary directory with owner-only permissions and removed after the run.

## Rationale

`pg_dump`/`pg_restore` are the only tools that round-trip every PostgreSQL object faithfully. Reimplementing them would be large and fragile. Keeping the feature thin, confined and guarded keeps its risk proportional to its value.

## Status

Accepted (2026-09-27). This supersedes "database backups" as a non-goal in `PROJECT_CONTEXT.md`. Live database-to-database sync was prototyped in the same contribution and removed; it remains out of scope.

## Consequences

- Backup and restore need `pg_dump`/`pg_restore` on `PATH`, ideally matching the server's major version. The rest of the app stays zero-configuration.
- Verified SSL without a custom CA relies on `PGSSLROOTCERT=system`, which needs libpq 16 or newer. Older client tools fail closed.
- `--no-owner --no-acl` dumps are portable between servers but do not preserve ownership or grants.
- `pg_restore --clean` drops objects in the target before recreating them. The production confirmation and the optional pre-restore dump are the only safety nets.
- The production check is a name heuristic. It catches common naming, not every production database.
