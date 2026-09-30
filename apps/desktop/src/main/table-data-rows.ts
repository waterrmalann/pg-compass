import type { PoolClient } from "pg";
import type { QueryColumnMetadata } from "../shared/query-dsl/types";
import type {
  ColumnInfo,
  ExecuteQueryParams,
  GetRowsParams,
  TableMetaParams,
  TableRowsResult,
} from "../shared/types/table-data";
import {
  extendedQuery,
  quoteIdent,
  withDedicatedClient,
  withPoolClient,
} from "./pg-utils";
import { buildEnumTypeMap, buildTypeMap } from "./table-data-utils";
import { resolveForeignKeys } from "./table-data-fk";
import { pageWindow } from "./query-dsl/compile";
import { bindAndCompile, parseDataQueryOrThrow } from "./query-dsl/prepare";
import { loadRelationMetadata } from "./query-dsl/relation-metadata";

interface ActiveQuery {
  connectionId: string;
  backendPid: number | null;
  cancelRequested: boolean;
  cancelPromise: Promise<boolean> | null;
}

const activeQueries = new Map<string, ActiveQuery>();

function validateQueryId(queryId: string): void {
  if (
    typeof queryId !== "string" ||
    queryId.length < 8 ||
    queryId.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(queryId)
  ) {
    throw new Error("Invalid query identifier.");
  }
}

function parseCountRow(raw: string | undefined): number {
  // `SELECT count(*)` always produces exactly one row; a missing value here
  // implies the driver returned an unexpected shape, not an empty relation.
  if (raw === undefined) {
    throw new Error("count(*) query returned no rows");
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`count(*) returned non-numeric value: ${raw}`);
  }
  return n;
}

async function resolveColumnNullability(
  client: PoolClient,
  schema: string,
  table: string,
): Promise<Map<string, boolean>> {
  const result = await client.query<{
    column_name: string;
    is_nullable: string;
  }>(
    `
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    `,
    [schema, table],
  );

  return new Map(
    result.rows.map((row) => [row.column_name, row.is_nullable === "YES"]),
  );
}

// ---------------------------------------------------------------------------
// GET_ROWS
// ---------------------------------------------------------------------------

