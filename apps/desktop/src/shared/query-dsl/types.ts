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
  | "literal-type-mismatch";

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
  | "ILIKE";

export type Token =
  /** Unquoted word: a keyword or an identifier (folded to lowercase). */
  | { kind: "word"; value: string; upper: string; range: SourceRange }
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
  | { kind: "exclude"; range: SourceRange };

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export interface IdentifierNode {
  value: string;
  quoted: boolean;
  range: SourceRange;
}

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
      operator: ComparisonOperator;
      value: ScalarNode;
      range: SourceRange;
    }
  | {
      kind: "membership";
      column: IdentifierNode;
      negated: boolean;
      values: ScalarNode[];
      range: SourceRange;
    }
  | {
      kind: "null-check";
      column: IdentifierNode;
      negated: boolean;
      range: SourceRange;
    };

export interface ProjectionItem {
  column: IdentifierNode;
  alias?: IdentifierNode;
  /** `-column`: return every column except this one. */
  exclude: boolean;
  range: SourceRange;
}

export type Projection = ProjectionItem[];

export interface SortItem {
  column: IdentifierNode;
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

export type BoundFilter =
  | {
      kind: "logical";
      operator: "AND" | "OR";
      left: BoundFilter;
      right: BoundFilter;
    }
  | {
      kind: "comparison";
      column: string;
      operator: ComparisonOperator;
      value: ScalarNode;
    }
  | {
      kind: "membership";
      column: string;
      negated: boolean;
      values: ScalarNode[];
    }
  | { kind: "null-check"; column: string; negated: boolean };

export interface BoundDataQuery {
  filter: BoundFilter | null;
  projection: { column: string; outputName: string; aliased: boolean }[];
  sort: { column: string; direction: "ASC" | "DESC" }[];
  skip: number | null;
  limit: number | null;
}

export type DataQueryResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: QueryDslError[] };
