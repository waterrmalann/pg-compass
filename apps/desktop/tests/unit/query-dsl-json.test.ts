import { describe, expect, it } from "vitest";
import { compileDataQuery } from "@/main/query-dsl/compile";
import { MAX_PATH_ITEMS, prepareDataQuery } from "@/shared/query-dsl/bind";
import {
  formatPath,
  parseFilter,
  parseProjection,
  parseSort,
} from "@/shared/query-dsl/parser";
import { tokenize } from "@/shared/query-dsl/tokenizer";
import type {
  BoundDataQuery,
  DataQueryInput,
  DataQueryResult,
  QueryColumnMetadata,
  QueryDslError,
} from "@/shared/query-dsl/types";

const COLUMNS: QueryColumnMetadata[] = [
  { name: "id", typeName: "int4", family: "numeric" },
  { name: "status", typeName: "text", family: "text" },
  { name: "profile", typeName: "jsonb", family: "jsonb" },
  { name: "raw", typeName: "json", family: "json" },
  { name: "settings", typeName: "settings_doc", family: "jsonb" },
  { name: "contains", typeName: "text", family: "text" },
  { name: "has", typeName: "jsonb", family: "jsonb" },
];

const REL = '"app"."t"';

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

function input(query: Partial<DataQueryInput>): DataQueryInput {
  return {
    filter: "",
    projection: "",
    sort: "",
    skip: "",
    limit: "",
    ...query,
  };
}

function bound(query: Partial<DataQueryInput>): BoundDataQuery {
  return ok(prepareDataQuery(input(query), COLUMNS));
}

function bindError(query: Partial<DataQueryInput>): QueryDslError {
  return firstError(prepareDataQuery(input(query), COLUMNS));
}

function compile(query: Partial<DataQueryInput>, primaryKey = ["id"]) {
  return compileDataQuery(bound(query), primaryKey, REL);
}

describe("tokenize paths", () => {
  it("splits a path into dots, keys and indexes", () => {
    const tokens = ok(tokenize("filter", `payload.Items.0."content-type"`));
    expect(tokens.map((token) => token.kind)).toEqual([
      "word",
      "dot",
      "word",
      "dot",
      "number",
      "dot",
      "quoted-identifier",
    ]);
    expect(tokens[2]).toMatchObject({ raw: "Items", value: "items" });
    expect(tokens[4]).toMatchObject({
      value: "0",
      range: { from: 14, to: 15 },
    });
  });

  it("keeps ordinary decimal numbers as values", () => {
    const tokens = ok(tokenize("filter", "score = .5 AND n = 1.25"));
    expect(tokens[2]).toMatchObject({ kind: "number", value: ".5" });
    expect(tokens[6]).toMatchObject({ kind: "number", value: "1.25" });
  });

  it.each([
    ["payload .status = 'a'", "unsupported-syntax", 8, "no spaces"],
    ["payload. status = 'a'", "unexpected-token", 7, "right after"],
    ["payload.0abc = 'a'", "unexpected-token", 8, '"0abc"'],
    ["payload->'a' = 'b'", "unsupported-syntax", 7, "dot path"],
    ["payload->>'a' = 'b'", "unsupported-syntax", 7, "->>"],
    ["payload #> '{a}' = 'b'", "unsupported-syntax", 8, "dot path"],
    [`payload @> '{}'`, "unsupported-syntax", 8, "CONTAINS"],
    [`payload <@ '{}'`, "unsupported-syntax", 8, "CONTAINS"],
    ["payload @? '$.a'", "unsupported-syntax", 8, "JSONPath"],
    ["payload ? 'a'", "unsupported-syntax", 8, "HAS"],
    ["payload ?| '{a}'", "unsupported-syntax", 8, "OR"],
    ["payload ?& '{a}'", "unsupported-syntax", 8, "AND"],
  ])("rejects %j", (text, code, from, hint) => {
    const error = firstError(tokenize("filter", text));
    expect(error).toMatchObject({ code, from });
    expect(error.message).toContain(hint);
  });
});

