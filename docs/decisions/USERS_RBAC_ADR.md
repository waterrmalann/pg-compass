# Users & RBAC Management ADR

## Description

Developers occasionally need to adjust PostgreSQL principals on a server they are already connected to: create a read-only role for an analytics tool, grant a login access to one database, rotate a password, or check who is superuser. Sending these small actions to psql or pgAdmin breaks the "open, fix, close" workflow PG Compass optimises for.

PostgreSQL models users and groups as one concept (`pg_roles`). A role with `rolcanlogin` is a user; otherwise it is a group role other roles can be members of. Privileges are layered: role attributes, memberships (`pg_auth_members`), and per-database grants.

## Decision

Add a **Users** workspace view backed by a `rolesApi` preload bridge (channels prefixed `roles:*`) that operates on the active connection.

- **Enforcement lives in the main process.** Every mutation is validated in `ipc-validation.ts`, re-checks `pg_roles.rolsuper` on the live connection, and is refused while Read-only mode is on. Multi-statement mutations (create, alter, clone) run in a single transaction.
- **Passwords never appear as plaintext SQL.** The main process computes a SCRAM-SHA-256 verifier and sends that as the `PASSWORD` literal, so servers that log DDL do not record the secret.
- **Identifiers are quoted, not restricted.** Any non-empty name up to 63 bytes without NUL is accepted and always passed through `quoteIdent`.
- **One snapshot round trip.** `roles:get-snapshot` returns the current user, visible roles, memberships and the selected role's per-database access. Non-superusers only receive their own role, memberships and privileges.
- **Views.** Users & roles (role list and a detail pane with Attributes, Roles, Database access and Effective permissions), Databases (summary cards), Triggers (superuser-only enable/disable per trigger or all at once; no create or drop), and Audit log (a local, per-connection log of administrative actions, capped at 5,000 entries, never containing passwords).
- **Database access has three levels**: no access, read only, read + write. They abstract the `GRANT`/`REVOKE` cascade across every non-system schema in that database (tables, sequences and default privileges), with an optional "restrict to tables" list.
- **Predefined `pg_*` roles are hidden** while Hide internal schemas is on.
- **The sidebar footer** shows a compact roles summary for the active connection that opens the Users view.

## Rationale

- Server-side superuser, read-only and validation checks defend against a tampered renderer; UI gating only controls discoverability.
- Transactions keep a failed `GRANT` from leaving a half-created role.
- SCRAM verifiers are what PostgreSQL stores anyway, so computing them client-side (as `psql \password` does) is behaviour-neutral and keeps secrets out of server logs.
- Per-database grants reuse one shared helper that opens a short-lived client against the target database, so backup/restore and RBAC share connection handling.

## Status

Accepted. Revised 2026-09-27 after the initial contribution was audited (read-only enforcement, transactions, SCRAM, relaxed identifiers, triggers reduced to enable/disable).

## Consequences

- There is no undo: `DROP ROLE` is final. PostgreSQL's ownership checks refuse unsafe drops.
- Restricting a database revokes `CONNECT` from the role only. If `PUBLIC` still has `CONNECT`, the role can still connect; we do not revoke from `PUBLIC` to avoid lockouts.
- Access levels cover schemas that exist when they are applied; schemas created later need the level re-applied. Default privileges for future tables only cover tables created by the connected role, not by other roles such as migration users.
- `pg_roles` is readable by every login, so snapshot filtering for non-superusers is a UX boundary, not a secrecy guarantee.
- A database the app cannot reach is shown as no access rather than failing the snapshot.
- "Has password" is only known for superusers (`pg_authid`); others see "unknown".
- Trigger enable/disable shares its SQL with the table viewer's Triggers tab.
