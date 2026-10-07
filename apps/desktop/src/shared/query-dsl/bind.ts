import { formatPath, isReservedWord, parseDataQuery } from "./parser";
import type {
  BoundDataQuery,
  BoundFilter,
  BoundReference,
  ComparisonOperator,
  DataQueryAst,
  DataQueryInput,
  DataQueryResult,
  FilterExpression,
  IdentifierNode,
  PathSegment,
  QueryColumnMetadata,
  QueryDslError,
  QueryDslField,
  QueryTypeFamily,
  ScalarNode,
} from "./types";

type OperatorGroup =
  | "equality"
  | "ordering"
  | "membership"
  | "pattern"
  | "containment"
  | "key-exists";

interface FamilyCapabilities {
  operators: ReadonlySet<OperatorGroup>;
  /** Literal kind a comparison value must use. */
  literal: ScalarNode["kind"] | null;
  label: string;
}

const ALL_BUT_PATTERN = new Set<OperatorGroup>([
  "equality",
  "ordering",
  "membership",
]);

/** Whole `json`/`jsonb` columns: document equality plus JSON operators. */
const JSON_COLUMN_OPERATORS = new Set<OperatorGroup>([
  "equality",
  "membership",
  "containment",
  "key-exists",
]);

/**
 * Filter capabilities per type family. Null checks are always allowed.
 * Families outside this table ("other") support null checks only.
 */
export const FAMILY_CAPABILITIES: Record<QueryTypeFamily, FamilyCapabilities> =
  {
    text: {
      operators: new Set(["equality", "ordering", "membership", "pattern"]),
      literal: "string",
      label: "text",
    },
    numeric: {
      operators: ALL_BUT_PATTERN,
      literal: "number",
      label: "numeric",
    },
    temporal: {
      operators: ALL_BUT_PATTERN,
      literal: "string",
      label: "date/time",
    },
    boolean: {
      operators: new Set(["equality", "membership"]),
      literal: "boolean",
      label: "boolean",
    },
    enum: { operators: ALL_BUT_PATTERN, literal: "string", label: "enum" },
    uuid: {
      operators: new Set(["equality", "membership"]),
      literal: "string",
      label: "uuid",
    },
    json: {
      operators: JSON_COLUMN_OPERATORS,
      literal: "string",
      label: "json",
    },
    jsonb: {
      operators: JSON_COLUMN_OPERATORS,
      literal: "string",
      label: "jsonb",
    },
    other: { operators: new Set(), literal: null, label: "this type" },
  };

/** Families whose columns accept paths. */
export function isJsonFamily(family: QueryTypeFamily): boolean {
  return family === "json" || family === "jsonb";
}

/**
 * Literal kinds each operator group accepts on a JSON path. A path compares
 * against a JSON scalar of the literal's own type.
 */
const PATH_LITERALS: Record<OperatorGroup, ScalarNode["kind"][]> = {
  equality: ["string", "number", "boolean"],
  membership: ["string", "number", "boolean"],
  ordering: ["string", "number"],
  pattern: ["string"],
  containment: ["string"],
  "key-exists": ["string"],
};

export function operatorGroup(operator: ComparisonOperator): OperatorGroup {
  if (operator === "CONTAINS") return "containment";
  if (operator === "HAS") return "key-exists";
  if (operator === "LIKE" || operator === "ILIKE") return "pattern";
  if (operator === "=" || operator === "!=" || operator === "<>") {
    return "equality";
  }
  return "ordering";
}

const LITERAL_EXAMPLES: Record<ScalarNode["kind"], string> = {
  string: "a quoted string such as '2026-01-01'",
  number: "a number",
  boolean: "TRUE or FALSE",
};

