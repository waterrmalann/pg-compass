import { operatorGroup } from "../../shared/query-dsl/bind";
import type {
  BoundDataQuery,
  BoundFilter,
  BoundReference,
  ComparisonOperator,
  ScalarNode,
} from "../../shared/query-dsl/types";
import { quoteIdent } from "../pg-utils";

/**
 * SQL fragments for one bound Data-tab query. Identifiers come from the
 * catalog and are quoted here; keywords, operators, casts and JSON type
 * names come from closed enums; every user value and JSON path key is a
 * positional parameter.
 */
export interface CompiledDataQuery {
  /** `*` or quoted bound columns and paths with optional quoted aliases. */
  selectListSql: string;
  /** Empty, or a boolean expression without the `WHERE` keyword. */
  whereSql: string;
  /** Empty, or an ordering without the `ORDER BY` keywords. */
  orderBySql: string;
  /**
   * Every parameter in placeholder order: the filter's first ($1…$k), then
   * path keys from Project and Sort. For statements using all fragments.
   */
  values: unknown[];
  /**
   * The filter's parameters alone ($1…$k), for statements that use only
   * `whereSql` (counts, delete). PostgreSQL rejects unreferenced ones.
   */
  filterValues: unknown[];
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
  CONTAINS: "@>",
  HAS: "?",
};

/**
 * How a DSL literal becomes a JSON scalar on a path: the parameter's cast
 * for `to_jsonb`, and the `jsonb_typeof` name values of that type report.
 */
const JSON_LITERALS: Record<
  ScalarNode["kind"],
  { cast: string; jsonType: string }
> = {
  string: { cast: "text", jsonType: "string" },
  number: { cast: "numeric", jsonType: "number" },
  boolean: { cast: "boolean", jsonType: "boolean" },
};

function parameterValue(scalar: ScalarNode): unknown {
  // Numbers stay as their lexeme so numeric/int8 values keep full precision;
  // PostgreSQL converts them to the column's type.
  return scalar.value;
}

