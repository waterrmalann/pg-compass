import { tokenize } from "./tokenizer";
import type {
  ComparisonOperator,
  DataQueryAst,
  DataQueryInput,
  DataQueryResult,
  FilterExpression,
  IdentifierNode,
  PathSegment,
  Projection,
  QueryDslError,
  QueryDslField,
  ScalarNode,
  Sort,
  SourceRange,
  Token,
} from "./types";

export const MAX_FILTER_NODES = 200;
export const MAX_FILTER_DEPTH = 32;
export const MAX_IN_VALUES = 1_000;
export const MAX_PATH_SEGMENTS = 16;
/** Largest array index in a path: PostgreSQL's `->` takes an int4. */
export const MAX_PATH_INDEX = 2_147_483_647;

/**
 * Words that act as operators only right after a column or path, so
 * columns named `contains` or `has` still work unquoted.
 */
export const JSON_OPERATOR_WORDS = new Set(["CONTAINS", "HAS"]);

/** Unquoted words with grammar meaning. Quote them to use them as columns. */
export const DSL_KEYWORDS = new Set([
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "LIKE",
  "ILIKE",
  "TRUE",
  "FALSE",
  "AS",
  "ASC",
  "DESC",
]);

const SQL_ONLY_KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "UNION",
  "BETWEEN",
  "EXISTS",
  "SIMILAR",
  "CASE",
  "CAST",
  "ORDER",
  "GROUP",
  "LIMIT",
  "OFFSET",
  "HAVING",
  "DISTINCT",
  "NULLS",
]);

/** True when an unquoted word would be read as syntax rather than a column. */
export function isReservedWord(word: string): boolean {
  const upper = word.toUpperCase();
  return DSL_KEYWORDS.has(upper) || SQL_ONLY_KEYWORDS.has(upper);
}

export const EMPTY_DATA_QUERY: DataQueryInput = {
  filter: "",
  projection: "",
  sort: "",
  skip: "",
  limit: "",
};

const QUERY_FIELDS = ["filter", "projection", "sort", "skip", "limit"] as const;

export function isEmptyDataQuery(query: DataQueryInput): boolean {
  return QUERY_FIELDS.every((field) => query[field].trim() === "");
}

export function dataQueryEquals(a: DataQueryInput, b: DataQueryInput): boolean {
  return QUERY_FIELDS.every((field) => a[field].trim() === b[field].trim());
}

/** Thrown inside a field parser; converted to a structured error at the edge. */
class DslSyntaxError extends Error {
  constructor(
    readonly code: QueryDslError["code"],
    message: string,
    readonly range: SourceRange,
  ) {
    super(message);
  }
}

function describeToken(token: Token): string {
  if (token.kind === "exclude") return '"-"';
  if (token.kind === "dot") return '"."';
  if (token.kind === "string") return "a string";
  if (token.kind === "number") return `"${token.value}"`;
  if (token.kind === "quoted-identifier") return `"${token.value}"`;
  if (token.kind === "word") return `"${token.upper}"`;
  return `"${token.value}"`;
}

/** Cursor over one field's tokens with small, explicit helpers. */
class TokenStream {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly inputLength: number,
  ) {}

  peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  next(): Token | undefined {
    const token = this.tokens[this.index];
    if (token) this.index += 1;
    return token;
  }

  isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  /** Range just after the last consumed token, for "expected …" errors. */
  endRange(): SourceRange {
    const previous = this.tokens[this.index - 1];
    const at = previous ? previous.range.to : 0;
    return { from: at, to: Math.max(at, this.inputLength) };
  }

  previous(): Token | undefined {
    return this.tokens[this.index - 1];
  }

  isWord(upper: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token?.kind === "word" && token.upper === upper;
  }

  isPunctuation(value: "(" | ")" | ",", offset = 0): boolean {
    const token = this.peek(offset);
    return token?.kind === "punctuation" && token.value === value;
  }
}

