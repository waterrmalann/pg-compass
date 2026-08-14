import type { PoolClient } from "pg";
import type {
  DeleteRowsParams,
  DeleteRowsResult,
  InsertRowParams,
  InsertRowResult,
  UpdateCellParams,
  UpdateCellResult,
  UpdateRowParams,
  UpdateRowResult,
} from "../shared/types/table-data";
import { extendedQuery, quoteIdent, withPoolClient } from "./pg-utils";
import { getSettings } from "./settings-store";
import { resolvePrimaryKey } from "./table-data-rows";

/**
 * Allow-listed Postgres type names that may appear as an explicit cast
 * (`$n::<cast>`) in the UPDATE we build. Anything outside this set is
 * rejected before reaching the database.
 *
 * Array types are spelled with the leading underscore form (`_int4`,
 * `_text`) so we never emit `int4[]` from user-controlled input.
 */
const SAFE_PG_CAST = new Set<string>([
  "text",
  "varchar",
  "bpchar",
  "name",
  "char",
  "citext",
  "bool",
  "int2",
  "int4",
  "int8",
  "oid",
  "float4",
  "float8",
  "numeric",
  "money",
  "uuid",
  "bytea",
  "json",
  "jsonb",
  "date",
  "time",
  "timetz",
  "timestamp",
  "timestamptz",
  "interval",
  "inet",
  "cidr",
  "macaddr",
  "macaddr8",
  "xml",
  "bit",
  "varbit",
  "regclass",
  "regtype",
  "int4range",
  "int8range",
  "numrange",
  "tsrange",
  "tstzrange",
  "daterange",
  "tsvector",
  "tsquery",
  "_text",
  "_varchar",
  "_bool",
  "_int2",
  "_int4",
  "_int8",
  "_float4",
  "_float8",
  "_numeric",
  "_uuid",
  "_json",
  "_jsonb",
  "_date",
  "_timestamp",
  "_timestamptz",
  "geometry",
  "geography",
  "vector",
]);

/**
 * Throws if `pgCast` is not on the allowlist. Keeping the check here (and
 * not in the renderer) ensures the main process remains authoritative.
 */
export function assertSafePgCast(pgCast: string): void {
  if (!SAFE_PG_CAST.has(pgCast)) {
    throw new Error(`Unsupported or unsafe cast: ${pgCast}`);
  }
}

/**
 * Verifies that `pgCast` refers to a user-defined enum type that actually
 * exists in the connected database. Use this branch only when the static
 * allowlist fails. The cast string must exactly match the catalog-derived
 * schema-qualified representation (`quote_ident(schema) || '.' ||
 * quote_ident(typname)`), which keeps the SQL interpolation safe without
 * relying on the session search_path.
 */
