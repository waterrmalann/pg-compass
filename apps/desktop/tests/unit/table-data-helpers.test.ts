import { describe, expect, it } from "vitest";
import { isReadOnlyQuery, stripLimitOffset } from "@/main/table-data-rows";
import {
  buildExportSql,
  csvEscapeValue,
  csvQuoteField,
} from "@/main/table-data-export";
import { assertSafePgCast } from "@/main/table-data-write";
import { ensureArray } from "@/main/table-data-utils";

describe("table-data query helpers", () => {
  it.each([
    ["SELECT 1", true],
    ["   SELECT 1", true],
    ["select 1", true],
    ["SeLeCt 1", true],
    ["WITH q AS (SELECT 1) SELECT * FROM q", true],
    ["DELETE FROM x", false],
    ["INSERT INTO x VALUES (1)", false],
    ["UPDATE x SET a = 1", false],
    ["TRUNCATE x", false],
    ["DROP TABLE x", false],
    ["", false],
    ["   ", false],
    ["-- SELECT 1\nDELETE FROM x", false],
  ])("isReadOnlyQuery(%j) -> %s", (sql, expected) => {
    expect(isReadOnlyQuery(sql)).toBe(expected);
  });

  it.each([
    [
      "SELECT * FROM t LIMIT 25 OFFSET 50",
      { core: "SELECT * FROM t", userLimit: 25 },
    ],
    [
      "SELECT * FROM t limit 10 offset 5",
      { core: "SELECT * FROM t", userLimit: 10 },
    ],
    [
      "SELECT * FROM t LIMIT 25 OFFSET 50  ",
      { core: "SELECT * FROM t", userLimit: 25 },
    ],
    ["SELECT * FROM t LIMIT 25", { core: "SELECT * FROM t", userLimit: 25 }],
    ["SELECT * FROM t OFFSET 50", { core: "SELECT * FROM t", userLimit: null }],
    ["SELECT * FROM t", { core: "SELECT * FROM t", userLimit: null }],
    // Trailing LIMIT only; no OFFSET to strip
    ["SELECT 1 LIMIT 0", { core: "SELECT 1", userLimit: 0 }],
  ])("stripLimitOffset(%j) -> %o", (sql, expected) => {
    expect(stripLimitOffset(sql)).toEqual(expected);
  });

  it("does not strip LIMIT/OFFSET that appear only as identifiers mid-query", () => {
    // These are not trailing, so the regex should leave them intact.
    const sql = "SELECT * FROM t WHERE col = 'LIMIT 5'";
    expect(stripLimitOffset(sql)).toEqual({ core: sql, userLimit: null });
  });
});

describe("table-data export helpers", () => {
  it("quotes CSV fields when required", () => {
    expect(csvQuoteField("hello")).toBe("hello");
    expect(csvQuoteField("hello,world")).toBe('"hello,world"');
    expect(csvEscapeValue({ ok: true })).toBe('"{""ok"":true}"');
  });

  describe("csvEscapeValue edge cases", () => {
    it("returns empty string for null and undefined", () => {
      expect(csvEscapeValue(null)).toBe("");
      expect(csvEscapeValue(undefined)).toBe("");
    });

    it("quotes strings containing commas, quotes, newlines, or carriage returns", () => {
      expect(csvEscapeValue('has "quotes"')).toBe('"has ""quotes"""');
      expect(csvEscapeValue("line1\nline2")).toBe('"line1\nline2"');
      expect(csvEscapeValue("line1\r\nline2")).toBe('"line1\r\nline2"');
    });

    it("stringifies numbers, booleans, and bigints without quoting", () => {
      expect(csvEscapeValue(42)).toBe("42");
      expect(csvEscapeValue(true)).toBe("true");
      expect(csvEscapeValue(BigInt("9007199254740993"))).toBe(
        "9007199254740993",
      );
    });

    it("json-stringifies arrays and nested objects", () => {
      expect(csvEscapeValue([1, 2, 3])).toBe('"[1,2,3]"');
      expect(csvEscapeValue({ a: { b: "c,d" } })).toBe(
        '"{""a"":{""b"":""c,d""}}"',
      );
    });

    it("handles empty arrays and empty objects", () => {
      expect(csvEscapeValue([])).toBe("[]");
      expect(csvEscapeValue({})).toBe("{}");
    });

    it("stringifies symbols via their toString", () => {
      expect(csvEscapeValue(Symbol("hi"))).toBe("Symbol(hi)");
    });
  });

  it("builds export SQL from table exports and query exports", () => {
    expect(
      buildExportSql({
        connectionId: "c1",
        format: "csv",
        filePath: "users.csv",
        schema: "app",
        table: "users",
      }),
    ).toBe('SELECT * FROM "app"."users"');

    expect(
      buildExportSql({
        connectionId: "c1",
        format: "json",
        filePath: "query.json",
        sql: "SELECT * FROM app.users;",
      }),
    ).toBe("SELECT * FROM app.users");
  });

  it("rejects non-SELECT SQL when exporting a query", () => {
    expect(() =>
      buildExportSql({
        connectionId: "c1",
        format: "csv",
        filePath: "x.csv",
        sql: "DELETE FROM app.users",
      }),
    ).toThrow(/SELECT/);
  });

  it("quotes schema and table identifiers with embedded quotes", () => {
    expect(
      buildExportSql({
        connectionId: "c1",
        format: "csv",
        filePath: "x.csv",
        schema: 'we"ird',
        table: 'ta"ble',
      }),
    ).toBe('SELECT * FROM "we""ird"."ta""ble"');
  });
});

describe("ensureArray", () => {
  it("passes arrays through and treats non-strings as empty", () => {
    expect(ensureArray(["a", "b"])).toEqual(["a", "b"]);
    expect(ensureArray(null)).toEqual([]);
    expect(ensureArray("{}")).toEqual([]);
  });

  it("parses quoted elements containing commas, quotes and backslashes", () => {
    expect(ensureArray("{id,name}")).toEqual(["id", "name"]);
    expect(ensureArray('{"a,b",c}')).toEqual(["a,b", "c"]);
    expect(ensureArray(String.raw`{"say \"hi\"","back\\slash"}`)).toEqual([
      'say "hi"',
      String.raw`back\slash`,
    ]);
  });
});

describe("assertSafePgCast", () => {
  it.each([
    "text",
    "int2",
    "int4",
    "int8",
    "float4",
    "float8",
    "numeric",
    "bool",
    "uuid",
    "json",
    "jsonb",
    "date",
    "time",
    "timestamp",
    "timestamptz",
    "_int4",
    "_text",
    "geometry",
    "geography",
    "vector",
  ])("accepts %s", (cast) => {
    expect(() => assertSafePgCast(cast)).not.toThrow();
  });

  it.each([
    "text; DROP TABLE x",
    "unknown_type",
    "",
    "INT4",
    "int4 WITH TIME ZONE",
    "text OR 1=1",
    "jsonb); DELETE FROM users; --",
  ])("rejects %s", (cast) => {
    expect(() => assertSafePgCast(cast)).toThrow(/cast/i);
  });
});