/** Appends a parameter and returns its placeholder. */
function pushParameter(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

/**
 * A column, or a `->` chain into it. `json` columns are converted to
 * `jsonb` first so every JSON operator is available. Keys are text
 * parameters and indexes int parameters.
 */
function referenceSql(
  reference: BoundReference,
  values: unknown[],
  qualifier?: string,
): string {
  const columnSql = qualifier
    ? `${qualifier}.${quoteIdent(reference.column)}`
    : quoteIdent(reference.column);
  const base = reference.convertToJsonb ? `${columnSql}::jsonb` : columnSql;
  if (reference.path.length === 0) return base;

  const steps = reference.path.map((segment) => {
    const placeholder = pushParameter(values, segment.value);
    const cast = segment.kind === "key" ? "text" : "int";
    return ` -> ${placeholder}::${cast}`;
  });
  return `(${base}${steps.join("")})`;
}

/** A DSL literal as a JSON scalar: `'a'` is "a", `10` is 10. */
function jsonLiteralSql(value: ScalarNode, values: unknown[]): string {
  const placeholder = pushParameter(values, parameterValue(value));
  return `to_jsonb(${placeholder}::${JSON_LITERALS[value.kind].cast})`;
}

/**
 * A condition on a JSON path. Comparisons are typed: ordering and patterns
 * only match values of the literal's JSON type, so mixed data never raises
 * a cast error. A missing key and JSON null both count as NULL.
 */
function compilePathFilter(
  filter: Exclude<BoundFilter, { kind: "logical" }>,
  values: unknown[],
): string {
  const target = referenceSql(filter, values);
  if (filter.kind === "null-check") {
    const operator = filter.negated ? "<>" : "=";
    return `COALESCE(jsonb_typeof(${target}), 'null') ${operator} 'null'`;
  }

  if (filter.kind === "membership") {
    const literals = filter.values.map((value) =>
      jsonLiteralSql(value, values),
    );
    const keyword = filter.negated ? "NOT IN" : "IN";
    return `${target} ${keyword} (${literals.join(", ")})`;
  }

  const operator = OPERATOR_SQL[filter.operator];
  const group = operatorGroup(filter.operator);
  if (group === "containment") {
    return `${target} @> ${pushParameter(values, filter.value.value)}::jsonb`;
  }
  if (group === "key-exists") {
    return `${target} ? ${pushParameter(values, filter.value.value)}::text`;
  }
  if (group === "pattern") {
    const placeholder = pushParameter(values, filter.value.value);
    return `(jsonb_typeof(${target}) = 'string' AND (${target} #>> '{}') ${operator} ${placeholder})`;
  }
  const literal = jsonLiteralSql(filter.value, values);
  if (group === "ordering") {
    const jsonType = JSON_LITERALS[filter.value.kind].jsonType;
    return `(jsonb_typeof(${target}) = '${jsonType}' AND ${target} ${operator} ${literal})`;
  }
  return `${target} ${operator} ${literal}`;
}

function compileFilter(filter: BoundFilter, values: unknown[]): string {
  if (filter.kind === "logical") {
    const left = compileFilter(filter.left, values);
    const right = compileFilter(filter.right, values);
    const operator = filter.operator === "AND" ? "AND" : "OR";
    return `(${left} ${operator} ${right})`;
  }

  if (filter.path.length > 0) return compilePathFilter(filter, values);

  if (filter.kind === "null-check") {
    const column = quoteIdent(filter.column);
    return filter.negated ? `${column} IS NOT NULL` : `${column} IS NULL`;
  }

  const column = referenceSql(filter, values);
  if (filter.kind === "membership") {
    const placeholders = filter.values.map((value) =>
      pushParameter(values, parameterValue(value)),
    );
    const keyword = filter.negated ? "NOT IN" : "IN";
    return `${column} ${keyword} (${placeholders.join(", ")})`;
  }

  const placeholder = pushParameter(values, parameterValue(filter.value));
  const group = operatorGroup(filter.operator);
  if (group === "containment") return `${column} @> ${placeholder}::jsonb`;
  if (group === "key-exists") return `${column} ? ${placeholder}::text`;
  return `${column} ${OPERATOR_SQL[filter.operator]} ${placeholder}`;
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
  // The filter is compiled first so its parameters are $1…$k and can be
  // sent alone with `whereSql`.
  const values: unknown[] = [];
  const whereSql = bound.filter ? compileFilter(bound.filter, values) : "";
  const filterValues = [...values];

  const hasProjection = bound.projection.length > 0;
  const selectListSql = hasProjection
    ? bound.projection
        .map((item) => {
          // Paths always get an alias: the output name as typed.
          if (item.path.length > 0) {
            return `${referenceSql(item, values)} AS ${quoteIdent(item.outputName)}`;
          }
          return item.aliased
            ? `${quoteIdent(item.column)} AS ${quoteIdent(item.outputName)}`
            : quoteIdent(item.column);
        })
        .join(", ")
    : "*";

  const orderParts = bound.sort.map(
    (item) =>
      `${referenceSql(item, values, relationSql)} ${item.direction === "DESC" ? "DESC" : "ASC"}`,
  );
  // A path sort doesn't order by the column itself, so it never stands in
  // for a primary-key tie-breaker.
  const sortedColumns = new Set(
    bound.sort
      .filter((item) => item.path.length === 0)
      .map((item) => item.column),
  );
  for (const column of primaryKey ?? []) {
    if (sortedColumns.has(column)) continue;
    orderParts.push(`${relationSql}.${quoteIdent(column)} ASC`);
  }

  return {
    selectListSql,
    whereSql,
    orderBySql: orderParts.join(", "),
    values,
    filterValues,
    hasProjection,
    skip: bound.skip,
    limit: bound.limit,
  };
}

/** Rows key completion samples, and the most keys it returns. */
export const JSON_KEY_SAMPLE_ROWS = 500;
export const MAX_JSON_KEYS = 200;

/**
 * Distinct object keys at a column or path, sampled from the first rows
 * where the column has a value. Feeds key completion only. Values that
 * aren't objects contribute no keys instead of raising an error.
 */
export function buildJsonKeysQuery(
  relationSql: string,
  reference: BoundReference,
): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const target = referenceSql(reference, values);
  const column = quoteIdent(reference.column);
  const text = [
    "SELECT DISTINCT sample_key AS key",
    `FROM (SELECT ${target} AS value FROM ${relationSql} WHERE ${column} IS NOT NULL LIMIT ${JSON_KEY_SAMPLE_ROWS}) AS sample`,
    "CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(sample.value) = 'object' THEN sample.value END) AS sample_key",
    "ORDER BY key",
    `LIMIT ${MAX_JSON_KEYS}`,
  ].join("\n");
  return { text, values };
}

/**
 * Where one Data-tab page falls inside the query's Skip/Limit window.
 * `resultRows` is how many rows the query returns once Skip and Limit
 * apply (the Rows badge); `offset`/`limit` go straight into the page's SQL.
 */
export function pageWindow(
  compiled: Pick<CompiledDataQuery, "skip" | "limit">,
  page: number,
  pageSize: number,
  resultRows: number,
): { count: number; offset: number; limit: number } {
  const skip = compiled.skip ?? 0;
  const count = resultRows;
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
