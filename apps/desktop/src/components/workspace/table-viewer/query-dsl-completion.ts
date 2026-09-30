import { FAMILY_CAPABILITIES, formatIdentifier } from "@/shared/query-dsl/bind";
import { DSL_KEYWORDS } from "@/shared/query-dsl/parser";
import { tokenize } from "@/shared/query-dsl/tokenizer";
import type {
  QueryColumnMetadata,
  QueryDslField,
  Token,
} from "@/shared/query-dsl/types";

export interface DslCompletionOption {
  label: string;
  apply: string;
  type: "property" | "keyword" | "operator";
  detail?: string;
}

export interface DslCompletionResult {
  /** Document offset where the replaced (partially typed) text starts. */
  from: number;
  options: DslCompletionOption[];
}

/** The word or opening quoted identifier the cursor is currently inside. */
const PARTIAL_PATTERN = /(?:"(?:[^"]|"")*|[A-Za-z_][A-Za-z0-9_$]*)$/;

function keyword(label: string): DslCompletionOption {
  return { label, apply: label, type: "keyword" };
}

function operator(label: string): DslCompletionOption {
  return { label, apply: label, type: "operator" };
}

function columnOptions(columns: QueryColumnMetadata[]): DslCompletionOption[] {
  return columns.map((column) => ({
    label: formatIdentifier(column.name),
    apply: formatIdentifier(column.name),
    type: "property",
    detail: column.typeName,
  }));
}

function isIdentifier(token: Token | undefined): boolean {
  if (!token) return false;
  if (token.kind === "quoted-identifier") return true;
  return token.kind === "word" && !DSL_KEYWORDS.has(token.upper);
}

function isWord(token: Token | undefined, upper: string): boolean {
  return token?.kind === "word" && token.upper === upper;
}

function isPunctuation(token: Token | undefined, value: string): boolean {
  return token?.kind === "punctuation" && token.value === value;
}

function findColumn(
  token: Token | undefined,
  columns: QueryColumnMetadata[],
): QueryColumnMetadata | undefined {
  if (!token) return undefined;
  if (token.kind !== "word" && token.kind !== "quoted-identifier") {
    return undefined;
  }
  return columns.find((column) => column.name === token.value);
}

/** Positions where a new predicate (column) may start. */
function startsPredicate(token: Token | undefined): boolean {
  return (
    token === undefined ||
    isWord(token, "AND") ||
    isWord(token, "OR") ||
    isPunctuation(token, "(")
  );
}

function operatorsFor(column: QueryColumnMetadata | undefined) {
  const capabilities = column
    ? FAMILY_CAPABILITIES[column.family]
    : FAMILY_CAPABILITIES.text;
  const options: DslCompletionOption[] = [];
  if (capabilities.operators.has("equality")) {
    options.push(operator("="), operator("!="));
  }
  if (capabilities.operators.has("ordering")) {
    options.push(operator(">"), operator(">="), operator("<"), operator("<="));
  }
  if (capabilities.operators.has("pattern")) {
    options.push(keyword("LIKE"), keyword("ILIKE"));
  }
  if (capabilities.operators.has("membership")) {
    options.push(keyword("IN"), keyword("NOT IN"));
  }
  options.push(keyword("IS NULL"), keyword("IS NOT NULL"));
  return options;
}

function filterOptions(
  tokens: Token[],
  columns: QueryColumnMetadata[],
): DslCompletionOption[] {
  const last = tokens.at(-1);
  const beforeLast = tokens.at(-2);

  if (isPunctuation(last, "(") && isWord(beforeLast, "IN")) return [];
  if (startsPredicate(last)) return columnOptions(columns);

  if (isIdentifier(last) && startsPredicate(beforeLast)) {
    return operatorsFor(findColumn(last, columns));
  }
  if (isWord(last, "IS")) return [keyword("NULL"), keyword("NOT NULL")];
  if (isWord(last, "NOT") && isWord(beforeLast, "IS")) return [keyword("NULL")];
  if (isWord(last, "NOT")) return [keyword("IN")];

  const expectsValue =
    last?.kind === "operator" || isWord(last, "LIKE") || isWord(last, "ILIKE");
  if (expectsValue) {
    const column = findColumn(beforeLast, columns);
    if (column?.family === "boolean") {
      return [keyword("TRUE"), keyword("FALSE")];
    }
    return [];
  }

  const endsCondition =
    last?.kind === "string" ||
    last?.kind === "number" ||
    isWord(last, "TRUE") ||
    isWord(last, "FALSE") ||
    isWord(last, "NULL") ||
    isPunctuation(last, ")");
  if (endsCondition) return [keyword("AND"), keyword("OR")];
  return [];
}

function listOptions(
  field: "projection" | "sort",
  tokens: Token[],
  columns: QueryColumnMetadata[],
): DslCompletionOption[] {
  const last = tokens.at(-1);
  const beforeLast = tokens.at(-2);
  const startsItem =
    last === undefined || isPunctuation(last, ",") || last.kind === "exclude";
  if (startsItem) return columnOptions(columns);
  const itemStarted =
    beforeLast === undefined || isPunctuation(beforeLast, ",");
  // After `-column` nothing may follow but a comma: exclusions have no alias.
  if (!isIdentifier(last) || !itemStarted) return [];
  if (field === "projection") return [keyword("AS")];
  return [keyword("ASC"), keyword("DESC")];
}

/**
 * Suggests columns, operators and keywords allowed at the cursor for one DSL
 * field. Returns null inside a string literal or after invalid input.
 */
export function suggestDslCompletions(
  field: QueryDslField,
  textBeforeCursor: string,
  columns: QueryColumnMetadata[],
): DslCompletionResult | null {
  const partial = PARTIAL_PATTERN.exec(textBeforeCursor)?.[0] ?? "";
  const from = textBeforeCursor.length - partial.length;

  // A bare `-` in Project only becomes an exclusion once a column follows,
  // so offer columns when it starts an item.
  const beforePartial = textBeforeCursor.slice(0, from);
  if (field === "projection" && beforePartial.endsWith("-")) {
    const beforeDash = tokenize(field, beforePartial.slice(0, -1));
    const last = beforeDash.ok ? beforeDash.value.at(-1) : undefined;
    const startsItem =
      beforeDash.ok && (last === undefined || isPunctuation(last, ","));
    return startsItem ? { from, options: columnOptions(columns) } : null;
  }
  const tokenized = tokenize(field, beforePartial);
  if (!tokenized.ok) return null;

  const tokens = tokenized.value;
  let options: DslCompletionOption[] = [];
  if (field === "filter") options = filterOptions(tokens, columns);
  if (field === "projection" || field === "sort") {
    options = listOptions(field, tokens, columns);
  }
  if (options.length === 0) return null;
  return { from, options };
}
