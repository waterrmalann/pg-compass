/**
 * Types for the Data tab query DSL: raw input, tokens, AST, relation
 * metadata and structured errors. Shared by main (authoritative) and the
 * renderer (instant feedback and completion).
 */

/** Raw, serializable DSL text for the three Data-tab inputs. */
export interface DataQueryInput {
  filter: string;
  projection: string;
  sort: string;
  /** Rows to skip before the first result; empty means none. */
  skip: string;
  /** Maximum rows in the result; empty means no limit. */
  limit: string;
}

export type QueryDslField = "filter" | "projection" | "sort" | "skip" | "limit";

export type QueryDslErrorCode =
  | "unexpected-character"
  | "unterminated-string"
  | "unterminated-identifier"
  | "empty-identifier"
  | "unsupported-syntax"
  | "unexpected-token"
  | "expected-value"
  | "keyword-as-identifier"
  | "limit-exceeded"
  | "duplicate-column"
  | "duplicate-output"
  | "mixed-projection"
  | "invalid-number"
  | "unknown-column"
  | "case-mismatch"
  | "operator-not-supported"
  | "literal-type-mismatch"
  | "path-not-supported"
  | "invalid-json";

export interface QueryDslError {
  code: QueryDslErrorCode;
  field: QueryDslField;
  message: string;
  from: number;
  to: number;
}

export interface SourceRange {
  from: number;
  to: number;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type ComparisonOperator =
  | "="
  | "!="
  | "<>"
  | ">"
  | ">="
  | "<"
  | "<="
  | "LIKE"
  | "ILIKE"
  /** JSON containment (`@>`). */
  | "CONTAINS"
  /** JSON key or string-element existence (`?`). */
  | "HAS";

export type Token =
  /**
   * Unquoted word: a keyword or an identifier (folded to lowercase). `raw`
   * keeps the typed spelling for case-sensitive JSON keys.
   */
  | {
      kind: "word";
      value: string;
      upper: string;
      raw: string;
      range: SourceRange;
    }
  | { kind: "quoted-identifier"; value: string; range: SourceRange }
  | { kind: "string"; value: string; range: SourceRange }
  /** Numeric lexeme kept as text so large values stay lossless. */
  | { kind: "number"; value: string; range: SourceRange }
  | {
      kind: "operator";
      value: "=" | "!=" | "<>" | ">" | ">=" | "<" | "<=";
      range: SourceRange;
    }
  | { kind: "punctuation"; value: "(" | ")" | ","; range: SourceRange }
  /** Projection only: the `-` that excludes the column right after it. */
  | { kind: "exclude"; range: SourceRange }
  /** A `.` directly after a column or path segment: `payload.status`. */
  | { kind: "dot"; range: SourceRange };

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export interface IdentifierNode {
  value: string;
  quoted: boolean;
  range: SourceRange;
}

/**
 * One step into a JSON value. Keys are case-sensitive as typed; indexes are
 * unsigned integers into arrays.
 */
export type PathSegment =
  | { kind: "key"; value: string; range: SourceRange }
  | { kind: "index"; value: number; range: SourceRange };

export type ScalarNode =
  | { kind: "string"; value: string; range: SourceRange }
  | { kind: "number"; value: string; range: SourceRange }
  | { kind: "boolean"; value: boolean; range: SourceRange };

export type FilterExpression =
  | {
      kind: "logical";
      operator: "AND" | "OR";
      left: FilterExpression;
      right: FilterExpression;
      range: SourceRange;
    }
  | {
      kind: "comparison";
      column: IdentifierNode;
      path: PathSegment[];
      operator: ComparisonOperator;
      value: ScalarNode;
      range: SourceRange;
    }
  | {
      kind: "membership";
      column: IdentifierNode;
      path: PathSegment[];
      negated: boolean;
      values: ScalarNode[];
      range: SourceRange;
    }
  | {
      kind: "null-check";
      column: IdentifierNode;
      path: PathSegment[];
      negated: boolean;
      range: SourceRange;
    };

export interface ProjectionItem {
  column: IdentifierNode;
  /** Empty for the whole column. */
  path: PathSegment[];
  alias?: IdentifierNode;
  /** `-column`: return every column except this one. */
  exclude: boolean;
  range: SourceRange;
}

export type Projection = ProjectionItem[];

export interface SortItem {
  column: IdentifierNode;
  /** Empty for the whole column. */
  path: PathSegment[];
  direction: "ASC" | "DESC";
  range: SourceRange;
}

export type Sort = SortItem[];

export interface DataQueryAst {
  filter: FilterExpression | null;
  projection: Projection;
  sort: Sort;
  skip: number | null;
  limit: number | null;
}

// ---------------------------------------------------------------------------
// Relation metadata and binding
// ---------------------------------------------------------------------------

/** Capability group a column's (base) type belongs to. */
export type QueryTypeFamily =
  | "text"
  | "numeric"
  | "temporal"
  | "boolean"
  | "enum"
  | "uuid"
  | "json"
  | "jsonb"
  | "other";

export interface QueryColumnMetadata {
  name: string;
  /** Declared type name (a domain keeps its own name). */
  typeName: string;
  family: QueryTypeFamily;
}

export interface RelationMetadata {
  kind: "table" | "view";
  columns: QueryColumnMetadata[];
  /** Primary-key columns in declaration order, or null. */
  primaryKey: string[] | null;
}

export type BoundPathSegment =
  | { kind: "key"; value: string }
  | { kind: "index"; value: number };

/** A catalog column, or a path inside a `json`/`jsonb` column. */
export interface BoundReference {
  column: string;
  /** Empty for the whole column. */
  path: BoundPathSegment[];
  /** `json` columns are converted to `jsonb` before JSON operators. */
  convertToJsonb: boolean;
}

export type BoundFilter =
  | {
      kind: "logical";
      operator: "AND" | "OR";
      left: BoundFilter;
      right: BoundFilter;
    }
  | (BoundReference & {
      kind: "comparison";
      operator: ComparisonOperator;
      value: ScalarNode;
    })
  | (BoundReference & {
      kind: "membership";
      negated: boolean;
      values: ScalarNode[];
    })
  | (BoundReference & { kind: "null-check"; negated: boolean });

export interface BoundDataQuery {
  filter: BoundFilter | null;
  projection: (BoundReference & { outputName: string; aliased: boolean })[];
  sort: (BoundReference & { direction: "ASC" | "DESC" })[];
  skip: number | null;
  limit: number | null;
}

export type DataQueryResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: QueryDslError[] };
