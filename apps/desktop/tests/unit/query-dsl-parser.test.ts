import { describe, expect, it } from "vitest";
import {
  dataQueryEquals,
  isEmptyDataQuery,
  parseDataQuery,
  parseFilter,
  parseProjection,
  parseSort,
} from "@/shared/query-dsl/parser";
import { tokenize } from "@/shared/query-dsl/tokenizer";
import type {
  DataQueryResult,
  FilterExpression,
  QueryDslError,
} from "@/shared/query-dsl/types";

function ok<T>(result: DataQueryResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected success, got ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function firstError<T>(result: DataQueryResult<T>): QueryDslError {
  if (result.ok) throw new Error("Expected a DSL error.");
  return result.errors[0]!;
}

/** Compact, readable rendering of a filter AST for assertions. */
function show(expression: FilterExpression | null): string {
  if (!expression) return "";
  if (expression.kind === "logical") {
    return `(${show(expression.left)} ${expression.operator} ${show(expression.right)})`;
  }
  const column = expression.column.quoted
    ? `"${expression.column.value}"`
    : expression.column.value;
  if (expression.kind === "null-check") {
    return `${column} IS ${expression.negated ? "NOT " : ""}NULL`;
  }
  const format = (value: { kind: string; value: unknown }) =>
    value.kind === "string" ? `'${String(value.value)}'` : String(value.value);
  if (expression.kind === "membership") {
    return `${column} ${expression.negated ? "NOT " : ""}IN [${expression.values.map(format).join(", ")}]`;
  }
  return `${column} ${expression.operator} ${format(expression.value)}`;
}

describe("tokenize", () => {
  it("keeps source ranges and folds unquoted words", () => {
    const tokens = ok(tokenize("filter", `  Name = 'x' `));
    expect(tokens).toEqual([
      { kind: "word", value: "name", upper: "NAME", range: { from: 2, to: 6 } },
      { kind: "operator", value: "=", range: { from: 7, to: 8 } },
      { kind: "string", value: "x", range: { from: 9, to: 12 } },
    ]);
  });

  it("unescapes doubled quotes in strings and identifiers", () => {
    const tokens = ok(tokenize("filter", `"a""b" = 'it''s'`));
    expect(tokens[0]).toMatchObject({
      kind: "quoted-identifier",
      value: 'a"b',
    });
    expect(tokens[2]).toMatchObject({ kind: "string", value: "it's" });
  });

  it("keeps backslashes inside strings as literal characters", () => {
    const tokens = ok(tokenize("filter", "path LIKE 'C:\\dir\\%'"));
    expect(tokens[2]).toMatchObject({ kind: "string", value: "C:\\dir\\%" });
  });

  it("allows Unicode inside quoted identifiers and strings", () => {
    const tokens = ok(tokenize("filter", `"名前" = 'café ☕'`));
    expect(tokens[0]).toMatchObject({ value: "名前" });
    expect(tokens[2]).toMatchObject({ value: "café ☕" });
  });

  it.each([
    ["-12", "-12"],
    ["3.25", "3.25"],
    [".5", ".5"],
    ["1e10", "1e10"],
    ["-2.5E-3", "-2.5E-3"],
    ["123456789012345678901234567890", "123456789012345678901234567890"],
  ])("keeps the numeric lexeme %s lossless", (input, lexeme) => {
    expect(ok(tokenize("filter", input))).toEqual([
      { kind: "number", value: lexeme, range: { from: 0, to: input.length } },
    ]);
  });

  it.each([
    ["id = 1 -- comment", "unsupported-syntax", 7],
    ["id = 1 /* c */", "unsupported-syntax", 7],
    ["id = 1; DROP TABLE x", "unsupported-syntax", 6],
    ["id = 1\nOR id = 2", "unsupported-syntax", 6],
    ["id::text = '1'", "unsupported-syntax", 2],
    ["name = $$x$$", "unsupported-syntax", 7],
    ["name = \\x", "unsupported-syntax", 7],
    ["name = 'open", "unterminated-string", 7],
    [`"open = 1`, "unterminated-identifier", 0],
    [`"" = 1`, "empty-identifier", 0],
    ["id = 1abc", "unexpected-token", 5],
    ["id = 1.2.3", "unexpected-token", 5],
    ["id = 1 + 2", "unsupported-syntax", 7],
    ["id = @", "unexpected-character", 5],
  ])("rejects %j", (input, code, from) => {
    const error = firstError(tokenize("filter", input));
    expect(error).toMatchObject({ code, field: "filter", from });
  });

  it("enforces the per-field length limit", () => {
    const error = firstError(tokenize("sort", "a".repeat(10_001)));
    expect(error).toMatchObject({
      code: "limit-exceeded",
      field: "sort",
      from: 10_000,
      to: 10_001,
    });
  });
});

describe("parseFilter", () => {
  it.each([
    ["id = 1", "id = 1"],
    ["name LIKE 'Alan%'", "name LIKE 'Alan%'"],
    [
      "name ILIKE 'alan%' AND created_at >= '2020-01-01'",
      "(name ILIKE 'alan%' AND created_at >= '2020-01-01')",
    ],
    [
      "(status = 'active' OR status = 'pending') AND score > 10",
      "((status = 'active' OR status = 'pending') AND score > 10)",
    ],
    [
      "name IN ('Alan', 'Bob', 'Charlie')",
      "name IN ['Alan', 'Bob', 'Charlie']",
    ],
    [
      "role NOT IN ('blocked', 'deleted')",
      "role NOT IN ['blocked', 'deleted']",
    ],
    ["deleted_at IS NULL", "deleted_at IS NULL"],
    ["verified_at IS NOT NULL", "verified_at IS NOT NULL"],
    [`"CreatedAt" >= '2026-01-01'`, `"CreatedAt" >= '2026-01-01'`],
  ])("parses the documented example %s", (input, expected) => {
    expect(show(ok(parseFilter(input)))).toBe(expected);
  });

  it.each(["=", "!=", "<>", ">", ">=", "<", "<=", "LIKE", "ILIKE"])(
    "supports the %s operator",
    (operator) => {
      const parsed = ok(parseFilter(`col ${operator} 'v'`));
      expect(parsed).toMatchObject({ kind: "comparison", operator });
    },
  );

  it("binds AND tighter than OR and associates left to right", () => {
    expect(show(ok(parseFilter("a = 1 OR b = 2 AND c = 3")))).toBe(
      "(a = 1 OR (b = 2 AND c = 3))",
    );
    expect(show(ok(parseFilter("a = 1 AND b = 2 AND c = 3")))).toBe(
      "((a = 1 AND b = 2) AND c = 3)",
    );
    expect(show(ok(parseFilter("((a = 1))")))).toBe("a = 1");
  });

  it("treats keywords and booleans case-insensitively", () => {
    expect(
      show(ok(parseFilter("a is not null or b = true and c in (FALSE)"))),
    ).toBe("(a IS NOT NULL OR (b = true AND c IN [false]))");
  });

  it("accepts identifiers that merely start with a keyword", () => {
    expect(show(ok(parseFilter("order_id = 1 AND is_active = TRUE")))).toBe(
      "(order_id = 1 AND is_active = true)",
    );
  });

  it("returns null for empty and whitespace-only input", () => {
    expect(ok(parseFilter(""))).toBeNull();
    expect(ok(parseFilter("   "))).toBeNull();
  });

  it("records source ranges for every node", () => {
    const parsed = ok(parseFilter("  a = 1 OR b IN (2)"));
    expect(parsed).toMatchObject({
      kind: "logical",
      range: { from: 2, to: 19 },
      left: {
        range: { from: 2, to: 7 },
        column: { range: { from: 2, to: 3 } },
      },
      right: { range: { from: 11, to: 19 } },
    });
  });

  it.each([
    ["id >=", "expected-value", 'Expected a value after ">="', 5],
    ["id = ", "expected-value", 'Expected a value after "="', 4],
    ["name = bob", "expected-value", "Wrap text in single quotes", 7],
    [
      `name = "bob"`,
      "unsupported-syntax",
      "Double quotes are for column names",
      7,
    ],
    ["id = NULL", "unexpected-token", "IS NULL", 5],
    ["id IN ()", "expected-value", "at least one value", 6],
    ["id IN (1,)", "expected-value", 'Expected a value after ","', 9],
    ["id IN (1 2)", "unexpected-token", 'Expected "," or ")"', 9],
    ["id IN (1, bob)", "expected-value", "single quotes", 10],
    ["id IN 1", "unexpected-token", 'Expected "(" after IN', 6],
    ["(id = 1", "unexpected-token", 'Expected ")"', 7],
    ["id = 1)", "unexpected-token", 'Unmatched ")"', 6],
    ["id = 1 id = 2", "unexpected-token", "AND or OR", 7],
    ["id = 1 AND", "unexpected-token", "after AND", 10],
    ["id = 1 OR", "unexpected-token", "after OR", 9],
    ["NOT id = 1", "unsupported-syntax", "NOT IN or IS NOT NULL", 0],
    ["id NOT LIKE 'a'", "unsupported-syntax", "NOT IN or IS NOT NULL", 3],
    ["id IS 1", "unexpected-token", "Expected NULL after IS", 6],
    ["lower(name) = 'a'", "unsupported-syntax", "Functions", 0],
    ["id = abs(1)", "unsupported-syntax", "Functions", 5],
    ["id IN (SELECT 1)", "unsupported-syntax", "Subqueries", 7],
    ["(SELECT secret FROM credentials)", "unsupported-syntax", "Subqueries", 1],
    ["id BETWEEN 1 AND 2", "unsupported-syntax", "BETWEEN", 3],
    ["id", "unexpected-token", "Expected an operator", 2],
    ["'a' = id", "unexpected-token", "use double quotes for column names", 0],
    ["and = 1", "keyword-as-identifier", "Quote it", 0],
    ["select = 1", "unsupported-syntax", "Quote it", 0],
    ["id = 1 OR TRUE", "keyword-as-identifier", "TRUE is a keyword", 10],
    ["id = -", "unsupported-syntax", "", 5],
  ])("rejects %j", (input, code, message, from) => {
    const error = firstError(parseFilter(input));
    expect(error).toMatchObject({ code, field: "filter", from });
    expect(error.message).toContain(message);
  });

  it("limits nesting depth", () => {
    const depth32 = `${"(".repeat(32)}a = 1${")".repeat(32)}`;
    expect(ok(parseFilter(depth32))).toMatchObject({ kind: "comparison" });
    const depth33 = `${"(".repeat(33)}a = 1${")".repeat(33)}`;
    expect(firstError(parseFilter(depth33))).toMatchObject({
      code: "limit-exceeded",
      from: 32,
    });
  });

  it("limits the number of filter nodes", () => {
    const predicates = Array.from({ length: 101 }, (_, i) => `c${i} = ${i}`);
    // 101 predicates + 100 AND nodes = 201 nodes.
    const error = firstError(parseFilter(predicates.join(" AND ")));
    expect(error.code).toBe("limit-exceeded");
    const within = Array.from({ length: 100 }, (_, i) => `c${i} = ${i}`);
    expect(parseFilter(within.join(" AND ")).ok).toBe(true);
  });

  it("limits IN lists to 1,000 values", () => {
    const values = (count: number) =>
      Array.from({ length: count }, (_, i) => String(i)).join(", ");
    expect(parseFilter(`id IN (${values(1000)})`).ok).toBe(true);
    expect(firstError(parseFilter(`id IN (${values(1001)})`)).code).toBe(
      "limit-exceeded",
    );
  });
});

describe("parseProjection", () => {
  it.each([
    ["id, name, created_at", ["id", "name", "created_at"]],
    ["id, name, created_at AS createdAt", ["id", "name", "createdat"]],
    [
      `"id", "Display Name", "CreatedAt" AS "createdAt"`,
      ["id", "Display Name", "createdAt"],
    ],
  ])("parses the documented example %s", (input, outputs) => {
    const items = ok(parseProjection(input));
    expect(items.map((item) => (item.alias ?? item.column).value)).toEqual(
      outputs,
    );
  });

  it("is empty for empty input", () => {
    expect(ok(parseProjection("  "))).toEqual([]);
  });

  it.each([
    ["*", "unsupported-syntax", "Leave Project empty", 0],
    ["id name", "unexpected-token", "Use AS", 3],
    [`id "Name"`, "unexpected-token", "Use AS", 3],
    ["id AS", "unexpected-token", "an alias", 5],
    ["id,", "unexpected-token", 'after ","', 3],
    ["id, , name", "unexpected-token", "", 4],
    [`id, "id"`, "duplicate-column", "already projected", 4],
    ["id AS a, name AS A", "duplicate-output", "both be named", 17],
    ["id, name AS id", "duplicate-output", "both be named", 12],
    ["upper(name)", "unsupported-syntax", "Functions", 0],
    ["id + 1", "unsupported-syntax", "", 3],
    ["'id'", "unexpected-token", "double quotes", 0],
    ["1", "unexpected-token", "Expected a column name", 0],
  ])("rejects %j", (input, code, message, from) => {
    const error = firstError(parseProjection(input));
    expect(error).toMatchObject({ code, field: "projection", from });
    expect(error.message).toContain(message);
  });
});

describe("parseSort", () => {
  it.each([
    ["created_at DESC, name ASC", ["created_at DESC", "name ASC"]],
    ["created_at -1, name 1", ["created_at DESC", "name ASC"]],
    ["created_at DESC, name", ["created_at DESC", "name ASC"]],
    [`"CreatedAt" DESC`, ["CreatedAt DESC"]],
    ["a desc", ["a DESC"]],
  ])("parses %s", (input, expected) => {
    const items = ok(parseSort(input));
    expect(
      items.map((item) => `${item.column.value} ${item.direction}`),
    ).toEqual(expected);
  });

  it.each([
    ["a 2", "unexpected-token", "ASC, DESC, 1, or -1", 2],
    ["a -2", "unexpected-token", "ASC, DESC, 1, or -1", 2],
    ["a up", "unexpected-token", "ASC, DESC, 1, or -1", 2],
    ["a, A", "duplicate-column", "already sorted", 3],
    ["a NULLS FIRST", "unsupported-syntax", "NULLS", 2],
    ["a AS b", "unexpected-token", "", 2],
    ["desc", "keyword-as-identifier", "Quote it", 0],
    ["a,", "unexpected-token", 'after ","', 2],
  ])("rejects %j", (input, code, message, from) => {
    const error = firstError(parseSort(input));
    expect(error).toMatchObject({ code, field: "sort", from });
    expect(error.message).toContain(message);
  });
});

describe("parseDataQuery", () => {
  it("parses all fields and reports one error per failing field", () => {
    const result = parseDataQuery({
      filter: "id =",
      projection: "id",
      sort: "a 5",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.field)).toEqual([
      "filter",
      "sort",
    ]);
  });

  it("returns an empty AST for empty input", () => {
    expect(
      ok(parseDataQuery({ filter: "", projection: "", sort: "" })),
    ).toEqual({
      filter: null,
      projection: [],
      sort: [],
    });
  });

  it.each([
    "'; DROP TABLE users; --",
    "1 OR TRUE",
    "name); DELETE FROM users; --",
    "pg_sleep(10)",
    "(SELECT secret FROM credentials)",
  ])("rejects the payload %j in every field", (payload) => {
    for (const field of ["filter", "projection", "sort"] as const) {
      const result = parseDataQuery({
        filter: "",
        projection: "",
        sort: "",
        [field]: payload,
      });
      expect(result.ok).toBe(false);
    }
  });
});

describe("query input helpers", () => {
  it("compares trimmed input and detects empty queries", () => {
    expect(
      dataQueryEquals(
        { filter: " id = 1 ", projection: "", sort: "" },
        { filter: "id = 1", projection: " ", sort: "" },
      ),
    ).toBe(true);
    expect(isEmptyDataQuery({ filter: " ", projection: "", sort: "" })).toBe(
      true,
    );
    expect(isEmptyDataQuery({ filter: "", projection: "", sort: "a" })).toBe(
      false,
    );
  });
});