function unexpected(token: Token, message?: string): DslSyntaxError {
  return new DslSyntaxError(
    "unexpected-token",
    message ?? `Unexpected ${describeToken(token)}.`,
    token.range,
  );
}

function parseIdentifier(
  stream: TokenStream,
  expected: string,
): IdentifierNode {
  const token = stream.peek();
  if (!token) {
    throw new DslSyntaxError(
      "unexpected-token",
      `Expected ${expected}.`,
      stream.endRange(),
    );
  }
  if (token.kind === "quoted-identifier") {
    stream.next();
    return { value: token.value, quoted: true, range: token.range };
  }
  if (token.kind === "word") {
    if (DSL_KEYWORDS.has(token.upper)) {
      throw new DslSyntaxError(
        "keyword-as-identifier",
        `${token.upper} is a keyword. Quote it to use it as a column: "${token.value}".`,
        token.range,
      );
    }
    if (SQL_ONLY_KEYWORDS.has(token.upper)) {
      throw new DslSyntaxError(
        "unsupported-syntax",
        `${token.upper} is SQL, not part of this filter syntax. Quote it to use it as a column: "${token.value}".`,
        token.range,
      );
    }
    stream.next();
    return { value: token.value, quoted: false, range: token.range };
  }
  if (token.kind === "string") {
    throw new DslSyntaxError(
      "unexpected-token",
      `Expected ${expected}. Single quotes are for text values; use double quotes for column names.`,
      token.range,
    );
  }
  throw unexpected(
    token,
    `Expected ${expected}, found ${describeToken(token)}.`,
  );
}

function rejectFunctionCall(stream: TokenStream, column: IdentifierNode): void {
  if (stream.isPunctuation("(")) {
    const open = stream.peek()!;
    throw new DslSyntaxError(
      "unsupported-syntax",
      "Functions are not supported.",
      { from: column.range.from, to: open.range.to },
    );
  }
}

/** A column, optionally followed by a JSON path: `payload.items.0.sku`. */
interface Reference {
  column: IdentifierNode;
  path: PathSegment[];
  range: SourceRange;
}

function parsePathSegment(stream: TokenStream): PathSegment {
  const token = stream.next();
  if (token?.kind === "word") {
    return { kind: "key", value: token.raw, range: token.range };
  }
  if (token?.kind === "quoted-identifier") {
    return { kind: "key", value: token.value, range: token.range };
  }
  if (token?.kind === "number") {
    const index = Number(token.value);
    if (index > MAX_PATH_INDEX) {
      throw new DslSyntaxError(
        "limit-exceeded",
        `Array indexes can be at most ${MAX_PATH_INDEX.toLocaleString("en-US")}. Quote the segment to use it as a key: "${token.value}".`,
        token.range,
      );
    }
    return { kind: "index", value: index, range: token.range };
  }
  // The tokenizer only emits a dot before one of the tokens above.
  throw new DslSyntaxError(
    "unexpected-token",
    'Expected a key or an index after ".".',
    token?.range ?? stream.endRange(),
  );
}

function parseReference(stream: TokenStream, expected: string): Reference {
  const column = parseIdentifier(stream, expected);
  const path: PathSegment[] = [];
  while (stream.peek()?.kind === "dot") {
    stream.next();
    const segment = parsePathSegment(stream);
    if (path.length >= MAX_PATH_SEGMENTS) {
      throw new DslSyntaxError(
        "limit-exceeded",
        `Paths are limited to ${MAX_PATH_SEGMENTS} segments.`,
        segment.range,
      );
    }
    path.push(segment);
  }
  rejectFunctionCall(stream, column);
  const end = path.at(-1)?.range.to ?? column.range.to;
  return { column, path, range: { from: column.range.from, to: end } };
}

/** Spells a JSON key the way a path needs it typed. Keys never fold. */
export function formatPathKey(key: string): string {
  const isSimple = /^[A-Za-z_][A-Za-z0-9_$]*$/.test(key);
  if (isSimple) return key;
  return `"${key.replaceAll('"', '""')}"`;
}