describe("parse paths", () => {
  it("attaches the path to filter predicates with exact key spelling", () => {
    const filter = ok(parseFilter("Payload.userId = 'a'"));
    expect(filter).toMatchObject({
      kind: "comparison",
      column: { value: "payload" },
      path: [{ kind: "key", value: "userId" }],
      range: { from: 0, to: 20 },
    });
  });

  it("reads keywords and quoted names as keys after a dot", () => {
    const filter = ok(parseFilter(`p.desc.in."a.b".2 IS NOT NULL`));
    expect(filter).toMatchObject({
      kind: "null-check",
      negated: true,
      path: [
        { kind: "key", value: "desc" },
        { kind: "key", value: "in" },
        { kind: "key", value: "a.b" },
        { kind: "index", value: 2 },
      ],
    });
  });

  it("parses CONTAINS and HAS after columns and paths", () => {
    expect(ok(parseFilter(`p CONTAINS '{"a": 1}'`))).toMatchObject({
      kind: "comparison",
      operator: "CONTAINS",
      value: { kind: "string", value: '{"a": 1}' },
    });
    expect(ok(parseFilter("p.tags has 'x'"))).toMatchObject({
      operator: "HAS",
      path: [{ value: "tags" }],
    });
    expect(
      ok(parseFilter("p.a IN (1, 'b') AND p.c NOT IN (TRUE)")),
    ).toMatchObject({
      kind: "logical",
      left: { kind: "membership", path: [{ value: "a" }] },
      right: { kind: "membership", negated: true, path: [{ value: "c" }] },
    });
  });

  it("keeps columns named contains and has usable unquoted", () => {
    expect(ok(parseFilter("contains = 'x'"))).toMatchObject({
      column: { value: "contains" },
      operator: "=",
    });
    expect(ok(parseFilter("has HAS 'k'"))).toMatchObject({
      column: { value: "has" },
      operator: "HAS",
    });
  });

  it("parses paths in Sort with directions", () => {
    expect(ok(parseSort("p.rank -1, p.name"))).toMatchObject([
      { path: [{ value: "rank" }], direction: "DESC" },
      { path: [{ value: "name" }], direction: "ASC" },
    ]);
  });

  it("parses paths in Project with and without aliases", () => {
    expect(ok(parseProjection("p.a.0 AS first, p.b"))).toMatchObject([
      { path: [{ value: "a" }, { value: 0 }], alias: { value: "first" } },
      { path: [{ value: "b" }] },
    ]);
  });

  it.each([
    ["projection", "-p.secret", "unsupported-syntax", "whole columns"],
    ["projection", "p.a, p.a", "duplicate-column", '"p.a"'],
    ["projection", `p.a, x AS "p.a"`, "duplicate-output", '"p.a"'],
    ["projection", "p.a b", "unexpected-token", "p.a AS b"],
    ["sort", "p.a, p.a DESC", "duplicate-column", "already sorted"],
    ["filter", "p.a", "unexpected-token", 'after "p.a"'],
    ["filter", "p.a(1) = 2", "unsupported-syntax", "Functions"],
    ["filter", "p.99999999999 = 1", "limit-exceeded", "Quote the segment"],
    [
      "filter",
      `p${".k".repeat(17)} = 1`,
      "limit-exceeded",
      "limited to 16 segments",
    ],
  ] as const)("rejects %s %j", (field, text, code, hint) => {
    const parse =
      field === "filter"
        ? parseFilter
        : field === "sort"
          ? parseSort
          : parseProjection;
    const error = firstError<unknown>(parse(text));
    expect(error.code).toBe(code);
    expect(error.message).toContain(hint);
  });

  it("formats paths the way they are typed", () => {
    expect(
      formatPath([
        { kind: "key", value: "Items" },
        { kind: "index", value: 0 },
        { kind: "key", value: "content-type" },
        { kind: "key", value: 'q"k' },
      ]),
    ).toBe(`.Items.0."content-type"."q""k"`);
  });
});

