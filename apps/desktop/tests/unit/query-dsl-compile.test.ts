import { describe, expect, it } from "vitest";
import { formatIdentifier, prepareDataQuery } from "@/shared/query-dsl/bind";
import {
  buildRelationQuery,
  compileDataQuery,
  pageWindow,
} from "@/main/query-dsl/compile";
import { classifyTypeFamily } from "@/main/query-dsl/relation-metadata";
import type {
  BoundDataQuery,
  DataQueryInput,
  QueryColumnMetadata,
  QueryDslError,
  QueryTypeFamily,
} from "@/shared/query-dsl/types";

const COLUMNS: QueryColumnMetadata[] = [
  { name: "id", typeName: "int4", family: "numeric" },
  { name: "status", typeName: "text", family: "text" },
  { name: "score", typeName: "numeric", family: "numeric" },
  { name: "display_name", typeName: "varchar", family: "text" },
  { name: "created_at", typeName: "timestamptz", family: "temporal" },
  { name: "is_active", typeName: "bool", family: "boolean" },
  { name: "role", typeName: "user_role", family: "enum" },
  { name: "external_id", typeName: "uuid", family: "uuid" },
  { name: "profile", typeName: "jsonb", family: "jsonb" },
  { name: "raw", typeName: "json", family: "other" },
  { name: "tags", typeName: "_text", family: "other" },
  { name: "email", typeName: "email_text", family: "text" },
  { name: "CreatedAt", typeName: "date", family: "temporal" },
  { name: "select", typeName: "text", family: "text" },
  { name: 'quote"col', typeName: "text", family: "text" },
];

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
  const result = prepareDataQuery(input(query), COLUMNS);
  if (!result.ok) {
    throw new Error(`Expected success: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function errors(query: Partial<DataQueryInput>): QueryDslError[] {
  const result = prepareDataQuery(input(query), COLUMNS);
  if (result.ok) throw new Error("Expected a DSL error.");
  return result.errors;
}

describe("bindDataQuery", () => {
  it("resolves unquoted identifiers after folding and quoted ones exactly", () => {
    expect(bound({ filter: "STATUS = 'a'" }).filter).toMatchObject({
      column: "status",
    });
    expect(bound({ sort: `"CreatedAt"` }).sort).toEqual([
      { column: "CreatedAt", direction: "ASC" },
    ]);
    expect(
      bound({ projection: `"select", "quote""col" AS q` }).projection,
    ).toEqual([
      { column: "select", outputName: "select", aliased: false },
      { column: 'quote"col', outputName: "q", aliased: true },
    ]);
  });

  it("explains mixed-case columns that need quoting", () => {
    expect(errors({ filter: "createdat >= '2026-01-01'" })[0]).toMatchObject({
      code: "case-mismatch",
      field: "filter",
      from: 0,
      to: 9,
      message: expect.stringContaining('"CreatedAt"'),
    });
  });

  it("rejects unknown columns and suggests the closest one", () => {
    expect(errors({ projection: "id, dispaly_name" })[0]).toMatchObject({
      code: "unknown-column",
      field: "projection",
      from: 4,
      to: 16,
      message:
        'Column "dispaly_name" does not exist. Did you mean display_name?',
    });
    expect(errors({ sort: "zzzzzz" })[0]?.message).toBe(
      'Column "zzzzzz" does not exist.',
    );
    // A quoted identifier is exact: a different case is a different column.
    expect(errors({ sort: `"ID"` })[0]).toMatchObject({
      code: "unknown-column",
      message: expect.stringContaining("Did you mean id?"),
    });
  });

  it("collects one error per field", () => {
    const result = errors({
      filter: "missing = 1",
      projection: "nope",
      sort: "id",
    });
    expect(result.map((error) => error.field)).toEqual([
      "filter",
      "projection",
    ]);
  });

  it("rejects the quoted-identifier injection payload as an unknown column", () => {
    for (const field of ["projection", "sort"] as const) {
      expect(
        errors({ [field]: `"name""; DROP TABLE users; --"` })[0],
      ).toMatchObject({ code: "unknown-column", field });
    }
  });

  const OPERATOR_MATRIX: [QueryTypeFamily, string, string, boolean][] = [
    ["text", "status", "= 'a'", true],
    ["text", "status", "< 'a'", true],
    ["text", "status", "LIKE 'a%'", true],
    ["text", "email", "ILIKE 'a%'", true],
    ["numeric", "score", ">= 1.5", true],
    ["numeric", "score", "IN (1, 2)", true],
    ["numeric", "score", "LIKE '1%'", false],
    ["temporal", "created_at", ">= '2026-01-01'", true],
    ["temporal", "created_at", "ILIKE '2026%'", false],
    ["boolean", "is_active", "= TRUE", true],
    ["boolean", "is_active", "<> false", true],
    ["boolean", "is_active", "NOT IN (TRUE)", true],
    ["boolean", "is_active", "> FALSE", false],
    ["enum", "role", "> 'admin'", true],
    ["enum", "role", "LIKE 'a%'", false],
    ["uuid", "external_id", "= '00000000-0000-0000-0000-000000000001'", true],
    ["uuid", "external_id", "> 'a'", false],
    ["jsonb", "profile", `= '{"a": 1}'`, true],
    ["jsonb", "profile", "> '{}'", false],
    ["other", "raw", "= '{}'", false],
    ["other", "tags", "IN ('a')", false],
    ["other", "tags", "IS NOT NULL", true],
    ["other", "raw", "IS NULL", true],
  ];

  it.each(OPERATOR_MATRIX)(
    "%s column %s %s → allowed: %s",
    (_family, column, rest, allowed) => {
      const result = prepareDataQuery(
        input({ filter: `${column} ${rest}` }),
        COLUMNS,
      );
      expect(result.ok).toBe(allowed);
      if (!result.ok) {
        expect(result.errors[0]?.code).toBe("operator-not-supported");
      }
    },
  );

  it("names the null-check-only restriction for other types", () => {
    expect(errors({ filter: "tags = 'a'" })[0]?.message).toBe(
      '= is not supported for "tags" (_text). Only IS NULL and IS NOT NULL are supported.',
    );
  });

  it.each([
    ["id = '1'", "a number"],
    ["status = 1", "a quoted string"],
    ["is_active = 'true'", "TRUE or FALSE"],
    ["created_at > 5", "a quoted string"],
    ["id IN (1, '2')", "a number"],
  ])("rejects the literal kind in %s", (filter, hint) => {
    const [error] = errors({ filter });
    expect(error).toMatchObject({ code: "literal-type-mismatch" });
    expect(error?.message).toContain(hint);
  });

  it("limits projection and sort items to the relation's column count", () => {
    const few: QueryColumnMetadata[] = [
      { name: "a", typeName: "text", family: "text" },
    ];
    // The count check runs before column resolution, so it reports first.
    const result = prepareDataQuery(input({ sort: "a, b" }), few);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("limit-exceeded");
  });
});

describe("bindDataQuery exclusions and Skip/Limit", () => {
  it("expands -column into every other column in catalog order", () => {
    expect(
      bound({ projection: `-id, -"CreatedAt", -raw` }).projection.map(
        (item) => item.column,
      ),
    ).toEqual(
      COLUMNS.map((column) => column.name).filter(
        (name) => !["id", "CreatedAt", "raw"].includes(name),
      ),
    );
    expect(bound({ projection: "-id" }).projection[0]).toEqual({
      column: "status",
      outputName: "status",
      aliased: false,
    });
  });

  it("rejects excluding an unknown column or every column", () => {
    expect(errors({ projection: "-nope" })[0]).toMatchObject({
      code: "unknown-column",
      field: "projection",
      from: 1,
      to: 5,
    });
    const one: QueryColumnMetadata[] = [
      { name: "a", typeName: "text", family: "text" },
    ];
    const result = prepareDataQuery(input({ projection: "-a" }), one);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      field: "projection",
      message: "Every column is excluded. Keep at least one.",
    });
  });

  it("carries Skip and Limit through binding", () => {
    expect(bound({ skip: "10", limit: "5" })).toMatchObject({
      skip: 10,
      limit: 5,
    });
    expect(bound({})).toMatchObject({ skip: null, limit: null });
    expect(errors({ skip: "x", limit: "0" }).map((e) => e.field)).toEqual([
      "skip",
      "limit",
    ]);
  });
});

describe("formatIdentifier", () => {
  it.each([
    ["created_at", "created_at"],
    ["CreatedAt", '"CreatedAt"'],
    ["desc", '"desc"'],
    ["select", '"select"'],
    ["has space", '"has space"'],
    ['q"x', '"q""x"'],
    ["1abc", '"1abc"'],
  ])("formats %s as %s", (name, expected) => {
    expect(formatIdentifier(name)).toBe(expected);
  });
});

const REL = '"app"."t"';

describe("compileDataQuery", () => {
  it("compiles the documented example into fragments and parameters", () => {
    const compiled = compileDataQuery(
      bound({
        filter: "status = 'active' AND score >= 10",
        projection: "id, display_name AS name",
        sort: "created_at DESC",
      }),
      ["id"],
      REL,
    );
    expect(compiled).toEqual({
      selectListSql: '"id", "display_name" AS "name"',
      whereSql: '("status" = $1 AND "score" >= $2)',
      orderBySql: '"app"."t"."created_at" DESC, "app"."t"."id" ASC',
      values: ["active", "10"],
      hasProjection: true,
      skip: null,
      limit: null,
    });
  });

  it("returns empty fragments for an empty query", () => {
    expect(compileDataQuery(bound({}), null, REL)).toEqual({
      selectListSql: "*",
      whereSql: "",
      orderBySql: "",
      values: [],
      hasProjection: false,
      skip: null,
      limit: null,
    });
    expect(compileDataQuery(bound({}), ["a", "b"], REL).orderBySql).toBe(
      '"app"."t"."a" ASC, "app"."t"."b" ASC',
    );
  });

  it("numbers parameters left to right through nesting and IN lists", () => {
    const compiled = compileDataQuery(
      bound({
        filter:
          "(id IN (1, 2) OR status NOT IN ('x', 'y')) AND is_active = TRUE AND score IS NOT NULL",
      }),
      null,
      REL,
    );
    expect(compiled.whereSql).toBe(
      '((("id" IN ($1, $2) OR "status" NOT IN ($3, $4)) AND "is_active" = $5) AND "score" IS NOT NULL)',
    );
    expect(compiled.values).toEqual(["1", "2", "x", "y", true]);
  });

  it("maps != to <> and keeps LIKE/ILIKE", () => {
    const compiled = compileDataQuery(
      bound({ filter: "status != 'a' OR status ILIKE 'b%'" }),
      null,
      REL,
    );
    expect(compiled.whereSql).toBe('("status" <> $1 OR "status" ILIKE $2)');
  });

  it("keeps large numeric lexemes lossless", () => {
    const compiled = compileDataQuery(
      bound({ filter: "score = 123456789012345678901234567890.123456789" }),
      null,
      REL,
    );
    expect(compiled.values).toEqual([
      "123456789012345678901234567890.123456789",
    ]);
  });

  it("quotes identifiers that contain quotes, capitals and reserved words", () => {
    const compiled = compileDataQuery(
      bound({
        filter: `"quote""col" = 'x'`,
        projection: `"select" AS "Weird ""Alias"""`,
        sort: `"CreatedAt" -1`,
      }),
      null,
      REL,
    );
    expect(compiled.whereSql).toBe('"quote""col" = $1');
    expect(compiled.selectListSql).toBe('"select" AS "Weird ""Alias"""');
    expect(compiled.orderBySql).toBe('"app"."t"."CreatedAt" DESC');
  });

  it("appends only missing composite primary-key tie-breakers", () => {
    const columns: QueryColumnMetadata[] = [
      { name: "order_id", typeName: "int4", family: "numeric" },
      { name: "line", typeName: "int4", family: "numeric" },
      { name: "qty", typeName: "int4", family: "numeric" },
    ];
    const result = prepareDataQuery(
      input({ sort: "qty DESC, line DESC" }),
      columns,
    );
    if (!result.ok) throw new Error("bind failed");
    expect(
      compileDataQuery(result.value, ["order_id", "line"], REL).orderBySql,
    ).toBe(
      '"app"."t"."qty" DESC, "app"."t"."line" DESC, "app"."t"."order_id" ASC',
    );
  });

  it("never interpolates literal text into SQL", () => {
    const payloads = [
      "'; DROP TABLE users; --",
      "1 OR TRUE",
      "name); DELETE FROM users; --",
      "pg_sleep(10)",
      "(SELECT secret FROM credentials)",
    ];
    for (const payload of payloads) {
      const escaped = payload.replaceAll("'", "''");
      const compiled = compileDataQuery(
        bound({ filter: `status = '${escaped}' OR status IN ('${escaped}')` }),
        ["id"],
        REL,
      );
      const sql = [
        compiled.selectListSql,
        compiled.whereSql,
        compiled.orderBySql,
      ].join(" ");
      expect(sql).not.toContain(payload);
      expect(compiled.values).toEqual([payload, payload]);
    }
  });
});

describe("pageWindow", () => {
  const window = (
    skip: number | null,
    limit: number | null,
    page: number,
    pageSize: number,
    matching: number,
  ) => pageWindow({ skip, limit }, page, pageSize, matching);

  it("reproduces plain paging without Skip or Limit", () => {
    expect(window(null, null, 1, 50, 120)).toEqual({
      count: 120,
      offset: 0,
      limit: 50,
    });
    expect(window(null, null, 3, 50, 120)).toEqual({
      count: 120,
      offset: 100,
      limit: 20,
    });
  });

  it("shifts pages by Skip and caps the result at Limit", () => {
    expect(window(10, 25, 1, 20, 120)).toEqual({
      count: 25,
      offset: 10,
      limit: 20,
    });
    expect(window(10, 25, 2, 20, 120)).toEqual({
      count: 25,
      offset: 30,
      limit: 5,
    });
    expect(window(115, null, 1, 50, 120)).toEqual({
      count: 5,
      offset: 115,
      limit: 5,
    });
  });

  it("returns an empty page past the end or past all rows", () => {
    expect(window(200, null, 1, 50, 120)).toEqual({
      count: 0,
      offset: 200,
      limit: 0,
    });
    expect(window(0, 10, 2, 10, 120).limit).toBe(0);
  });
});

describe("buildRelationQuery", () => {
  it("writes one clause per line with Skip/Limit after the filter values", () => {
    const compiled = compileDataQuery(
      bound({
        filter: "status = 'active'",
        projection: "id",
        sort: "id DESC",
        skip: "20",
        limit: "10",
      }),
      ["id"],
      REL,
    );
    expect(buildRelationQuery(REL, compiled)).toEqual({
      text: [
        'SELECT "id"',
        'FROM "app"."t"',
        'WHERE "status" = $1',
        'ORDER BY "app"."t"."id" DESC',
        "OFFSET $2",
        "LIMIT $3",
      ].join("\n"),
      values: ["active", 20, 10],
    });
  });

  it("omits empty clauses", () => {
    const compiled = compileDataQuery(bound({}), null, REL);
    expect(buildRelationQuery(REL, compiled)).toEqual({
      text: 'SELECT *\nFROM "app"."t"',
      values: [],
    });
  });
});

describe("classifyTypeFamily", () => {
  it.each([
    ["int4", "N", "numeric"],
    ["numeric", "N", "numeric"],
    ["text", "S", "text"],
    ["varchar", "S", "text"],
    ["citext", "S", "text"],
    ["bpchar", "S", "text"],
    ["timestamptz", "D", "temporal"],
    ["interval", "T", "temporal"],
    ["bool", "B", "boolean"],
    ["user_role", "E", "enum"],
    ["uuid", "U", "uuid"],
    ["jsonb", "U", "jsonb"],
    ["json", "U", "other"],
    ["_text", "A", "other"],
    ["int4range", "R", "other"],
    ["point", "G", "other"],
    ["inet", "I", "other"],
    ["vector", "U", "other"],
    ["geometry", "U", "other"],
    ["mystery_ext_string", "S", "other"],
  ])("maps %s (%s) to %s", (typeName, category, family) => {
    expect(classifyTypeFamily(typeName, category)).toBe(family);
  });
});
