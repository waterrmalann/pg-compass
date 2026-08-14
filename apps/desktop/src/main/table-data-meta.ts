import type {
  ColumnStructure,
  ConstraintInfo,
  CompositeTypeAttribute,
  IndexInfo,
  TableMetaParams,
  TableTypeColumnUsage,
  TableTypeInfo,
  ToggleTriggerParams,
  TriggerInfo,
} from "../shared/types/table-data";
import type { ClientBase } from "pg";
import { quoteIdent, withPoolClient } from "./pg-utils";
import { getSettings } from "./settings-store";
import { ensureArray } from "./table-data-utils";

// ---------------------------------------------------------------------------
// GET_STRUCTURE
// ---------------------------------------------------------------------------

type PgNumericField = number | string | null;

interface PgColumnRow {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  ordinal_position: number | string;
  character_maximum_length: PgNumericField;
  numeric_precision: PgNumericField;
  numeric_scale: PgNumericField;
}

export async function getStructure(
  params: TableMetaParams,
): Promise<ColumnStructure[]> {
  return withPoolClient(params.connectionId, async (client) => {
    const colResult = await client.query<PgColumnRow>(
      `SELECT
        column_name,
        data_type,
        udt_name,
        is_nullable,
        column_default,
        ordinal_position,
        character_maximum_length,
        numeric_precision,
        numeric_scale
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
      [params.schema, params.table],
    );

    // Fetch 5 sample rows for sample values per column
    const qualifiedTable = `${quoteIdent(params.schema)}.${quoteIdent(params.table)}`;
    const sampleResult = await client.query(
      `SELECT * FROM ${qualifiedTable} LIMIT 5`,
    );

    return colResult.rows.map((col) => ({
      name: col.column_name,
      dataType: col.data_type,
      udtName: col.udt_name,
      isNullable: col.is_nullable === "YES",
      columnDefault: col.column_default,
      ordinalPosition: Number(col.ordinal_position),
      characterMaxLength:
        col.character_maximum_length == null
          ? null
          : Number(col.character_maximum_length),
      numericPrecision:
        col.numeric_precision == null ? null : Number(col.numeric_precision),
      numericScale:
        col.numeric_scale == null ? null : Number(col.numeric_scale),
      sampleValues: sampleResult.rows.map(
        (row: Record<string, unknown>) => row[col.column_name] ?? null,
      ),
    }));
  });
}

// ---------------------------------------------------------------------------
// GET_INDEXES
// ---------------------------------------------------------------------------

interface PgIndexRow {
  index_name: string;
  definition: string;
  type: string;
  size: string;
  scans: string | number;
  tuples_read: string | number;
  tuples_fetched: string | number;
  is_unique: boolean;
  is_primary: boolean;
}

export async function getIndexes(
  params: TableMetaParams,
): Promise<IndexInfo[]> {
  return withPoolClient(params.connectionId, async (client) => {
    const result = await client.query<PgIndexRow>(
      `SELECT
        i.indexname AS index_name,
        i.indexdef AS definition,
        am.amname AS type,
        pg_size_pretty(pg_relation_size(ic.oid)) AS size,
        COALESCE(s.idx_scan, 0) AS scans,
        COALESCE(s.idx_tup_read, 0) AS tuples_read,
        COALESCE(s.idx_tup_fetch, 0) AS tuples_fetched,
        ix.indisunique AS is_unique,
        ix.indisprimary AS is_primary
      FROM pg_indexes i
      JOIN pg_class ic ON ic.relname = i.indexname
      JOIN pg_namespace n ON n.oid = ic.relnamespace AND n.nspname = i.schemaname
      JOIN pg_am am ON am.oid = ic.relam
      JOIN pg_index ix ON ix.indexrelid = ic.oid
      LEFT JOIN pg_stat_user_indexes s
        ON s.indexrelname = i.indexname AND s.schemaname = i.schemaname
      WHERE i.schemaname = $1 AND i.tablename = $2
      ORDER BY i.indexname`,
      [params.schema, params.table],
    );

    return result.rows.map((row) => ({
      name: row.index_name,
      definition: row.definition,
      type: row.type,
      size: row.size,
      scans: Number(row.scans),
      tuplesRead: Number(row.tuples_read),
      tuplesFetched: Number(row.tuples_fetched),
      isUnique: row.is_unique,
      isPrimary: row.is_primary,
    }));
  });
}

// ---------------------------------------------------------------------------
// GET_CONSTRAINTS
// ---------------------------------------------------------------------------

interface PgConstraintRow {
  constraint_name: string;
  constraint_type: string;
  column_names: string[];
  definition: string | null;
  foreign_table_schema: string | null;
  foreign_table_name: string | null;
  foreign_column_names: string[];
  check_clause: string | null;
}

export async function getConstraints(
  params: TableMetaParams,
): Promise<ConstraintInfo[]> {
  return withPoolClient(params.connectionId, async (client) => {
    const result = await client.query<PgConstraintRow>(
      `SELECT
        tc.conname AS constraint_name,
        CASE tc.contype
          WHEN 'p' THEN 'PRIMARY KEY'
          WHEN 'f' THEN 'FOREIGN KEY'
          WHEN 'u' THEN 'UNIQUE'
          WHEN 'c' THEN 'CHECK'
          WHEN 'x' THEN 'EXCLUDE'
          ELSE tc.contype::text
        END AS constraint_type,
        ARRAY(
          SELECT a.attname
          FROM unnest(tc.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = tc.conrelid AND a.attnum = k.attnum
          ORDER BY k.ord
        ) AS column_names,
        pg_get_constraintdef(tc.oid, true) AS definition,
        fns.nspname AS foreign_table_schema,
        fc.relname AS foreign_table_name,
        COALESCE(
          ARRAY(
            SELECT a.attname
            FROM unnest(tc.confkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = tc.confrelid AND a.attnum = k.attnum
            ORDER BY k.ord
          ),
          ARRAY[]::text[]
        ) AS foreign_column_names,
        CASE WHEN tc.contype = 'c'
          THEN pg_get_constraintdef(tc.oid, true)
          ELSE NULL
        END AS check_clause
      FROM pg_constraint tc
      JOIN pg_namespace ns ON ns.oid = tc.connamespace
      LEFT JOIN pg_class fc ON fc.oid = tc.confrelid
      LEFT JOIN pg_namespace fns ON fns.oid = fc.relnamespace
      WHERE ns.nspname = $1
        AND tc.conrelid = (
          SELECT c.oid FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2
        )
      ORDER BY
        CASE tc.contype
          WHEN 'p' THEN 1
          WHEN 'f' THEN 2
          WHEN 'u' THEN 3
          WHEN 'c' THEN 4
          WHEN 'x' THEN 5
          ELSE 6
        END,
        tc.conname`,
      [params.schema, params.table],
    );

    return result.rows.map((row) => ({
      name: row.constraint_name,
      type: row.constraint_type as ConstraintInfo["type"],
      columns: ensureArray(row.column_names),
      definition: row.definition,
      foreignTable: row.foreign_table_name
        ? `${row.foreign_table_schema}.${row.foreign_table_name}`
        : null,
      foreignColumns: ensureArray(row.foreign_column_names),
      checkClause: row.check_clause,
    }));
  });
}

// ---------------------------------------------------------------------------
// GET_TRIGGERS / TOGGLE_TRIGGER
// ---------------------------------------------------------------------------

interface PgTriggerRow {
  trigger_name: string;
  enabled_mode: string;
  timing: string;
  events: string[];
  function_name: string;
  definition: string;
}

function mapEnabledMode(mode: string): TriggerInfo["enabledMode"] {
  switch (mode) {
    case "D":
      return "DISABLED";
    case "R":
      return "REPLICA";
    case "A":
      return "ALWAYS";
    case "O":
    default:
      return "ORIGIN";
  }
}

export async function getTriggers(
  params: TableMetaParams,
): Promise<TriggerInfo[]> {
  return withPoolClient(params.connectionId, async (client) => {
    const result = await client.query<PgTriggerRow>(
      `SELECT
        t.tgname AS trigger_name,
        t.tgenabled AS enabled_mode,
        CASE
          WHEN (t.tgtype & 64) <> 0 THEN 'INSTEAD OF'
          WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE'
          ELSE 'AFTER'
        END AS timing,
        ARRAY_REMOVE(ARRAY[
          CASE WHEN (t.tgtype & 4) <> 0 THEN 'INSERT' END,
          CASE WHEN (t.tgtype & 8) <> 0 THEN 'DELETE' END,
          CASE WHEN (t.tgtype & 16) <> 0 THEN 'UPDATE' END,
          CASE WHEN (t.tgtype & 32) <> 0 THEN 'TRUNCATE' END
        ], NULL) AS events,
        pn.nspname || '.' || p.proname AS function_name,
        pg_get_triggerdef(t.oid, true) AS definition
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace pn ON pn.oid = p.pronamespace
      WHERE n.nspname = $1
        AND c.relname = $2
        AND NOT t.tgisinternal
      ORDER BY t.tgname`,
      [params.schema, params.table],
    );

    return result.rows.map((row) => ({
      name: row.trigger_name,
      enabled: row.enabled_mode !== "D",
      enabledMode: mapEnabledMode(row.enabled_mode),
      timing: row.timing as TriggerInfo["timing"],
      events: ensureArray(row.events),
      functionName: row.function_name,
      definition: row.definition,
    }));
  });
}

export interface TriggerTarget {
  schema: string;
  table: string;
  trigger: string;
  enabled: boolean;
}

/**
 * Enable or disable a user trigger on `client`'s database. Shared by the
 * table viewer and the RBAC triggers pane so both validate the trigger exists
 * and quote identically. Callers own the read-only-mode check.
 */
export async function setTriggerEnabledOnClient(
  client: ClientBase,
  target: TriggerTarget,
): Promise<void> {
  const exists = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relname = $2
        AND t.tgname = $3
        AND NOT t.tgisinternal
    ) AS exists`,
    [target.schema, target.table, target.trigger],
  );

  if (!exists.rows[0]?.exists) {
    throw new Error("Trigger not found on the selected table.");
  }

  const qualifiedTable = `${quoteIdent(target.schema)}.${quoteIdent(target.table)}`;
  const action = target.enabled ? "ENABLE" : "DISABLE";
  await client.query(
    `ALTER TABLE ${qualifiedTable} ${action} TRIGGER ${quoteIdent(target.trigger)}`,
  );
}

export async function toggleTrigger(
  params: ToggleTriggerParams,
): Promise<TriggerInfo[]> {
  const settings = getSettings();
  if (settings.general.readOnlyMode) {
    throw new Error("Cannot toggle trigger: read-only mode is enabled.");
  }

  await withPoolClient(params.connectionId, (client) =>
    setTriggerEnabledOnClient(client, params),
  );

  return getTriggers(params);
}

// ---------------------------------------------------------------------------
// GET_TYPES
// ---------------------------------------------------------------------------

interface PgTypeRow {
  type_name: string;
  type_schema: string;
  kind: TableTypeInfo["kind"];
  used_by_columns: TableTypeColumnUsage[] | string;
  enum_labels: string[] | string;
  domain_base_type: string | null;
  domain_default: string | null;
  domain_constraints: string[] | string;
  composite_attributes: CompositeTypeAttribute[] | string;
}

function parseJsonArray<T>(value: T[] | string): T[] {
  if (Array.isArray(value)) return value;
  return JSON.parse(value) as T[];
}

function typeKindSort(kind: TableTypeInfo["kind"]): number {
  switch (kind) {
    case "ENUM":
      return 1;
    case "DOMAIN":
      return 2;
    case "COMPOSITE":
      return 3;
  }
}

export async function getTypes(
  params: TableMetaParams,
): Promise<TableTypeInfo[]> {
  return withPoolClient(params.connectionId, async (client) => {
    const result = await client.query<PgTypeRow>(
      `WITH selected_table AS (
        SELECT c.oid
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relname = $2
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      ),
      column_types AS (
        SELECT
          a.attname AS column_name,
          a.attnum AS ordinal_position,
          CASE
            WHEN t.typcategory = 'A' AND t.typelem <> 0 THEN elem.oid
            ELSE t.oid
          END AS type_oid,
          (t.typcategory = 'A' AND t.typelem <> 0) AS is_array
        FROM selected_table st
        JOIN pg_attribute a ON a.attrelid = st.oid
        JOIN pg_type t ON t.oid = a.atttypid
        LEFT JOIN pg_type elem ON elem.oid = t.typelem
        WHERE a.attnum > 0
          AND NOT a.attisdropped
      ),
      supported_types AS (
        SELECT DISTINCT ct.type_oid
        FROM column_types ct
        JOIN pg_type typ ON typ.oid = ct.type_oid
        WHERE typ.typtype IN ('e', 'd', 'c')
      )
      SELECT
        typ.typname AS type_name,
        ns.nspname AS type_schema,
        CASE typ.typtype
          WHEN 'e' THEN 'ENUM'
          WHEN 'd' THEN 'DOMAIN'
          WHEN 'c' THEN 'COMPOSITE'
        END AS kind,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object('name', ct.column_name, 'isArray', ct.is_array)
              ORDER BY ct.ordinal_position
            ),
            '[]'::jsonb
          )
          FROM column_types ct
          WHERE ct.type_oid = typ.oid
        ) AS used_by_columns,
        COALESCE(
          ARRAY(
            SELECT e.enumlabel
            FROM pg_enum e
            WHERE e.enumtypid = typ.oid
            ORDER BY e.enumsortorder
          ),
          ARRAY[]::text[]
        ) AS enum_labels,
        CASE WHEN typ.typtype = 'd'
          THEN format_type(typ.typbasetype, typ.typtypmod)
          ELSE NULL
        END AS domain_base_type,
        CASE WHEN typ.typtype = 'd' AND typ.typdefaultbin IS NOT NULL
          THEN pg_get_expr(typ.typdefaultbin, 0)
          WHEN typ.typtype = 'd'
          THEN typ.typdefault
          ELSE NULL
        END AS domain_default,
        COALESCE(
          ARRAY(
            SELECT pg_get_constraintdef(con.oid, true)
            FROM pg_constraint con
            WHERE con.contypid = typ.oid
            ORDER BY con.conname
          ),
          ARRAY[]::text[]
        ) AS domain_constraints,
        CASE WHEN typ.typtype = 'c'
          THEN (
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'name', attr.attname,
                  'dataType', format_type(attr.atttypid, attr.atttypmod),
                  'isNullable', NOT attr.attnotnull
                )
                ORDER BY attr.attnum
              ),
              '[]'::jsonb
            )
            FROM pg_attribute attr
            WHERE attr.attrelid = typ.typrelid
              AND attr.attnum > 0
              AND NOT attr.attisdropped
          )
          ELSE '[]'::jsonb
        END AS composite_attributes
      FROM supported_types st
      JOIN pg_type typ ON typ.oid = st.type_oid
      JOIN pg_namespace ns ON ns.oid = typ.typnamespace
      ORDER BY ns.nspname, typ.typname`,
      [params.schema, params.table],
    );

    return result.rows
      .map((row) => ({
        name: row.type_name,
        schema: row.type_schema,
        kind: row.kind,
        usedByColumns: parseJsonArray<TableTypeColumnUsage>(
          row.used_by_columns,
        ),
        enumLabels: ensureArray(row.enum_labels),
        domainBaseType: row.domain_base_type,
        domainDefault: row.domain_default,
        domainConstraints: ensureArray(row.domain_constraints),
        compositeAttributes: parseJsonArray<CompositeTypeAttribute>(
          row.composite_attributes,
        ),
      }))
      .sort((a, b) => {
        const kindDifference = typeKindSort(a.kind) - typeKindSort(b.kind);
        if (kindDifference !== 0) return kindDifference;
        return `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`);
      });
  });
}
