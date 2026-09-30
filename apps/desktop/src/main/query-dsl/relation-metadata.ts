import type { PoolClient } from "pg";
import type {
  QueryColumnMetadata,
  QueryTypeFamily,
  RelationMetadata,
} from "../../shared/query-dsl/types";

/**
 * Returns the primary-key columns for a real table, in declaration order.
 * Returns `null` for relations that have no primary key — views, foreign
 * tables, and tables declared without PRIMARY KEY. Cells are only editable
 * when this is non-null.
 */
export async function resolvePrimaryKey(
  client: PoolClient,
  schema: string,
  table: string,
): Promise<string[] | null> {
  // pg_index.indkey is an int2vector in column-order; unnest WITH ORDINALITY
  // preserves that order and lets us join to pg_attribute for the names.
  const result = await client.query<{ attname: string }>(
    `
    SELECT a.attname
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a
      ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE i.indisprimary
      AND n.nspname = $1
      AND c.relname = $2
    ORDER BY k.ord
    `,
    [schema, table],
  );

  if (result.rows.length === 0) return null;
  return result.rows.map((r) => r.attname);
}

const TEXT_TYPES = new Set([
  "text",
  "varchar",
  "bpchar",
  "char",
  "name",
  "citext",
]);

/**
 * Maps a column's base type to a DSL capability family. Built-in categories
 * drive most of the mapping; string-category and user-defined types are
 * matched by name so unknown extension types fall back to null checks only
 * instead of inheriting text behavior.
 */
export function classifyTypeFamily(
  baseTypeName: string,
  typeCategory: string,
): QueryTypeFamily {
  if (typeCategory === "A") return "other";
  if (typeCategory === "N") return "numeric";
  if (typeCategory === "D" || typeCategory === "T") return "temporal";
  if (typeCategory === "B") return "boolean";
  if (typeCategory === "E") return "enum";
  if (TEXT_TYPES.has(baseTypeName)) return "text";
  if (baseTypeName === "uuid") return "uuid";
  if (baseTypeName === "jsonb") return "jsonb";
  return "other";
}

interface RelationKindRow {
  relkind: string;
}

interface ColumnTypeRow {
  attname: string;
  declared_type: string;
  base_type: string;
  base_category: string;
}

/**
 * Loads the relation's columns and type families from the catalogs.
 * Domains are unwrapped (including domains over domains) so they inherit
 * their base type's capabilities. Throws when the relation does not exist.
 */
export async function loadRelationMetadata(
  client: PoolClient,
  schema: string,
  table: string,
): Promise<RelationMetadata> {
  const relation = await client.query<RelationKindRow>(
    `
    SELECT c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = $2
    `,
    [schema, table],
  );
  const relkind = relation.rows[0]?.relkind;
  if (!relkind) {
    throw new Error(`Relation ${schema}.${table} does not exist.`);
  }

  const columnResult = await client.query<ColumnTypeRow>(
    `
    WITH RECURSIVE column_types AS (
      SELECT a.attnum, a.attname, a.atttypid AS type_oid,
             a.atttypid AS declared_oid, 0 AS depth
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
        AND a.attnum > 0 AND NOT a.attisdropped
      UNION ALL
      SELECT ct.attnum, ct.attname, t.typbasetype, ct.declared_oid, ct.depth + 1
      FROM column_types ct
      JOIN pg_type t ON t.oid = ct.type_oid
      WHERE t.typtype = 'd' AND ct.depth < 16
    )
    SELECT DISTINCT ON (ct.attnum)
      ct.attname,
      declared.typname AS declared_type,
      base.typname AS base_type,
      base.typcategory AS base_category
    FROM column_types ct
    JOIN pg_type base ON base.oid = ct.type_oid
    JOIN pg_type declared ON declared.oid = ct.declared_oid
    ORDER BY ct.attnum, ct.depth DESC
    `,
    [schema, table],
  );

  const columns: QueryColumnMetadata[] = columnResult.rows.map((row) => ({
    name: row.attname,
    typeName: row.declared_type,
    family: classifyTypeFamily(row.base_type, row.base_category),
  }));

  // Ordinary, partitioned and foreign tables accept DELETE; views and
  // materialized views are read-only here.
  const isTable = relkind === "r" || relkind === "p" || relkind === "f";
  const primaryKey = isTable
    ? await resolvePrimaryKey(client, schema, table)
    : null;

  return { kind: isTable ? "table" : "view", columns, primaryKey };
}