export async function getRows(params: GetRowsParams): Promise<TableRowsResult> {
  // Syntax errors are reported before any database work.
  const ast = parseDataQueryOrThrow(params.query);

  return withPoolClient(params.connectionId, async (client) => {
    const qualifiedTable = `${quoteIdent(params.schema)}.${quoteIdent(params.table)}`;

    // One read-only transaction: catalog binding, count and data all see
    // the same snapshot, and the ACCESS SHARE lock taken before binding
    // keeps a concurrent ALTER TABLE out until the page is read.
    await client.query("BEGIN READ ONLY");
    try {
      const { metadata, compiled } = await bindAndCompile(
        client,
        params.schema,
        params.table,
        ast,
        "ACCESS SHARE",
      );
      const whereFragment = compiled.whereSql
        ? `WHERE ${compiled.whereSql}`
        : "";
      // Without an ORDER BY, Postgres doesn't guarantee row order is stable
      // across separate executions of the same query, so a row can be
      // skipped or shown twice while paging. The compiler appends missing
      // primary-key columns to any user sort (or uses them alone when there
      // is no sort). Relations without a PK keep the user's sort only.
      const orderByFragment = compiled.orderBySql
        ? `ORDER BY ${compiled.orderBySql}`
        : "";

      const countResult = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM ${qualifiedTable} ${whereFragment}`,
        compiled.values,
      );
      const matchingRows = parseCountRow(countResult.rows[0]?.count);
      // Skip/Limit define the result; pages are windows inside it.
      const window = pageWindow(
        compiled,
        params.page,
        params.pageSize,
        matchingRows,
      );
      const totalCount = window.count;

      const limitPlaceholder = `$${compiled.values.length + 1}`;
      const offsetPlaceholder = `$${compiled.values.length + 2}`;
      const dataResult = await client.query(
        `SELECT ${compiled.selectListSql} FROM ${qualifiedTable} ${whereFragment} ${orderByFragment} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
        [...compiled.values, window.limit, window.offset],
      );

      const nullability = compiled.hasProjection
        ? null
        : await resolveColumnNullability(client, params.schema, params.table);

      await client.query("COMMIT");

      const oids = dataResult.fields.map((f) => f.dataTypeID);
      const typeMap = await buildTypeMap(client, oids);

      // A projection can omit or rename source columns, so its results are
      // display-only: no primary key, nullability, enum-editing or FK
      // metadata that could be mistaken for a source column's.
      if (compiled.hasProjection) {
        const columns: ColumnInfo[] = dataResult.fields.map((f) => ({
          name: f.name,
          dataTypeId: f.dataTypeID,
          dataType: typeMap.get(f.dataTypeID) ?? "unknown",
        }));
        return {
          columns,
          rows: dataResult.rows,
          totalCount,
          primaryKey: null,
        };
      }

      const enumMap = await buildEnumTypeMap(client, oids);

      // Build a column-name -> pg type map for FK cast resolution.  We
      // do this from the result fields rather than re-querying so the
      // cast we hand the FK editor matches what the wire actually sees.
      const valueCastByColumn = new Map<string, string>();
      for (const f of dataResult.fields) {
        const t = typeMap.get(f.dataTypeID);
        if (t) valueCastByColumn.set(f.name, t);
      }
      const fkMap = await resolveForeignKeys(
        client,
        params.schema,
        params.table,
        valueCastByColumn,
      );

      const columns: ColumnInfo[] = dataResult.fields.map((f) => {
        const enumInfo = enumMap.get(f.dataTypeID);
        const fk = fkMap.get(f.name);
        return {
          name: f.name,
          dataTypeId: f.dataTypeID,
          dataType: typeMap.get(f.dataTypeID) ?? "unknown",
          isNullable: nullability?.get(f.name) ?? true,
          ...(enumInfo
            ? { enumLabels: enumInfo.labels, enumPgCast: enumInfo.pgCast }
            : {}),
          ...(fk ? { foreignKey: fk } : {}),
        };
      });

      return {
        columns,
        rows: dataResult.rows,
        totalCount,
        primaryKey: metadata.primaryKey,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  });
}

/** Columns and DSL type families for the Data tab's completion and linting. */
export async function getQueryColumns(
  params: TableMetaParams,
): Promise<QueryColumnMetadata[]> {
  return withPoolClient(params.connectionId, async (client) => {
    const metadata = await loadRelationMetadata(
      client,
      params.schema,
      params.table,
    );
    return metadata.columns;
  });
}

// ---------------------------------------------------------------------------
// EXECUTE_QUERY
// ---------------------------------------------------------------------------

const ALLOWED_QUERY_PREFIXES = ["select", "with"];

export function isReadOnlyQuery(sql: string): boolean {
  const trimmed = sql.trim().toLowerCase();
  return ALLOWED_QUERY_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * Strip trailing LIMIT and OFFSET clauses from a SQL string so we can
 * apply our own pagination wrapper without double-limiting.
 * Returns the cleaned SQL and the user-provided LIMIT (if any) so we can
 * honour it as an upper bound on totalCount.
 */
export function stripLimitOffset(sql: string): {
  core: string;
  userLimit: number | null;
} {
  let core = sql;
  let userLimit: number | null = null;

  // Strip trailing OFFSET (must come after LIMIT in standard SQL)
  core = core.replace(/\s+OFFSET\s+\d+\s*$/i, "");

  // Strip trailing LIMIT and capture the value
  const limitMatch = /\s+LIMIT\s+(\d+)\s*$/i.exec(core);
  if (limitMatch?.[1]) {
    userLimit = Number.parseInt(limitMatch[1], 10);
    core = core.slice(0, -limitMatch[0].length);
  }

  return { core, userLimit };
}

export async function executeQuery(
  params: ExecuteQueryParams,
): Promise<TableRowsResult> {
  validateQueryId(params.queryId);
  if (!isReadOnlyQuery(params.sql)) {
    throw new Error(
      "Only SELECT statements (including CTEs with WITH) are allowed.",
    );
  }

  if (activeQueries.has(params.queryId)) {
    throw new Error("A query with this identifier is already running.");
  }
  const active: ActiveQuery = {
    connectionId: params.connectionId,
    backendPid: null,
    cancelRequested: false,
    cancelPromise: null,
  };
  activeQueries.set(params.queryId, active);

  try {
    return await withPoolClient(params.connectionId, async (client) => {
      if (active.cancelRequested) {
        throw new Error("Query cancelled.");
      }
      active.backendPid = (
        client as PoolClient & { processID: number }
      ).processID;

      // Set the transaction to read-only for extra safety
      await client.query("BEGIN READ ONLY");
      try {
        const offset = (params.page - 1) * params.pageSize;
        const trimmedSql = params.sql.replace(/;\s*$/, "");
        const { core, userLimit } = stripLimitOffset(trimmedSql);

        const countResult = await client.query<{ count: string }>(
          extendedQuery(
            `SELECT count(*) AS count FROM (${core}) AS __count_subquery`,
          ),
        );
        let totalCount = parseCountRow(countResult.rows[0]?.count);

        // Honour the user's LIMIT as an upper bound on total rows.
        if (userLimit !== null && userLimit < totalCount) {
          totalCount = userLimit;
        }

        const dataResult = await client.query(
          `SELECT * FROM (${core}) AS __data_subquery LIMIT $1 OFFSET $2`,
          [params.pageSize, offset],
        );

        await client.query("COMMIT");

        const oids = dataResult.fields.map((f) => f.dataTypeID);
        const typeMap = await buildTypeMap(client, oids);
        const enumMap = await buildEnumTypeMap(client, oids);

        const columns: ColumnInfo[] = dataResult.fields.map((f) => {
          const enumInfo = enumMap.get(f.dataTypeID);
          return {
            name: f.name,
            dataTypeId: f.dataTypeID,
            dataType: typeMap.get(f.dataTypeID) ?? "unknown",
            ...(enumInfo
              ? { enumLabels: enumInfo.labels, enumPgCast: enumInfo.pgCast }
              : {}),
          };
        });

        // Ad-hoc queries span an arbitrary set of source relations (or none —
        // e.g. VALUES). There is no single primary key to return, so cells
        // from this code path are always read-only.
        return { columns, rows: dataResult.rows, totalCount, primaryKey: null };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        if ((err as { code?: string }).code === "57014") {
          throw new Error("Query cancelled.");
        }
        throw err;
      } finally {
        await active.cancelPromise?.catch(() => false);
      }
    });
  } finally {
    activeQueries.delete(params.queryId);
  }
}

export async function cancelQuery(
  connectionId: string,
  queryId: string,
): Promise<"cancel-requested" | "already-finished"> {
  validateQueryId(queryId);
  const active = activeQueries.get(queryId);
  if (!active || active.connectionId !== connectionId) {
    return "already-finished";
  }
  if (active.cancelRequested) {
    return "cancel-requested";
  }
  if (active.cancelPromise) {
    return "cancel-requested";
  }
  if (active.backendPid === null) {
    active.cancelRequested = true;
    return "cancel-requested";
  }

  const cancelPromise = withDedicatedClient(connectionId, async (client) => {
    const result = await client.query<{ cancelled: boolean }>(
      "SELECT pg_cancel_backend($1) AS cancelled",
      [active.backendPid],
    );
    return result.rows[0]?.cancelled === true;
  });
  active.cancelPromise = cancelPromise;
  try {
    const cancelled = await cancelPromise;
    if (cancelled) {
      active.cancelRequested = true;
      return "cancel-requested";
    }
    return "already-finished";
  } finally {
    if (active.cancelPromise === cancelPromise) {
      active.cancelPromise = null;
    }
  }
}
