import { isReservedWord, parseDataQuery } from "./parser";
import type {
  BoundDataQuery,
  BoundFilter,
  ComparisonOperator,
  DataQueryAst,
  DataQueryInput,
  DataQueryResult,
  FilterExpression,
  IdentifierNode,
  QueryColumnMetadata,
  QueryDslError,
  QueryDslField,
  QueryTypeFamily,
  ScalarNode,
} from "./types";

type OperatorGroup = "equality" | "ordering" | "membership" | "pattern";

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
    jsonb: {
      operators: new Set(["equality", "membership"]),
      literal: "string",
      label: "jsonb",
    },
    other: { operators: new Set(), literal: null, label: "this type" },
  };

export function operatorGroup(operator: ComparisonOperator): OperatorGroup {
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

function checkLiteral(
  value: ScalarNode,
  column: QueryColumnMetadata,
  capabilities: FamilyCapabilities,
): void {
  if (capabilities.literal === null || value.kind === capabilities.literal) {
    return;
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

  const column = resolveColumn(expression.column, "filter", columns);
  if (expression.kind === "null-check") {
    return {
      kind: "null-check",
      column: column.name,
      negated: expression.negated,
    };
  }

  const capabilities = FAMILY_CAPABILITIES[column.family];
  if (expression.kind === "membership") {
    if (!capabilities.operators.has("membership")) {
      throw unsupportedOperator(
        expression.negated ? "NOT IN" : "IN",
        column,
        capabilities,
        expression.range,
      );
    }
    for (const value of expression.values) {
      checkLiteral(value, column, capabilities);
    }
    return {
      kind: "membership",
      column: column.name,
      negated: expression.negated,
      values: expression.values,
    };
  }

  if (!capabilities.operators.has(operatorGroup(expression.operator))) {
    throw unsupportedOperator(
      expression.operator,
      column,
      capabilities,
      expression.range,
    );
  }
  checkLiteral(expression.value, column, capabilities);
  return {
    kind: "comparison",
    column: column.name,
    operator: expression.operator,
    value: expression.value,
  };
}

function checkItemCount(
  count: number,
  field: QueryDslField,
  columns: QueryColumnMetadata[],
  inputEnd: number,
): void {
  if (count <= columns.length) return;
  throw new BindError(
    "limit-exceeded",
    `This relation has ${columns.length} columns; list each at most once.`,
    field,
    0,
    inputEnd,
  );
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
    const lastItem = ast.projection.at(-1);
    checkItemCount(
      ast.projection.length,
      "projection",
      columns,
      lastItem?.range.to ?? 0,
    );
    return ast.projection.map((item) => {
      const column = resolveColumn(item.column, "projection", columns);
      return {
        column: column.name,
        outputName: item.alias?.value ?? column.name,
        aliased: item.alias !== undefined,
      };
    });
  });

  const sort = attempt(() => {
    const lastItem = ast.sort.at(-1);
    checkItemCount(ast.sort.length, "sort", columns, lastItem?.range.to ?? 0);
    return ast.sort.map((item) => ({
      column: resolveColumn(item.column, "sort", columns).name,
      direction: item.direction,
    }));
  });

  if (errors.length > 0 || filter === undefined || !projection || !sort) {
    return { ok: false, errors };
  }
  return { ok: true, value: { filter, projection, sort } };
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