/** Path segments as typed after the column: `.items.0."content-type"`. */
export function formatPath(
  path: readonly (
    | { kind: "key"; value: string }
    | { kind: "index"; value: number }
  )[],
): string {
  return path
    .map((segment) =>
      segment.kind === "index"
        ? `.${segment.value}`
        : `.${formatPathKey(segment.value)}`,
    )
    .join("");
}

/**
 * The reference as it would be retyped (folded column plus exact path).
 * Used for messages, duplicate checks and default output names.
 */
function referenceText(reference: Reference): string {
  return `${reference.column.value}${formatPath(reference.path)}`;
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

interface FilterState {
  nodeCount: number;
}

function countNode(state: FilterState, range: SourceRange): void {
  state.nodeCount += 1;
  if (state.nodeCount > MAX_FILTER_NODES) {
    throw new DslSyntaxError(
      "limit-exceeded",
      `Filters are limited to ${MAX_FILTER_NODES} conditions and operators.`,
      range,
    );
  }
}

function parseScalar(stream: TokenStream, after: string): ScalarNode {
  const token = stream.peek();
  if (!token) {
    throw new DslSyntaxError(
      "expected-value",
      `Expected a value after "${after}".`,
      stream.endRange(),
    );
  }
  if (token.kind === "string") {
    stream.next();
    return { kind: "string", value: token.value, range: token.range };
  }
  if (token.kind === "number") {
    stream.next();
    return { kind: "number", value: token.value, range: token.range };
  }
  if (
    token.kind === "word" &&
    (token.upper === "TRUE" || token.upper === "FALSE")
  ) {
    stream.next();
    return {
      kind: "boolean",
      value: token.upper === "TRUE",
      range: token.range,
    };
  }
  if (token.kind === "word" && token.upper === "NULL") {
    throw new DslSyntaxError(
      "unexpected-token",
      "Use IS NULL or IS NOT NULL to compare with NULL.",
      token.range,
    );
  }
  if (token.kind === "quoted-identifier") {
    throw new DslSyntaxError(
      "unsupported-syntax",
      `Double quotes are for column names, and columns can't be compared with each other. Use single quotes for text: '${token.value}'.`,
      token.range,
    );
  }
  if (token.kind === "word") {
    if (token.upper === "SELECT") {
      throw new DslSyntaxError(
        "unsupported-syntax",
        "Subqueries are not supported.",
        token.range,
      );
    }
    if (stream.isPunctuation("(", 1)) {
      throw new DslSyntaxError(
        "unsupported-syntax",
        "Functions are not supported.",
        { from: token.range.from, to: stream.peek(1)!.range.to },
      );
    }
    throw new DslSyntaxError(
      "expected-value",
      `Expected a value after "${after}". Wrap text in single quotes: '${token.value}'.`,
      token.range,
    );
  }
  if (token.kind === "punctuation" && token.value === "(") {
    throw new DslSyntaxError(
      "unsupported-syntax",
      "Subqueries and expressions are not supported. Enter a single value.",
      token.range,
    );
  }
  throw new DslSyntaxError(
    "expected-value",
    `Expected a value after "${after}".`,
    token.range,
  );
}

function parseInList(
  stream: TokenStream,
  reference: Reference,
  negated: boolean,
): FilterExpression {
  const keyword = negated ? "NOT IN" : "IN";
  const open = stream.peek();
  if (!open || open.kind !== "punctuation" || open.value !== "(") {
    throw new DslSyntaxError(
      "unexpected-token",
      `Expected "(" after ${keyword}.`,
      open ? open.range : stream.endRange(),
    );
  }
  stream.next();
  if (stream.isPunctuation(")")) {
    throw new DslSyntaxError(
      "expected-value",
      `${keyword} needs at least one value.`,
      { from: open.range.from, to: stream.peek()!.range.to },
    );
  }

  const values: ScalarNode[] = [];
  let after = "(";
  while (true) {
    if (values.length >= MAX_IN_VALUES) {
      throw new DslSyntaxError(
        "limit-exceeded",
        `${keyword} lists are limited to ${MAX_IN_VALUES.toLocaleString("en-US")} values.`,
        stream.peek()?.range ?? stream.endRange(),
      );
    }
    values.push(parseScalar(stream, after));
    const token = stream.peek();
    if (!token) {
      throw new DslSyntaxError(
        "unexpected-token",
        `Expected "," or ")" to finish the ${keyword} list.`,
        stream.endRange(),
      );
    }
    if (token.kind === "punctuation" && token.value === ",") {
      stream.next();
      after = ",";
      continue;
    }
    if (token.kind === "punctuation" && token.value === ")") {
      stream.next();
      break;
    }
    throw unexpected(
      token,
      `Expected "," or ")" in the ${keyword} list, found ${describeToken(token)}.`,
    );
  }

  const close = stream.previous()!;
  return {
    kind: "membership",
    column: reference.column,
    path: reference.path,
    negated,
    values,
    range: { from: reference.range.from, to: close.range.to },
  };
}

function parsePredicate(stream: TokenStream): FilterExpression {
  const reference = parseReference(stream, "a column name");
  const { column, path } = reference;
  const from = reference.range.from;

  const token = stream.peek();
  if (!token) {
    throw new DslSyntaxError(
      "unexpected-token",
      `Expected an operator after "${referenceText(reference)}", such as =, IN, or IS NULL.`,
      stream.endRange(),
    );
  }

  if (token.kind === "operator") {
    stream.next();
    const value = parseScalar(stream, token.value);
    return {
      kind: "comparison",
      column,
      path,
      operator: token.value,
      value,
      range: { from, to: value.range.to },
    };
  }

  if (token.kind === "word") {
    const isWordOperator =
      token.upper === "LIKE" ||
      token.upper === "ILIKE" ||
      JSON_OPERATOR_WORDS.has(token.upper);
    if (isWordOperator) {
      stream.next();
      const value = parseScalar(stream, token.upper);
      return {
        kind: "comparison",
        column,
        path,
        operator: token.upper as ComparisonOperator,
        value,
        range: { from, to: value.range.to },
      };
    }
    if (token.upper === "IN") {
      stream.next();
      return parseInList(stream, reference, false);
    }
    if (token.upper === "NOT") {
      stream.next();
      if (stream.isWord("IN")) {
        stream.next();
        return parseInList(stream, reference, true);
      }
      throw new DslSyntaxError(
        "unsupported-syntax",
        "NOT is only supported as NOT IN or IS NOT NULL.",
        {
          from: token.range.from,
          to: stream.peek()?.range.to ?? token.range.to,
        },
      );
    }
    if (token.upper === "IS") {
      stream.next();
      let negated = false;
      if (stream.isWord("NOT")) {
        stream.next();
        negated = true;
      }
      const nullToken = stream.peek();
      if (nullToken?.kind !== "word" || nullToken.upper !== "NULL") {
        throw new DslSyntaxError(
          "unexpected-token",
          `Expected NULL after ${negated ? "IS NOT" : "IS"}.`,
          nullToken ? nullToken.range : stream.endRange(),
        );
      }
      stream.next();
      return {
        kind: "null-check",
        column,
        path,
        negated,
        range: { from, to: nullToken.range.to },
      };
    }
    if (token.upper === "BETWEEN" || token.upper === "SIMILAR") {
      throw new DslSyntaxError(
        "unsupported-syntax",
        `${token.upper} is not supported. Combine comparisons with AND instead.`,
        token.range,
      );
    }
  }

  throw unexpected(
    token,
    `Expected an operator after "${referenceText(reference)}", such as =, IN, or IS NULL.`,
  );
}

function parsePrimary(
  stream: TokenStream,
  state: FilterState,
  depth: number,
): FilterExpression {
  const token = stream.peek();
  if (token?.kind === "punctuation" && token.value === "(") {
    if (depth >= MAX_FILTER_DEPTH) {
      throw new DslSyntaxError(
        "limit-exceeded",
        `Parentheses can be nested at most ${MAX_FILTER_DEPTH} levels deep.`,
        token.range,
      );
    }
    stream.next();
    if (stream.isWord("SELECT")) {
      throw new DslSyntaxError(
        "unsupported-syntax",
        "Subqueries are not supported.",
        stream.peek()!.range,
      );
    }
    const inner = parseOr(stream, state, depth + 1);
    const close = stream.peek();
    if (close?.kind !== "punctuation" || close.value !== ")") {
      throw new DslSyntaxError(
        "unexpected-token",
        `Expected ")" to close the "(" at position ${token.range.from + 1}.`,
        close ? close.range : stream.endRange(),
      );
    }
    stream.next();
    return inner;
  }

  if (token?.kind === "word" && token.upper === "NOT") {
    throw new DslSyntaxError(
      "unsupported-syntax",
      "NOT is only supported as NOT IN or IS NOT NULL.",
      token.range,
    );
  }

  const predicate = parsePredicate(stream);
  countNode(state, predicate.range);
  return predicate;
}

function parseAnd(
  stream: TokenStream,
  state: FilterState,
  depth: number,
): FilterExpression {
  let left = parsePrimary(stream, state, depth);
  while (stream.isWord("AND")) {
    const operatorToken = stream.next()!;
    if (stream.isAtEnd()) {
      throw new DslSyntaxError(
        "unexpected-token",
        "Expected a condition after AND.",
        stream.endRange(),
      );
    }
    const right = parsePrimary(stream, state, depth);
    const range = { from: left.range.from, to: right.range.to };
    countNode(state, operatorToken.range);
    left = { kind: "logical", operator: "AND", left, right, range };
  }
  return left;
}

function parseOr(
  stream: TokenStream,
  state: FilterState,
  depth: number,
): FilterExpression {
  let left = parseAnd(stream, state, depth);
  while (stream.isWord("OR")) {
    const operatorToken = stream.next()!;
    if (stream.isAtEnd()) {
      throw new DslSyntaxError(
        "unexpected-token",
        "Expected a condition after OR.",
        stream.endRange(),
      );
    }
    const right = parseAnd(stream, state, depth);
    const range = { from: left.range.from, to: right.range.to };
    countNode(state, operatorToken.range);
    left = { kind: "logical", operator: "OR", left, right, range };
  }
  return left;
}

function parseFilterTokens(
  tokens: Token[],
  inputLength: number,
): FilterExpression | null {
  if (tokens.length === 0) return null;
  const stream = new TokenStream(tokens, inputLength);
  const expression = parseOr(stream, { nodeCount: 0 }, 0);
  const extra = stream.peek();
  if (extra) {
    if (extra.kind === "punctuation" && extra.value === ")") {
      throw unexpected(extra, 'Unmatched ")".');
    }
    throw unexpected(
      extra,
      `Unexpected ${describeToken(extra)}. Join conditions with AND or OR.`,
    );
  }
  return expression;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** Canonical output key: identifiers are already folded or exact. */
function identifierKey(node: IdentifierNode): string {
  return node.value;
}

function parseProjectionTokens(
  tokens: Token[],
  inputLength: number,
): Projection {
  if (tokens.length === 0) return [];
  const stream = new TokenStream(tokens, inputLength);
  const items: Projection = [];
  const seenColumns = new Set<string>();
  const seenOutputs = new Set<string>();

  while (true) {
    const excludeToken = stream.peek();
    const exclude = excludeToken?.kind === "exclude";
    if (exclude) stream.next();
    const reference = parseReference(stream, "a column name");
    const { column, path } = reference;
    if (exclude && path.length > 0) {
      throw new DslSyntaxError(
        "unsupported-syntax",
        "Exclusions take whole columns. List the paths to keep instead.",
        { from: excludeToken!.range.from, to: reference.range.to },
      );
    }

    let alias: IdentifierNode | undefined;
    if (stream.isWord("AS")) {
      const asToken = stream.next()!;
      if (exclude) {
        throw new DslSyntaxError(
          "unsupported-syntax",
          "An excluded column has no output, so it can't have an alias.",
          asToken.range,
        );
      }
      alias = parseIdentifier(stream, "an alias after AS");
    } else {
      const token = stream.peek();
      const looksLikeAlias =
        token?.kind === "quoted-identifier" ||
        (token?.kind === "word" && !DSL_KEYWORDS.has(token.upper));
      if (looksLikeAlias) {
        throw new DslSyntaxError(
          "unexpected-token",
          `Use AS to alias a column: ${referenceText(reference)} AS ${token.kind === "word" ? token.value : `"${token.value}"`}.`,
          token.range,
        );
      }
    }

    const columnKey = referenceText(reference);
    if (seenColumns.has(columnKey)) {
      throw new DslSyntaxError(
        "duplicate-column",
        `"${columnKey}" is already ${exclude ? "excluded" : "projected"}.`,
        reference.range,
      );
    }
    seenColumns.add(columnKey);

    const first = items[0];
    if (first && first.exclude !== exclude) {
      throw new DslSyntaxError(
        "mixed-projection",
        "List only columns to include, or only columns to exclude (-column), not both.",
        {
          from: exclude ? excludeToken!.range.from : column.range.from,
          to: reference.range.to,
        },
      );
    }

    if (!exclude) {
      // An unaliased path is named as typed: `payload.status`.
      const outputKey = alias ? identifierKey(alias) : columnKey;
      const outputRange = alias ? alias.range : reference.range;
      if (seenOutputs.has(outputKey)) {
        throw new DslSyntaxError(
          "duplicate-output",
          `Two columns would both be named "${outputKey}". Give one a different alias.`,
          outputRange,
        );
      }
      seenOutputs.add(outputKey);
    }

    const from = exclude ? excludeToken!.range.from : column.range.from;
    items.push({
      column,
      path,
      ...(alias ? { alias } : {}),
      exclude,
      range: { from, to: alias ? alias.range.to : reference.range.to },
    });

    const separator = stream.peek();
    if (!separator) break;
    if (separator.kind === "punctuation" && separator.value === ",") {
      stream.next();
      if (stream.isAtEnd()) {
        throw new DslSyntaxError(
          "unexpected-token",
          'Expected a column name after ",".',
          stream.endRange(),
        );
      }
      continue;
    }
    throw unexpected(
      separator,
      `Unexpected ${describeToken(separator)}. Separate columns with commas.`,
    );
  }

  return items;
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

function parseSortTokens(tokens: Token[], inputLength: number): Sort {
  if (tokens.length === 0) return [];
  const stream = new TokenStream(tokens, inputLength);
  const items: Sort = [];
  const seenColumns = new Set<string>();

  while (true) {
    const reference = parseReference(stream, "a column name");
    const { column, path } = reference;

    let direction: "ASC" | "DESC" = "ASC";
    let end = reference.range.to;
    const token = stream.peek();
    if (
      token?.kind === "word" &&
      (token.upper === "ASC" || token.upper === "DESC")
    ) {
      stream.next();
      direction = token.upper;
      end = token.range.to;
    } else if (token?.kind === "number") {
      if (token.value !== "1" && token.value !== "-1") {
        throw new DslSyntaxError(
          "unexpected-token",
          "Sort direction must be ASC, DESC, 1, or -1.",
          token.range,
        );
      }
      stream.next();
      direction = token.value === "1" ? "ASC" : "DESC";
      end = token.range.to;
    } else if (token?.kind === "word" && token.upper === "NULLS") {
      throw new DslSyntaxError(
        "unsupported-syntax",
        "NULLS FIRST and NULLS LAST are not supported.",
        token.range,
      );
    }

    const columnKey = referenceText(reference);
    if (seenColumns.has(columnKey)) {
      throw new DslSyntaxError(
        "duplicate-column",
        `"${columnKey}" is already sorted.`,
        reference.range,
      );
    }
    seenColumns.add(columnKey);
    items.push({
      column,
      path,
      direction,
      range: { from: column.range.from, to: end },
    });

    const separator = stream.peek();
    if (!separator) break;
    if (separator.kind === "punctuation" && separator.value === ",") {
      stream.next();
      if (stream.isAtEnd()) {
        throw new DslSyntaxError(
          "unexpected-token",
          'Expected a column name after ",".',
          stream.endRange(),
        );
      }
      continue;
    }
    throw unexpected(
      separator,
      `Unexpected ${describeToken(separator)}. Use ASC, DESC, 1, or -1, and separate columns with commas.`,
    );
  }

  return items;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function parseField<T>(
  field: QueryDslField,
  input: string,
  parseTokens: (tokens: Token[], inputLength: number) => T,
): DataQueryResult<T> {
  const tokenized = tokenize(field, input);
  if (!tokenized.ok) return tokenized;
  try {
    return { ok: true, value: parseTokens(tokenized.value, input.length) };
  } catch (err) {
    if (!(err instanceof DslSyntaxError)) throw err;
    return {
      ok: false,
      errors: [
        {
          code: err.code,
          field,
          message: err.message,
          from: err.range.from,
          to: err.range.to,
        },
      ],
    };
  }
}

export function parseFilter(
  input: string,
): DataQueryResult<FilterExpression | null> {
  return parseField("filter", input, parseFilterTokens);
}

export function parseProjection(input: string): DataQueryResult<Projection> {
  return parseField("projection", input, parseProjectionTokens);
}

export function parseSort(input: string): DataQueryResult<Sort> {
  return parseField("sort", input, parseSortTokens);
}

/** Largest Skip/Limit accepted; keeps values exact as JavaScript numbers. */
export const MAX_ROW_COUNT = 1_000_000_000_000;

/**
 * Skip and Limit are plain whole numbers. Empty means "no skip" or "no
 * limit"; Limit must be at least 1 so an empty field is the only way to
 * say "all rows".
 */
function parseRowCount(
  field: "skip" | "limit",
  input: string,
): DataQueryResult<number | null> {
  const text = input.trim();
  if (text === "") return { ok: true, value: null };
  const from = input.indexOf(text);
  const to = from + text.length;
  const label = field === "skip" ? "Skip" : "Limit";
  const fail = (message: string): DataQueryResult<number | null> => ({
    ok: false,
    errors: [{ code: "invalid-number", field, message, from, to }],
  });
  if (!/^\d+$/.test(text)) {
    return fail(`${label} must be a whole number, or empty.`);
  }
  const value = Number(text);
  if (value > MAX_ROW_COUNT) {
    return fail(
      `${label} can be at most ${MAX_ROW_COUNT.toLocaleString("en-US")}.`,
    );
  }
  if (field === "limit" && value === 0) {
    return fail("Limit must be at least 1, or empty for no limit.");
  }
  return { ok: true, value };
}

export function parseSkip(input: string): DataQueryResult<number | null> {
  return parseRowCount("skip", input);
}

export function parseLimit(input: string): DataQueryResult<number | null> {
  return parseRowCount("limit", input);
}

/** Parses every field; reports at most one syntax error per field. */
export function parseDataQuery(
  input: DataQueryInput,
): DataQueryResult<DataQueryAst> {
  const filter = parseFilter(input.filter);
  const projection = parseProjection(input.projection);
  const sort = parseSort(input.sort);
  const skip = parseSkip(input.skip);
  const limit = parseLimit(input.limit);

  const errors: QueryDslError[] = [];
  if (!filter.ok) errors.push(...filter.errors);
  if (!projection.ok) errors.push(...projection.errors);
  if (!sort.ok) errors.push(...sort.errors);
  if (!skip.ok) errors.push(...skip.errors);
  if (!limit.ok) errors.push(...limit.errors);
  if (!filter.ok || !projection.ok || !sort.ok || !skip.ok || !limit.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      filter: filter.value,
      projection: projection.value,
      sort: sort.value,
      skip: skip.value,
      limit: limit.value,
    },
  };
}
