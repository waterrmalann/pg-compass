import {
  FAMILY_CAPABILITIES,
  formatIdentifier,
  isJsonFamily,
} from "@/shared/query-dsl/bind";
import { DSL_KEYWORDS } from "@/shared/query-dsl/parser";
import { tokenize } from "@/shared/query-dsl/tokenizer";
import type {
  BoundPathSegment,
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
  /**
   * Set right after `column.` or `column.path.` on a JSON column: the
   * options are that value's object keys, which the caller loads.
   */
  jsonKeys?: { column: string; path: BoundPathSegment[] };
}

/** The word the cursor is currently inside. */
const PARTIAL_WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * Where the partially typed text at the cursor starts: an unclosed quoted
 * name runs from its opening quote, found by the tokenizer so a closed
 * one (`"a b".na`) isn't mistaken for it; otherwise the current word.
 */
function partialStart(field: QueryDslField, text: string): number {
  const tokenized = tokenize(field, text);
  const unclosedName =
    !tokenized.ok && tokenized.errors[0]?.code === "unterminated-identifier";
  if (unclosedName) return tokenized.errors[0]!.from;
  const word = PARTIAL_WORD_PATTERN.exec(text)?.[0] ?? "";
  return text.length - word.length;
}

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

function pathSegment(token: Token | undefined): BoundPathSegment | null {
  if (token?.kind === "word") return { kind: "key", value: token.raw };
  if (token?.kind === "quoted-identifier") {
    return { kind: "key", value: token.value };
  }
  if (token?.kind === "number") {
    return { kind: "index", value: Number(token.value) };
  }
  return null;
}

/** A column, possibly followed by a path, ending at the last token. */
interface TrailingReference {
  column: Token;
  path: BoundPathSegment[];
  /** The token before the column, which says where the reference sits. */
  before: Token | undefined;
}

function trailingReference(tokens: Token[]): TrailingReference | null {
  let index = tokens.length - 1;
  const path: BoundPathSegment[] = [];
  while (index > 0 && tokens[index - 1]?.kind === "dot") {
    const segment = pathSegment(tokens[index]);
    if (!segment) return null;
    path.unshift(segment);
    index -= 2;
  }
  const column = tokens[index];
  if (!column || !isIdentifier(column)) return null;
  return { column, path, before: tokens[index - 1] };
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

/** Every operator a JSON path accepts, most common first. */
const PATH_OPERATORS: DslCompletionOption[] = [
  operator("="),
  operator("!="),
  operator(">"),
  operator(">="),
  operator("<"),
  operator("<="),
  keyword("LIKE"),
  keyword("ILIKE"),
  keyword("IN"),
  keyword("NOT IN"),
  keyword("CONTAINS"),
  keyword("HAS"),
  keyword("IS NULL"),
  keyword("IS NOT NULL"),
];

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
  if (capabilities.operators.has("containment")) {
    options.push(keyword("CONTAINS"));
  }
  if (capabilities.operators.has("key-exists")) options.push(keyword("HAS"));
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

  const reference = trailingReference(tokens);
  if (reference && startsPredicate(reference.before)) {
    if (reference.path.length > 0) return PATH_OPERATORS;
    return operatorsFor(findColumn(reference.column, columns));
  }
  if (isWord(last, "IS")) return [keyword("NULL"), keyword("NOT NULL")];
  if (isWord(last, "NOT") && isWord(beforeLast, "IS")) return [keyword("NULL")];
  if (isWord(last, "NOT")) return [keyword("IN")];

  const expectsValue =
    last?.kind === "operator" ||
    isWord(last, "LIKE") ||
    isWord(last, "ILIKE") ||
    isWord(last, "CONTAINS") ||
    isWord(last, "HAS");
  if (expectsValue) {
    const compared = trailingReference(tokens.slice(0, -1));
    const isWholeColumn = compared !== null && compared.path.length === 0;
    const column = isWholeColumn
      ? findColumn(compared.column, columns)
      : undefined;
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
  const startsItem =
    last === undefined || isPunctuation(last, ",") || last.kind === "exclude";
  if (startsItem) return columnOptions(columns);
  const reference = trailingReference(tokens);
  // After `-column` nothing may follow but a comma: exclusions have no alias.
  const itemStarted =
    reference !== null &&
    (reference.before === undefined || isPunctuation(reference.before, ","));
  if (!itemStarted) return [];
  if (field === "projection") return [keyword("AS")];
  return [keyword("ASC"), keyword("DESC")];
}

/**
 * After `column.` or `column.path.`: the JSON value whose keys to offer, if
 * the reference sits where a column may start and the column is JSON.
 */
function jsonKeysRequest(
  field: QueryDslField,
  textBeforeDot: string,
  columns: QueryColumnMetadata[],
): DslCompletionResult["jsonKeys"] | null {
  const tokenized = tokenize(field, textBeforeDot);
  if (!tokenized.ok) return null;
  const reference = trailingReference(tokenized.value);
  if (!reference) return null;
  const column = findColumn(reference.column, columns);
  if (!column || !isJsonFamily(column.family)) return null;
  const startsHere =
    field === "filter"
      ? startsPredicate(reference.before)
      : reference.before === undefined || isPunctuation(reference.before, ",");
  if (!startsHere) return null;
  return { column: column.name, path: reference.path };
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
  const from = partialStart(field, textBeforeCursor);

  // A bare `-` in Project only becomes an exclusion once a column follows,
  // so offer columns when it starts an item.
  const beforePartial = textBeforeCursor.slice(0, from);
  const isAfterDot = beforePartial.endsWith(".");
  if (
    isAfterDot &&
    (field === "filter" || field === "projection" || field === "sort")
  ) {
    const textBeforeDot = beforePartial.slice(0, -1);
    const jsonKeys = jsonKeysRequest(field, textBeforeDot, columns);
    return jsonKeys ? { from, options: [], jsonKeys } : null;
  }
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
