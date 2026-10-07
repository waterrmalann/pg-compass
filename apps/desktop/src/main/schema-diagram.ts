/**
 * Catalog snapshot for the database Diagram tab.
 *
 * Two `pg_catalog` queries in one read-only transaction: one for tables and
 * columns, one for foreign keys. Nothing here reads table data, row counts
 * or relation sizes, and `information_schema` is avoided because its views
 * are slow on large catalogs. Partitions, and the foreign-key copies
 * PostgreSQL creates for them, are left out so a partitioned table is drawn
 * once.
 */

import type { ClientBase } from "pg";
import type {
  DiagramForeignKey,
  DiagramTable,
  SchemaDiagram,
  SchemaDiagramParams,
} from "../shared/types/schema-diagram";
import { withPoolClient } from "./pg-utils";

const STATEMENT_TIMEOUT = "15s";

interface PgDiagramColumnRow {
  schema_name: string;
  table_name: string;
  /** Null for a table with no columns (from the LEFT JOIN). */
  column_name: string | null;
  data_type: string | null;
  not_null: boolean | null;
  is_primary_key: boolean;
  is_unique: boolean;
}

interface PgDiagramForeignKeyRow {
  name: string;
  source_schema: string;
  source_table: string;
  source_columns: string[];
  target_schema: string;
  target_table: string;
  target_columns: string[];
}

const TABLES_SQL = `
  SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    a.attname AS column_name,
    format_type(a.atttypid, a.atttypmod) AS data_type,
    a.attnotnull AS not_null,
    EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = c.oid
        AND i.indisprimary
        AND a.attnum = ANY (i.indkey)
    ) AS is_primary_key,
    EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = c.oid
        AND i.indisunique
        AND i.indnatts = 1
        AND i.indkey[0] = a.attnum
        AND i.indpred IS NULL
    ) AS is_unique
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attribute a
    ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE c.relkind IN ('r', 'p')
    AND NOT c.relispartition
    AND n.nspname = ANY ($1::text[])
  ORDER BY n.nspname, c.relname, a.attnum
`;

const FOREIGN_KEYS_SQL = `
  SELECT
    con.conname AS name,
    source_ns.nspname AS source_schema,
    source.relname AS source_table,
    ARRAY(
      SELECT a.attname::text
      FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      ORDER BY k.ord
    ) AS source_columns,
    target_ns.nspname AS target_schema,
    target.relname AS target_table,
    ARRAY(
      SELECT a.attname::text
      FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
      ORDER BY k.ord
    ) AS target_columns
  FROM pg_constraint con
  JOIN pg_class source ON source.oid = con.conrelid
  JOIN pg_namespace source_ns ON source_ns.oid = source.relnamespace
  JOIN pg_class target ON target.oid = con.confrelid
  JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
  WHERE con.contype = 'f'
    AND NOT source.relispartition
    AND NOT target.relispartition
    AND source_ns.nspname = ANY ($1::text[])
  ORDER BY source_ns.nspname, source.relname, con.conname
`;

/** Group column rows (ordered by table) into tables. */
export function groupDiagramTables(rows: PgDiagramColumnRow[]): DiagramTable[] {
  const tables: DiagramTable[] = [];
  let current: DiagramTable | undefined;

  for (const row of rows) {
    const isSameTable =
      current?.schema === row.schema_name && current.name === row.table_name;
    if (!current || !isSameTable) {
      current = { schema: row.schema_name, name: row.table_name, columns: [] };
      tables.push(current);
    }
    if (row.column_name === null) continue;

    current.columns.push({
      name: row.column_name,
      dataType: row.data_type ?? "",
      isNullable: row.not_null !== true,
      isPrimaryKey: row.is_primary_key,
      isUnique: row.is_unique,
    });
  }

  return tables;
}

function toDiagramForeignKey(row: PgDiagramForeignKeyRow): DiagramForeignKey {
  return {
    name: row.name,
    sourceSchema: row.source_schema,
    sourceTable: row.source_table,
    sourceColumns: row.source_columns,
    targetSchema: row.target_schema,
    targetTable: row.target_table,
    targetColumns: row.target_columns,
  };
}

export async function loadSchemaDiagram(
  client: Pick<ClientBase, "query">,
  schemas: string[],
): Promise<SchemaDiagram> {
  await client.query("BEGIN READ ONLY");
  try {
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const tableResult = await client.query<PgDiagramColumnRow>(TABLES_SQL, [
      schemas,
    ]);
    const foreignKeyResult = await client.query<PgDiagramForeignKeyRow>(
      FOREIGN_KEYS_SQL,
      [schemas],
    );
    return {
      tables: groupDiagramTables(tableResult.rows),
      foreignKeys: foreignKeyResult.rows.map(toDiagramForeignKey),
    };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
  }
}

export async function getSchemaDiagram(
  params: SchemaDiagramParams,
): Promise<SchemaDiagram> {
  if (params.schemas.length === 0) {
    return { tables: [], foreignKeys: [] };
  }
  return withPoolClient(params.connectionId, (client) =>
    loadSchemaDiagram(client, params.schemas),
  );
}