describe("bind paths", () => {
  it("binds paths with exact keys and flags json columns for conversion", () => {
    expect(bound({ filter: "raw.UserId = 1" }).filter).toEqual({
      kind: "comparison",
      column: "raw",
      path: [{ kind: "key", value: "UserId" }],
      convertToJsonb: true,
      operator: "=",
      value: { kind: "number", value: "1", range: { from: 13, to: 14 } },
    });
  });

  it("accepts paths on domains over jsonb", () => {
    expect(bound({ sort: "settings.theme" }).sort[0]).toMatchObject({
      column: "settings",
      path: [{ kind: "key", value: "theme" }],
    });
  });

  it("rejects paths on columns that aren't json or jsonb", () => {
    expect(bindError({ sort: "status.length" })).toMatchObject({
      code: "path-not-supported",
      field: "sort",
      from: 0,
      to: 13,
      message: '"status" is text; only json and jsonb columns have paths.',
    });
  });

  it.each([
    ["profile.a = 'x'", true],
    ["profile.a = 1.5", true],
    ["profile.a != TRUE", true],
    ["profile.a IN ('x', 2, FALSE)", true],
    ["profile.a > 'm'", true],
    ["profile.a <= -3", true],
    ["profile.a > TRUE", false],
    ["profile.a LIKE 'x%'", true],
    ["profile.a ILIKE 5", false],
    [`profile.a CONTAINS '["x"]'`, true],
    ["profile.a CONTAINS 1", false],
    ["profile.a HAS 'k'", true],
    ["profile.a HAS FALSE", false],
    ["profile.a IS NULL", true],
  ])("checks literal kinds on paths: %s → %s", (filter, allowed) => {
    const result = prepareDataQuery(input({ filter }), COLUMNS);
    expect(result.ok).toBe(allowed);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("literal-type-mismatch");
    }
  });

  it("explains literal mismatches with the operator and path", () => {
    expect(bindError({ filter: "profile.a.0 > TRUE" }).message).toBe(
      '> on "profile.a.0" needs a quoted string or a number.',
    );
    expect(bindError({ filter: "profile HAS 1" }).message).toBe(
      "HAS needs a key in single quotes, such as 'status'.",
    );
  });

  it("reports invalid CONTAINS JSON over the string", () => {
    expect(bindError({ filter: "profile CONTAINS '{a: 1}'" })).toMatchObject({
      code: "invalid-json",
      from: 17,
      to: 25,
    });
  });

  it("names unaliased projected paths as typed", () => {
    expect(
      bound({ projection: `profile.items.0."content-type", raw.a AS a` })
        .projection,
    ).toEqual([
      {
        column: "profile",
        path: [
          { kind: "key", value: "items" },
          { kind: "index", value: 0 },
          { kind: "key", value: "content-type" },
        ],
        convertToJsonb: false,
        outputName: `profile.items.0."content-type"`,
        aliased: false,
      },
      {
        column: "raw",
        path: [{ kind: "key", value: "a" }],
        convertToJsonb: true,
        outputName: "a",
        aliased: true,
      },
    ]);
  });

  it("counts paths separately from whole columns", () => {
    const paths = Array.from(
      { length: MAX_PATH_ITEMS + 1 },
      (_, index) => `profile.k${index}`,
    );
    expect(bound({ sort: paths.slice(0, -1).join(", ") }).sort).toHaveLength(
      MAX_PATH_ITEMS,
    );
    expect(bindError({ sort: paths.join(", ") })).toMatchObject({
      code: "limit-exceeded",
      message: `List at most ${MAX_PATH_ITEMS} JSON paths.`,
    });
  });
});