class BindError extends Error {
  constructor(
    readonly code: QueryDslError["code"],
    message: string,
    readonly field: QueryDslField,
    readonly from: number,
    readonly to: number,
  ) {
    super(message);
  }
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(above + 1, previous[j - 1]! + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return previous[b.length]!;
}

/** Spells a column the way the DSL needs it typed. */
export function formatIdentifier(name: string): string {
  const isSimple = /^[a-z_][a-z0-9_$]*$/.test(name);
  if (isSimple && !isReservedWord(name)) {
    return name;
  }
  return `"${name.replaceAll('"', '""')}"`;
}

function resolveColumn(
  node: IdentifierNode,
  field: QueryDslField,
  columns: QueryColumnMetadata[],
): QueryColumnMetadata {
  const exact = columns.find((column) => column.name === node.value);
  if (exact) return exact;

  const caseInsensitive = columns.find(
    (column) => column.name.toLowerCase() === node.value.toLowerCase(),
  );
  if (caseInsensitive && !node.quoted) {
    throw new BindError(
      "case-mismatch",
      `Column "${node.value}" does not exist. Mixed-case names must be quoted: ${formatIdentifier(caseInsensitive.name)}.`,
      field,
      node.range.from,
      node.range.to,
    );
  }

  let suggestion = caseInsensitive?.name;
  if (!suggestion) {
    let bestDistance = 3;
    for (const column of columns) {
      const distance = editDistance(
        node.value.toLowerCase(),
        column.name.toLowerCase(),
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        suggestion = column.name;
      }
    }
  }
  const hint = suggestion
    ? ` Did you mean ${formatIdentifier(suggestion)}?`
    : "";
  throw new BindError(
    "unknown-column",
    `Column "${node.value}" does not exist.${hint}`,
    field,
    node.range.from,
    node.range.to,
  );
}

const JSON_OPERATOR_LITERAL_HINTS: Partial<Record<OperatorGroup, string>> = {
  containment:
    'CONTAINS needs JSON text in single quotes, such as \'{"status": "active"}\'.',
  "key-exists": "HAS needs a key in single quotes, such as 'status'.",
};

const PATH_LITERAL_DESCRIPTIONS: Record<OperatorGroup, string> = {
  equality: "a quoted string, a number, TRUE or FALSE",
  membership: "quoted strings, numbers, TRUE or FALSE",
  ordering: "a quoted string or a number",
  pattern: "a quoted string",
  containment: "a quoted string",
  "key-exists": "a quoted string",
};

/**
 * A resolved column with its (possibly empty) path. `text` is how the
 * reference reads in messages.
 */
interface ResolvedReference {
  column: QueryColumnMetadata;
  bound: BoundReference;
  text: string;
}

function resolveReference(
  node: { column: IdentifierNode; path: PathSegment[] },
  field: QueryDslField,
  columns: QueryColumnMetadata[],
): ResolvedReference {
  const column = resolveColumn(node.column, field, columns);
  const hasPath = node.path.length > 0;
  if (hasPath && !isJsonFamily(column.family)) {
    throw new BindError(
      "path-not-supported",
      `"${column.name}" is ${column.typeName}; only json and jsonb columns have paths.`,
      field,
      node.column.range.from,
      node.path.at(-1)!.range.to,
    );
  }
  const path = node.path.map((segment) =>
    segment.kind === "key"
      ? { kind: "key" as const, value: segment.value }
      : { kind: "index" as const, value: segment.value },
  );
  return {
    column,
    bound: {
      column: column.name,
      path,
      convertToJsonb: column.family === "json",
    },
    text: `${column.name}${formatPath(path)}`,
  };
}

function checkJsonText(value: ScalarNode): void {
  if (value.kind !== "string") return;
  try {
    JSON.parse(value.value);
  } catch {
    throw new BindError(
      "invalid-json",
      `CONTAINS needs valid JSON, such as '{"status": "active"}' or '["a", "b"]'.`,
      "filter",
      value.range.from,
      value.range.to,
    );
  }
}

function checkPathLiteral(
  value: ScalarNode,
  group: OperatorGroup,
  operatorLabel: string,
  reference: ResolvedReference,
): void {
  if (PATH_LITERALS[group].includes(value.kind)) return;
  const message =
    JSON_OPERATOR_LITERAL_HINTS[group] ??
    `${operatorLabel} on "${reference.text}" needs ${PATH_LITERAL_DESCRIPTIONS[group]}.`;
  throw new BindError(
    "literal-type-mismatch",
    message,
    "filter",
    value.range.from,
    value.range.to,
  );
}

function checkLiteral(
  value: ScalarNode,
  column: QueryColumnMetadata,
  capabilities: FamilyCapabilities,
  group: OperatorGroup,
): void {
  if (capabilities.literal === null || value.kind === capabilities.literal) {
    return;
  }
  const jsonHint = JSON_OPERATOR_LITERAL_HINTS[group];
  if (jsonHint) {
    throw new BindError(
      "literal-type-mismatch",
      jsonHint,
      "filter",
      value.range.from,
      value.range.to,
    );
  }
  throw new BindError(
    "literal-type-mismatch",
    `"${column.name}" is ${column.typeName}; compare it with ${LITERAL_EXAMPLES[capabilities.literal]}.`,
    "filter",
    value.range.from,
    value.range.to,
  );
}

function unsupportedOperator(
  operatorLabel: string,
  column: QueryColumnMetadata,
  capabilities: FamilyCapabilities,
  range: { from: number; to: number },
): BindError {
  const nullOnly = capabilities.operators.size === 0;
  const hint = nullOnly ? " Only IS NULL and IS NOT NULL are supported." : "";
  return new BindError(
    "operator-not-supported",
    `${operatorLabel} is not supported for "${column.name}" (${column.typeName}).${hint}`,
    "filter",
    range.from,
    range.to,
  );
}

function bindFilter(
  expression: FilterExpression,
  columns: QueryColumnMetadata[],
): BoundFilter {
  if (expression.kind === "logical") {
    return {
      kind: "logical",
      operator: expression.operator,
      left: bindFilter(expression.left, columns),
      right: bindFilter(expression.right, columns),
    };
  }

  const reference = resolveReference(expression, "filter", columns);
  const { column, bound } = reference;
  const isPath = bound.path.length > 0;
  if (expression.kind === "null-check") {
    return { kind: "null-check", ...bound, negated: expression.negated };
  }

  const capabilities = FAMILY_CAPABILITIES[column.family];
  if (expression.kind === "membership") {
    const operatorLabel = expression.negated ? "NOT IN" : "IN";
    // Every JSON path supports IN; whole columns follow their family.
    if (!isPath && !capabilities.operators.has("membership")) {
      throw unsupportedOperator(
        operatorLabel,
        column,
        capabilities,
        expression.range,
      );
    }
    for (const value of expression.values) {
      if (isPath) {
        checkPathLiteral(value, "membership", operatorLabel, reference);
      } else {
        checkLiteral(value, column, capabilities, "membership");
      }
    }
    return {
      kind: "membership",
      ...bound,
      negated: expression.negated,
      values: expression.values,
    };
  }

  const group = operatorGroup(expression.operator);
  if (isPath) {
    checkPathLiteral(expression.value, group, expression.operator, reference);
  } else {
    if (!capabilities.operators.has(group)) {
      throw unsupportedOperator(
        expression.operator,
        column,
        capabilities,
        expression.range,
      );
    }
    checkLiteral(expression.value, column, capabilities, group);
  }
  if (group === "containment") checkJsonText(expression.value);
  return {
    kind: "comparison",
    ...bound,
    operator: expression.operator,
    value: expression.value,
  };
}

/** Most JSON paths one Project or Sort field may list. */
export const MAX_PATH_ITEMS = 100;

function checkItemCount(
  items: { path: PathSegment[]; range: { to: number } }[],
  field: QueryDslField,
  columns: QueryColumnMetadata[],
): void {
  const inputEnd = items.at(-1)?.range.to ?? 0;
  const pathCount = items.filter((item) => item.path.length > 0).length;
  const columnCount = items.length - pathCount;
  if (columnCount > columns.length) {
    throw new BindError(
      "limit-exceeded",
      `This relation has ${columns.length} columns; list each at most once.`,
      field,
      0,
      inputEnd,
    );
  }
  if (pathCount > MAX_PATH_ITEMS) {
    throw new BindError(
      "limit-exceeded",
      `List at most ${MAX_PATH_ITEMS} JSON paths.`,
      field,
      0,
      inputEnd,
    );
  }
}

/**
 * Resolves every identifier against the relation's catalog columns and
 * validates operators and literal kinds per type family. Pure: the main
 * process runs it against freshly loaded catalog metadata on every call.
 */
export function bindDataQuery(
  ast: DataQueryAst,
  columns: QueryColumnMetadata[],
): DataQueryResult<BoundDataQuery> {
  const errors: QueryDslError[] = [];

  function attempt<T>(bind: () => T): T | undefined {
    try {
      return bind();
    } catch (err) {
      if (!(err instanceof BindError)) throw err;
      errors.push({
        code: err.code,
        field: err.field,
        message: err.message,
        from: err.from,
        to: err.to,
      });
      return undefined;
    }
  }

  const filter = ast.filter
    ? attempt(() => bindFilter(ast.filter!, columns))
    : null;

  const projection = attempt(() => {
    checkItemCount(ast.projection, "projection", columns);
    const resolved = ast.projection.map((item) => ({
      item,
      reference: resolveReference(item, "projection", columns),
    }));
    const isExclusion = ast.projection[0]?.exclude === true;
    if (!isExclusion) {
      // An unaliased path is named as typed: `payload.status`.
      return resolved.map(({ item, reference }) => ({
        ...reference.bound,
        outputName: item.alias?.value ?? reference.text,
        aliased: item.alias !== undefined,
      }));
    }

    // `-a, -b`: every other column, in the relation's own order. The parser
    // only accepts whole columns here.
    const excluded = new Set(
      resolved.map(({ reference }) => reference.column.name),
    );
    const kept = columns.filter((column) => !excluded.has(column.name));
    if (kept.length === 0) {
      throw new BindError(
        "limit-exceeded",
        "Every column is excluded. Keep at least one.",
        "projection",
        ast.projection[0]!.range.from,
        ast.projection.at(-1)!.range.to,
      );
    }
    return kept.map((column) => ({
      column: column.name,
      path: [],
      convertToJsonb: column.family === "json",
      outputName: column.name,
      aliased: false,
    }));
  });

  const sort = attempt(() => {
    checkItemCount(ast.sort, "sort", columns);
    return ast.sort.map((item) => ({
      ...resolveReference(item, "sort", columns).bound,
      direction: item.direction,
    }));
  });

  if (errors.length > 0 || filter === undefined || !projection || !sort) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { filter, projection, sort, skip: ast.skip, limit: ast.limit },
  };
}

/** Parses and binds all three fields in one step. */
export function prepareDataQuery(
  input: DataQueryInput,
  columns: QueryColumnMetadata[],
): DataQueryResult<BoundDataQuery> {
  const parsed = parseDataQuery(input);
  if (!parsed.ok) return parsed;
  return bindDataQuery(parsed.value, columns);
}