async function assertEnumCast(
  client: PoolClient,
  pgCast: string,
): Promise<void> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typtype = 'e'
         AND (
           '"' || replace(n.nspname, '"', '""') || '"."'
           || replace(t.typname, '"', '""') || '"'
         ) = $1
     ) AS exists`,
    [pgCast],
  );
  if (!result.rows[0]?.exists) {
    throw new Error(`Unsupported or unsafe cast: ${pgCast}`);
  }
}

export async function updateCell(
  params: UpdateCellParams,
): Promise<UpdateCellResult> {
  const settings = getSettings();
  if (settings.general.readOnlyMode) {
    throw new Error("Cannot update cell: read-only mode is enabled.");
  }

  if (params.pkColumns.length === 0) {
    throw new Error(
      "Cannot update cell: the table has no primary key to target.",
    );
  }
  if (params.pkColumns.length !== params.pkValues.length) {
    throw new Error(
      "Cannot update cell: pkColumns and pkValues must have the same length.",
    );
  }

  const castInAllowlist = params.setNull || SAFE_PG_CAST.has(params.pgCast);

  return withPoolClient(params.connectionId, async (client) => {
    if (!params.setNull && !castInAllowlist) {
      await assertEnumCast(client, params.pgCast);
    }

    const qualifiedTable = `${quoteIdent(params.schema)}.${quoteIdent(params.table)}`;
    const columnIdent = quoteIdent(params.column);
    const setClause = params.setNull
      ? `${columnIdent} = NULL`
      : `${columnIdent} = $1::${params.pgCast}`;

    const pkStart = params.setNull ? 1 : 2;
    const whereClause = params.pkColumns
      .map((col, i) => `${quoteIdent(col)} = $${pkStart + i}`)
      .join(" AND ");

    const values = params.setNull
      ? params.pkValues
      : [params.newValue, ...params.pkValues];

    const sql = `UPDATE ${qualifiedTable} SET ${setClause} WHERE ${whereClause} RETURNING *`;
    const result = await client.query(sql, values);

    if (result.rowCount === 0) {
      throw new Error(
        "Row not found: no rows matched the provided primary key.",
      );
    }
    if (result.rowCount && result.rowCount > 1) {
      throw new Error(
        `Unexpected row count (${result.rowCount}) from cell update.`,
      );
    }

    return { row: result.rows[0] as Record<string, unknown> };
  });
}

/**
 * Atomic multi-column update of a single row. Every change in `params.changes`
 * lands in one `UPDATE … SET col1=$1, col2=$2 WHERE pk…` statement, which
 * Postgres applies atomically: a failing CHECK / FK / type cast on any field
 * rolls the entire row back. There is no partial-success path.
 *
 * Mirrors `updateCell` for read-only enforcement, PK guards, and cast
 * allow-listing. Identifier injection is prevented by `quoteIdent`; user
 * values travel exclusively through bound parameters.
 */
export async function updateRow(
  params: UpdateRowParams,
): Promise<UpdateRowResult> {
  const settings = getSettings();
  if (settings.general.readOnlyMode) {
    throw new Error("Cannot update row: read-only mode is enabled.");
  }

  if (params.pkColumns.length === 0) {
    throw new Error(
      "Cannot update row: the table has no primary key to target.",
    );
  }
  if (params.pkColumns.length !== params.pkValues.length) {
    throw new Error(
      "Cannot update row: pkColumns and pkValues must have the same length.",
    );
  }
  if (params.changes.length === 0) {
    throw new Error("Cannot update row: no changes to apply.");
  }

  // Reject duplicate columns up front — Postgres would error too, but
  // catching it here gives a clearer message and avoids a wasted round-trip.
  const seenColumns = new Set<string>();
  for (const change of params.changes) {
    if (seenColumns.has(change.column)) {
      throw new Error(
        `Cannot update row: duplicate change for column "${change.column}".`,
      );
    }
    seenColumns.add(change.column);
  }

  // Partition casts into allow-listed (static) and enum candidates so we can
  // verify the latter once we have a pool client.
  const enumCasts: string[] = [];
  for (const change of params.changes) {
    if (change.setNull) continue;
    if (!SAFE_PG_CAST.has(change.pgCast)) {
      enumCasts.push(change.pgCast);
    }
  }

  return withPoolClient(params.connectionId, async (client) => {
    for (const pgCast of enumCasts) {
      await assertEnumCast(client, pgCast);
    }

    const qualifiedTable = `${quoteIdent(params.schema)}.${quoteIdent(params.table)}`;

    const setParts: string[] = [];
    const setValues: unknown[] = [];
    for (const change of params.changes) {
      const columnIdent = quoteIdent(change.column);
      if (change.setNull) {
        setParts.push(`${columnIdent} = NULL`);
      } else {
        setValues.push(change.newValue);
        setParts.push(
          `${columnIdent} = $${setValues.length}::${change.pgCast}`,
        );
      }
    }

    // PK placeholders come after every SET placeholder so numbering is dense
    // and stable regardless of how many setNull entries appear.
    const pkStart = setValues.length + 1;
    const whereClause = params.pkColumns
      .map((col, i) => `${quoteIdent(col)} = $${pkStart + i}`)
      .join(" AND ");

    const values = [...setValues, ...params.pkValues];

    const sql = `UPDATE ${qualifiedTable} SET ${setParts.join(", ")} WHERE ${whereClause} RETURNING *`;
    const result = await client.query(sql, values);

    if (result.rowCount === 0) {
      throw new Error(
        "Row not found: no rows matched the provided primary key.",
      );
    }
    if (result.rowCount && result.rowCount > 1) {
      throw new Error(
        `Unexpected row count (${result.rowCount}) from row update.`,
      );
    }

    return { row: result.rows[0] as Record<string, unknown> };
  });
}

/**
 * Insert a single row. Columns the caller omits from `changes` are left out
 * of the statement entirely so the database default (or NULL) applies; an
 * empty `changes` array emits `INSERT … DEFAULT VALUES`. `setNull` writes a
 * literal `NULL`; every other value travels as a bound `$n::cast` parameter.
 *
 * Shares `updateRow`'s read-only gate, duplicate-column guard, and cast
 * allow-listing. Identifier injection is prevented by `quoteIdent`.
 */
export async function insertRow(
  params: InsertRowParams,
): Promise<InsertRowResult> {
  const settings = getSettings();
  if (settings.general.readOnlyMode) {
    throw new Error("Cannot insert row: read-only mode is enabled.");
  }

  const seenColumns = new Set<string>();
  for (const change of params.changes) {
    if (seenColumns.has(change.column)) {
      throw new Error(
        `Cannot insert row: duplicate value for column "${change.column}".`,
      );
    }
    seenColumns.add(change.column);
  }

  const enumCasts: string[] = [];
  for (const change of params.changes) {
    if (change.setNull) continue;
    if (!SAFE_PG_CAST.has(change.pgCast)) {
      enumCasts.push(change.pgCast);
    }
  }

  return withPoolClient(params.connectionId, async (client) => {
    for (const pgCast of enumCasts) {
      await assertEnumCast(client, pgCast);
    }

    const qualifiedTable = `${quoteIdent(params.schema)}.${quoteIdent(params.table)}`;

    if (params.changes.length === 0) {
      const result = await client.query(
        `INSERT INTO ${qualifiedTable} DEFAULT VALUES RETURNING *`,
      );
      return { row: result.rows[0] as Record<string, unknown> };
    }

    const columnIdents: string[] = [];
    const valueExprs: string[] = [];
    const values: unknown[] = [];
    for (const change of params.changes) {
      columnIdents.push(quoteIdent(change.column));
      if (change.setNull) {
        valueExprs.push("NULL");
      } else {
        values.push(change.newValue);
        valueExprs.push(`$${values.length}::${change.pgCast}`);
      }
    }

    const sql = `INSERT INTO ${qualifiedTable} (${columnIdents.join(", ")}) VALUES (${valueExprs.join(", ")}) RETURNING *`;
    const result = await client.query(sql, values);
    return { row: result.rows[0] as Record<string, unknown> };
  });
}

export async function deleteRows(
  params: DeleteRowsParams,
): Promise<DeleteRowsResult> {
  const settings = getSettings();
  if (settings.general.readOnlyMode) {
    throw new Error("Cannot delete rows: read-only mode is enabled.");
  }

  return withPoolClient(params.connectionId, async (client) => {
    const qualifiedTable = `${quoteIdent(params.schema)}.${quoteIdent(params.table)}`;
    const trimmedWhere = params.whereClause?.trim();
    if (!trimmedWhere) {
      const result = await client.query(`DELETE FROM ${qualifiedTable}`);
      return { deletedCount: result.rowCount ?? 0 };
    }

    const primaryKey = await resolvePrimaryKey(
      client,
      params.schema,
      params.table,
    );
    if (!primaryKey) {
      throw new Error(
        "Cannot delete filtered rows: the table has no primary key.",
      );
    }

    const primaryKeySql = primaryKey.map(quoteIdent).join(", ");
    let selectedRows: Record<string, unknown>[];
    await client.query("BEGIN READ ONLY");
    try {
      const selected = await client.query<Record<string, unknown>>(
        extendedQuery(
          `SELECT ${primaryKeySql} FROM ${qualifiedTable} WHERE ${trimmedWhere}`,
        ),
      );
      selectedRows = selected.rows;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    if (selectedRows.length === 0) {
      return { deletedCount: 0 };
    }

    let deletedCount = 0;
    await client.query("BEGIN");
    try {
      const batchSize = 500;
      for (let offset = 0; offset < selectedRows.length; offset += batchSize) {
        const batch = selectedRows.slice(offset, offset + batchSize);
        const values: unknown[] = [];
        const tuples = batch.map((row) => {
          const placeholders = primaryKey.map((column) => {
            values.push(row[column]);
            return `$${values.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        const keyTuple = `(${primaryKeySql})`;
        // Re-apply the original filter here (not just the pinned PK set):
        // a row selected above can be concurrently modified before this
        // batch runs so it no longer matches `trimmedWhere` — without this,
        // it would still be deleted purely because its PK was captured
        // earlier, deleting a row the user's filter no longer matches.
        const result = await client.query(
          `DELETE FROM ${qualifiedTable} WHERE ${keyTuple} IN (${tuples.join(", ")}) AND (${trimmedWhere})`,
          values,
        );
        deletedCount += result.rowCount ?? 0;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    return { deletedCount };
  });
}
