import type {
  BoundDataQuery,
  BoundFilter,
  ComparisonOperator,
  ScalarNode,
} from "../../shared/query-dsl/types";
import { quoteIdent } from "../pg-utils";

/**
 * SQL fragments for one bound Data-tab query. Identifiers come from the
 * catalog and are quoted here; keywords and operators come from closed
 * enums; every user value is a positional parameter in `values`.
 */
export interface CompiledDataQuery {
  /** `*` or quoted bound columns with optional quoted aliases. */
  selectListSql: string;
  /** Empty, or a boolean expression without the `WHERE` keyword. */
  whereSql: string;
  /** Empty, or an ordering without the `ORDER BY` keywords. */
  orderBySql: string;
  /** Filter parameters, in placeholder order ($1, $2, …). */
  values: unknown[];
  hasProjection: boolean;
  /** Rows skipped before the result starts, or null. */
  skip: number | null;
  /** Maximum rows in the result, or null for no limit. */
  limit: number | null;
}

const OPERATOR_SQL: Record<ComparisonOperator, string> = {
  "=": "=",
  "!=": "<>",
  "<>": "<>",
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<=",
  LIKE: "LIKE",
  ILIKE: "ILIKE",
};

function parameterValue(scalar: ScalarNode): unknown {
  // Numbers stay as their lexeme so numeric/int8 values keep full precision;
  // PostgreSQL converts them to the column's type.
  return scalar.value;
}

function compileFilter(filter: BoundFilter, values: unknown[]): string {
  if (filter.kind === "logical") {
    const left = compileFilter(filter.left, values);
    const right = compileFilter(filter.right, values);
    const operator = filter.operator === "AND" ? "AND" : "OR";
    return `(${left} ${operator} ${right})`;
  }

  const column = quoteIdent(filter.column);
  if (filter.kind === "null-check") {
    return filter.negated ? `${column} IS NOT NULL` : `${column} IS NULL`;
  }

  if (filter.kind === "membership") {
    const placeholders = filter.values.map((value) => {
      values.push(parameterValue(value));
      return `$${values.length}`;
    });
    const keyword = filter.negated ? "NOT IN" : "IN";
    return `${column} ${keyword} (${placeholders.join(", ")})`;
  }

  values.push(parameterValue(filter.value));
  return `${column} ${OPERATOR_SQL[filter.operator]} $${values.length}`;
}

/**
 * Compiles a bound query. `primaryKey` columns missing from the sort are
 * appended ascending so pagination stays stable; without a sort this
 * reproduces the default primary-key ordering.
 *
 * ORDER BY columns are qualified with `relationSql` (the quoted
 * `"schema"."table"`): PostgreSQL resolves a bare ORDER BY name to a
 * SELECT-list alias first, so `display_name AS name` would otherwise
 * hijack a sort on the real `name` column or a primary-key tie-breaker.
 */
export function compileDataQuery(
  bound: BoundDataQuery,
  primaryKey: string[] | null,
  relationSql: string,
): CompiledDataQuery {
  const values: unknown[] = [];
  const whereSql = bound.filter ? compileFilter(bound.filter, values) : "";

  const hasProjection = bound.projection.length > 0;
  const selectListSql = hasProjection
    ? bound.projection
        .map((item) =>
          item.aliased
            ? `${quoteIdent(item.column)} AS ${quoteIdent(item.outputName)}`
            : quoteIdent(item.column),
        )
        .join(", ")
    : "*";

  const orderParts = bound.sort.map(
    (item) =>
      `${relationSql}.${quoteIdent(item.column)} ${item.direction === "DESC" ? "DESC" : "ASC"}`,
  );
  const sortedColumns = new Set(bound.sort.map((item) => item.column));
  for (const column of primaryKey ?? []) {
    if (sortedColumns.has(column)) continue;
    orderParts.push(`${relationSql}.${quoteIdent(column)} ASC`);
  }

  return {
    selectListSql,
    whereSql,
    orderBySql: orderParts.join(", "),
    values,
    hasProjection,
    skip: bound.skip,
    limit: bound.limit,
  };
}

/**
 * Where one Data-tab page falls inside the query's Skip/Limit window.
 * `count` is the number of rows the query returns in total (the Rows
 * badge); `offset`/`limit` go straight into the page's SQL.
 */
export function pageWindow(
  compiled: Pick<CompiledDataQuery, "skip" | "limit">,
  page: number,
  pageSize: number,
  matchingRows: number,
): { count: number; offset: number; limit: number } {
  const skip = compiled.skip ?? 0;
  const afterSkip = Math.max(0, matchingRows - skip);
  const count =
    compiled.limit === null ? afterSkip : Math.min(afterSkip, compiled.limit);
  const pageStart = (page - 1) * pageSize;
  const rowsLeft = Math.max(0, count - pageStart);
  return {
    count,
    offset: skip + pageStart,
    limit: Math.min(pageSize, rowsLeft),
  };
}

/**
 * The complete `SELECT` for a compiled query over a whole relation, with
 * Skip/Limit as parameters after the filter's. Used by export and by the
 * SQL preview, so the preview shows exactly what the export runs.
 */
export function buildRelationQuery(
  relationSql: string,
  compiled: CompiledDataQuery,
): { text: string; values: unknown[] } {
  const values = [...compiled.values];
  const lines = [`SELECT ${compiled.selectListSql}`, `FROM ${relationSql}`];
  if (compiled.whereSql) lines.push(`WHERE ${compiled.whereSql}`);
  if (compiled.orderBySql) lines.push(`ORDER BY ${compiled.orderBySql}`);
  if (compiled.skip !== null) {
    values.push(compiled.skip);
    lines.push(`OFFSET $${values.length}`);
  }
  if (compiled.limit !== null) {
    values.push(compiled.limit);
    lines.push(`LIMIT $${values.length}`);
  }
  return { text: lines.join("\n"), values };
}
