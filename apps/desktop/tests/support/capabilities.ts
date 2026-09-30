/**
 * Runtime capability probes for integration tests.
 *
 * PGlite does not ship PostGIS (pgvector is supported via the opt-in
 * `@electric-sql/pglite/vector` bundle, loaded in `pglite.ts`). CI Postgres
 * images may not have either extension. Tests that exercise these types query
 * `pg_extension` at runtime and skip the relevant assertions when the
 * extension is absent, so the same suite is safe to run against both backends.
 */

import { withPoolClient } from "@/main/pg-utils";

export async function hasExtension(
  connectionId: string,
  extname: string,
): Promise<boolean> {
  return withPoolClient(connectionId, async (client) => {
    const result = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = $1) AS exists",
      [extname],
    );
    return Boolean(result.rows[0]?.exists);
  });
}

export async function hasColumn(
  connectionId: string,
  schema: string,
  table: string,
  column: string,
): Promise<boolean> {
  return withPoolClient(connectionId, async (client) => {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
       ) AS exists`,
      [schema, table, column],
    );
    return Boolean(result.rows[0]?.exists);
  });
}

/**
 * Whether `pg_locks` shows this session's own table locks. PGlite runs
 * single-user and records none, so lock assertions only run on PostgreSQL.
 */
export async function tracksTableLocks(connectionId: string): Promise<boolean> {
  return withPoolClient(connectionId, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("LOCK TABLE app.users IN ACCESS SHARE MODE");
      const result = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM pg_locks
         WHERE relation = 'app.users'::regclass AND pid = pg_backend_pid()`,
      );
      return Number(result.rows[0]?.count ?? 0) > 0;
    } finally {
      await client.query("ROLLBACK");
    }
  });
}
