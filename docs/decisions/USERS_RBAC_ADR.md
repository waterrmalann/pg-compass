# Users & RBAC Management ADR

## Title

Users, roles, and database access management inside PG Compass.

## Status

Accepted

## Context

Developers using PG Compass occasionally need to inspect or adjust the
PostgreSQL principals on a server they are already connected to — create a
read-only role for an analytics tool, grant CONNECT on a specific database to a
new login role, rotate a password, or audit who has superuser rights. Routing
these small actions through a separate tool (psql, pgAdmin) breaks the "open
the sidebar, fix the problem, close the app" workflow PG Compass optimises for.

PostgreSQL models users and groups as a single concept — `pg_roles`. A role
with `rolcanlogin = true` is a user; otherwise it is a group role that bundles
privileges other roles can be granted membership in. RBAC is layered: login
attributes, group memberships via `pg_auth_members`, and per-database
privileges via `GRANT CONNECT / GRANT SELECT ON TABLES / ...`.

## Decision

Add a first-class **Users** workspace view and an IPC layer that operates on
the connection the active workspace tab belongs to.

- The renderer talks to a new `rolesApi` exposed through the preload (channels
  prefixed `roles:*`). All mutations are validated on the main process through
  `ipc-validation.ts` and every admin-only handler re-checks
  `pg_roles.rolsuper` on the live connection before executing `GRANT`,
  `REVOKE`, `CREATE ROLE`, `ALTER ROLE`, or `DROP ROLE`.
- A single `roles:get-snapshot` round trip returns the current user, the roles
  visible to the connection, the membership graph, and the per-database
  privileges. **Non-superuser connections get a filtered snapshot** that only
  exposes their own role row, their own memberships, and privileges evaluated
  against themselves — the renderer simply never receives information about
  other principals.
- The sidebar footer renders a compact roles bar above the "New Connection"
  button, scoped to the active connection, with a one-click jump into the full
  Users view. The Users view itself exposes create-role / create-user dialogs,
  membership toggles, and a per-database access table (CONNECT + read-only on
  `public`) — but only when the current connection is a superuser.
- Read-only access is scoped to the `public` schema by default and grants
  `SELECT` on existing tables plus a default-privileges grant for future
  tables. Restricting a database is implemented as `REVOKE CONNECT` against the
  user; we deliberately do **not** revoke `CONNECT` from `PUBLIC` to avoid
  locking the database out from other callers.
- The Users workspace view is organised as a tabbed dashboard: **Users & Roles**
  (role list + per-role detail with Attributes, Roles, Database Access, and
  Effective Permissions tabs), **Databases** (a card grid summarising every
  connectable database), **Triggers** (superuser-only trigger and trigger
  function management, hidden for non-superusers), and **Audit Log** (a local,
  per-connection log of administrative actions capped at 5,000 entries).
- Database access exposes exactly three levels — No Access, Read Only,
  Read + Write — abstracting PostgreSQL's low-level `GRANT`/`REVOKE` cascade
  (owned by `roles-ipc.ts:setDbAccessLevel`). Each database row additionally
  offers a "Restrict to tables" checklist; when enabled, grants are scoped to
  the selected `public`-schema tables and future tables are **not** granted
  automatically. Role lifecycle actions (create, drop, clone, rename, reset
  password, edit attributes, toggle memberships) are surfaced in the role detail
  header; clone refuses to copy superuser roles.

## Rationale

- One round trip keeps the sidebar roles bar cheap and the Users view snappy.
- Server-side superuser enforcement defends against a tampered renderer; the
  UI gating only controls discoverability. Filtering the snapshot for
  non-admins means a non-privileged login truly cannot learn about other
  principals even via the network bridge.
- We reuse the existing connection pool (`withPoolClient`) and add a small
  `runInDatabase` helper for grants that must run against a specific database
  (read-only SELECT on that database's `public` schema).

## Consequences

- Mutations are irreversible from the app's perspective — there is no undo for
  `DROP ROLE`. We rely on PostgreSQL's own ownership checks to refuse unsafe
  drops.
- "Restrict database" is best-effort: revoking `CONNECT` from a user is
  effective only if `PUBLIC` does not already grant it. True isolation requires
  revoking from `PUBLIC`, which we intentionally avoid to prevent accidental
  lockouts.
- Read-only grants assume the `public` schema. Multi-schema read-only is left
  for a follow-up.