describe("compile paths", () => {
  it("compiles typed equality with every key as a parameter", () => {
    expect(compile({ filter: "profile.status = 'active'" })).toMatchObject({
      whereSql: `("profile" -> $1::text) = to_jsonb($2::text)`,
      values: ["status", "active"],
      filterValues: ["status", "active"],
    });
  });

  it("guards ordering by the literal's JSON type", () => {
    expect(compile({ filter: "profile.count > 10" })).toMatchObject({
      whereSql: `(jsonb_typeof(("profile" -> $1::text)) = 'number' AND ("profile" -> $1::text) > to_jsonb($2::numeric))`,
      values: ["count", "10"],
    });
    expect(
      compile({ filter: "profile.day <= '2026-01-01'" }).whereSql,
    ).toContain(`= 'string' AND`);
  });

  it("compiles patterns against string values only", () => {
    expect(
      compile({ filter: "profile.items.0.sku ILIKE 'ab%'" }),
    ).toMatchObject({
      whereSql: `(jsonb_typeof(("profile" -> $1::text -> $2::int -> $3::text)) = 'string' AND (("profile" -> $1::text -> $2::int -> $3::text) #>> '{}') ILIKE $4)`,
      values: ["items", 0, "sku", "ab%"],
    });
  });

  it("treats a missing key and JSON null as NULL", () => {
    expect(compile({ filter: "profile.deleted_at IS NULL" }).whereSql).toBe(
      `COALESCE(jsonb_typeof(("profile" -> $1::text)), 'null') = 'null'`,
    );
    expect(compile({ filter: "profile.deleted_at IS NOT NULL" }).whereSql).toBe(
      `COALESCE(jsonb_typeof(("profile" -> $1::text)), 'null') <> 'null'`,
    );
    // Whole columns keep SQL NULL semantics and no conversion.
    expect(compile({ filter: "raw IS NULL" }).whereSql).toBe(`"raw" IS NULL`);
  });

  it("converts each IN literal to a JSON scalar of its own type", () => {
    expect(compile({ filter: "raw.a NOT IN (1, 'x', TRUE)" })).toMatchObject({
      whereSql: `("raw"::jsonb -> $1::text) NOT IN (to_jsonb($2::numeric), to_jsonb($3::text), to_jsonb($4::boolean))`,
      values: ["a", "1", "x", true],
    });
  });

  it("compiles CONTAINS and HAS on columns and paths", () => {
    expect(compile({ filter: `profile CONTAINS '{"a": 1}'` })).toMatchObject({
      whereSql: `"profile" @> $1::jsonb`,
      values: ['{"a": 1}'],
    });
    expect(compile({ filter: "raw HAS 'k'" }).whereSql).toBe(
      `"raw"::jsonb ? $1::text`,
    );
    expect(compile({ filter: "profile.tags HAS 'k'" })).toMatchObject({
      whereSql: `("profile" -> $1::text) ? $2::text`,
      values: ["tags", "k"],
    });
    expect(compile({ filter: `profile.a CONTAINS '[1]'` }).whereSql).toBe(
      `("profile" -> $1::text) @> $2::jsonb`,
    );
  });

  it("converts whole json columns for document equality", () => {
    expect(compile({ filter: "raw = '{}'" }).whereSql).toBe(
      `"raw"::jsonb = $1`,
    );
    expect(compile({ filter: "profile = '{}'" }).whereSql).toBe(
      `"profile" = $1`,
    );
  });

  it("numbers Project and Sort path keys after the filter's parameters", () => {
    const compiled = compile({
      filter: "status = 'a'",
      projection: "id, profile.name",
      sort: "profile.rank DESC",
    });
    expect(compiled).toMatchObject({
      selectListSql: `"id", ("profile" -> $2::text) AS "profile.name"`,
      whereSql: `"status" = $1`,
      orderBySql: `("app"."t"."profile" -> $3::text) DESC, "app"."t"."id" ASC`,
      values: ["a", "name", "rank"],
      filterValues: ["a"],
    });
  });

  it("keeps the primary-key tie-breaker when a path of it is sorted", () => {
    const compiled = compileDataQuery(
      bound({ sort: "profile.id" }),
      ["profile"],
      REL,
    );
    expect(compiled.orderBySql).toBe(
      `("app"."t"."profile" -> $1::text) ASC, "app"."t"."profile" ASC`,
    );
  });

  it("sorts whole json columns through jsonb", () => {
    expect(compile({ sort: "raw" }, []).orderBySql).toBe(
      `"app"."t"."raw"::jsonb ASC`,
    );
  });

  it("never interpolates keys into SQL", () => {
    const payload = `x'); DROP TABLE t; --`;
    const compiled = compile({
      filter: `profile."${payload}" = 'v'`,
      projection: `profile."${payload}" AS k`,
      sort: `profile."${payload}"`,
    });
    const sql = [
      compiled.selectListSql,
      compiled.whereSql,
      compiled.orderBySql,
    ].join(" ");
    expect(sql).not.toContain("DROP");
    expect(compiled.values).toEqual([payload, "v", payload, payload]);
  });
});
