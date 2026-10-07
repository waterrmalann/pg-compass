import { beforeAll, describe, expect, it } from "vitest";
import {
  editRegistry,
  registerDefaultEditors,
} from "@/components/workspace/renderers/edit-registry";

/**
 * Every pre-validated type has its own describe block; pass-through types
 * (interval, money, xml) are confirmed to not pre-reject.
 */

beforeAll(() => {
  registerDefaultEditors();
});

describe("text editor", () => {
  it("accepts arbitrary strings verbatim (empty string included)", () => {
    const ed = editRegistry.get("text");
    expect(ed.validate("").ok).toBe(true);
    expect(ed.validate("hello").ok).toBe(true);
    expect(ed.validate("   trailing whitespace   ").ok).toBe(true);
    expect(ed.validate("emoji \u{1F600}").ok).toBe(true);
  });

  it("rejects strings containing NUL (U+0000)", () => {
    const ed = editRegistry.get("text");
    const result = ed.validate("with\u0000null");
    expect(result.ok).toBe(false);
  });

  it("does not interpret the literal 'NULL' as SQL NULL", () => {
    const ed = editRegistry.get("text");
    const result = ed.validate("NULL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.value).toBe("NULL");
    }
  });
});

describe("int4 editor", () => {
  const ed = () => editRegistry.get("int4");

  it.each([
    ["0", 0],
    ["-1", -1],
    ["+42", 42],
    ["2147483647", 2147483647],
    ["-2147483648", -2147483648],
    ["  5  ", 5],
  ])("accepts %s", (raw, expected) => {
    const r = ed().validate(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.value).toBe(expected);
  });

  it.each([
    "",
    "  ",
    "1.0",
    "1.5",
    "1e3",
    "NaN",
    "Infinity",
    "1,000",
    "42abc",
    "2147483648",
    "-2147483649",
    "true",
    "--5",
    "+-5",
  ])("rejects %s", (raw) => {
    expect(ed().validate(raw).ok).toBe(false);
  });
});

describe("int2 editor", () => {
  const ed = () => editRegistry.get("int2");

  it("enforces int2 boundaries", () => {
    expect(ed().validate("32767").ok).toBe(true);
    expect(ed().validate("-32768").ok).toBe(true);
    expect(ed().validate("32768").ok).toBe(false);
    expect(ed().validate("-32769").ok).toBe(false);
  });
});

describe("int8 editor", () => {
  const ed = () => editRegistry.get("int8");

  it("preserves values above Number.MAX_SAFE_INTEGER using BigInt", () => {
    const big = "9007199254740993"; // 2^53 + 1 — lossy in Number
    const r = ed().validate(big);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Either BigInt or the preserved string — any representation that
      // round-trips back to the same digits is acceptable.
      expect(String(r.result.value)).toBe(big);
    }
  });

  it("rejects values above int8 max", () => {
    expect(ed().validate("9223372036854775808").ok).toBe(false);
  });

  it("accepts int8 max exactly", () => {
    expect(ed().validate("9223372036854775807").ok).toBe(true);
  });
});

describe("float8 editor", () => {
  const ed = () => editRegistry.get("float8");

  it.each([
    ["0", 0],
    ["1.5", 1.5],
    ["-1.2e-3", -0.0012],
    ["+3.14", 3.14],
  ])("accepts %s", (raw, expected) => {
    const r = ed().validate(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Number(r.result.value)).toBeCloseTo(expected, 10);
  });

  it.each(["", "1.2.3", "1e", "hello", "1,5"])("rejects %s", (raw) => {
    expect(ed().validate(raw).ok).toBe(false);
  });

  it("accepts NaN and Infinity (Postgres float accepts these)", () => {
    expect(ed().validate("NaN").ok).toBe(true);
    expect(ed().validate("Infinity").ok).toBe(true);
    expect(ed().validate("-Infinity").ok).toBe(true);
  });
});

describe("numeric editor", () => {
  const ed = () => editRegistry.get("numeric");

  it("preserves arbitrary-precision decimals exactly as a string", () => {
    const precise = "123456789012345678901234567890.987654321";
    const r = ed().validate(precise);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // MUST NOT round-trip through Number (would lose precision).
      expect(r.result.value).toBe(precise);
    }
  });

  it("rejects thousands separators", () => {
    expect(ed().validate("1,000").ok).toBe(false);
  });
});

describe("bool editor", () => {
  const ed = () => editRegistry.get("bool");

  it.each([
    ["true", true],
    ["TRUE", true],
    ["t", true],
    ["yes", true],
    ["1", true],
    ["on", true],
    ["false", false],
    ["f", false],
    ["no", false],
    ["0", false],
    ["off", false],
  ])("accepts %s as %s", (raw, expected) => {
    const r = ed().validate(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.value).toBe(expected);
  });

  it.each(["", "maybe", "2", "0.0", "tru", "ja"])("rejects %s", (raw) => {
    expect(ed().validate(raw).ok).toBe(false);
  });
});

describe("uuid editor", () => {
  const ed = () => editRegistry.get("uuid");

  it.each([
    "550e8400-e29b-41d4-a716-446655440000",
    "550E8400-E29B-41D4-A716-446655440000",
    "550e8400e29b41d4a716446655440000",
    "{550e8400-e29b-41d4-a716-446655440000}",
    "00000000-0000-0000-0000-000000000000",
  ])("accepts %s", (raw) => {
    expect(ed().validate(raw).ok).toBe(true);
  });

  it.each([
    "",
    "not-a-uuid",
    "550e8400-e29b-41d4-a716",
    "550e8400-e29b-41d4-a716-446655440000-extra",
    "zzze8400-e29b-41d4-a716-446655440000",
    "550e8400e29b-41d4-a716-446655440000",
  ])("rejects %s", (raw) => {
    expect(ed().validate(raw).ok).toBe(false);
  });
});

describe("jsonb editor", () => {
  const ed = () => editRegistry.get("jsonb");

  it("accepts JSON null (distinct from SQL NULL)", () => {
    const r = ed().validate("null");
    expect(r.ok).toBe(true);
  });

  it.each(["{}", "[]", '{"a":1}', "[1,2,3]", '"hello"', "1.5", "true"])(
    "accepts %s",
    (raw) => {
      expect(ed().validate(raw).ok).toBe(true);
    },
  );

  it.each(["", "{a:1}", "{'a':1}", "[1,2,]", "hello", "undefined", "NaN"])(
    "rejects %s",
    (raw) => {
      expect(ed().validate(raw).ok).toBe(false);
    },
  );

  it("rejects strings containing NUL in jsonb (cannot be stored)", () => {
    const r = ed().validate('"with\u0000null"');
    expect(r.ok).toBe(false);
  });

  it("uses pgCast 'jsonb'", () => {
    const r = ed().validate("{}");
    if (r.ok) expect(r.result.pgCast).toBe("jsonb");
  });
});

describe("_int4 array editor", () => {
  const ed = () => editRegistry.get("_int4");

  it("accepts [1,2,3] (JSON-ish array syntax for the editor)", () => {
    const r = ed().validate("[1,2,3]");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.value).toEqual([1, 2, 3]);
  });

  it("accepts empty array []", () => {
    expect(ed().validate("[]").ok).toBe(true);
  });

  it.each(['[1,"x"]', "[1.5]", "1,2,3", "{1,2,3}", ""])("rejects %s", (raw) => {
    expect(ed().validate(raw).ok).toBe(false);
  });
});

describe("_text array editor", () => {
  const ed = () => editRegistry.get("_text");

  it("accepts a JSON-style array of strings", () => {
    const r = ed().validate('["a","b"]');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.value).toEqual(["a", "b"]);
  });

  it("rejects an array containing non-strings", () => {
    expect(ed().validate('[1,"b"]').ok).toBe(false);
  });
});

describe("array cast preservation", () => {
  it.each([
    ["_int2", "[1,2]"],
    ["_int4", "[1,2]"],
    ["_int8", '["9223372036854775807"]'],
    ["_text", '["a"]'],
    ["_varchar", '["a"]'],
  ])("returns the source cast for %s", (pgType, raw) => {
    const result = editRegistry.get(pgType).validate(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.pgCast).toBe(pgType);
  });
});

describe("timetz editor", () => {
  it("accepts an explicit offset and preserves the timetz cast", () => {
    const result = editRegistry.get("timetz").validate("12:30:00+05:30");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.pgCast).toBe("timetz");
  });
});

describe("timestamptz editor", () => {
  const ed = () => editRegistry.get("timestamptz");

  it("accepts ISO-8601 with offset", () => {
    expect(ed().validate("2026-01-15T12:30:00.000Z").ok).toBe(true);
    expect(ed().validate("2026-01-15 12:30:00+05:30").ok).toBe(true);
  });

  it("rejects empty string", () => {
    expect(ed().validate("").ok).toBe(false);
  });

  it("rejects obviously invalid dates", () => {
    expect(ed().validate("2026-13-01").ok).toBe(false);
    expect(ed().validate("not-a-date").ok).toBe(false);
  });
});

describe("date editor", () => {
  const ed = () => editRegistry.get("date");

  it("accepts ISO date", () => {
    expect(ed().validate("2026-04-20").ok).toBe(true);
  });

  it("rejects a time component", () => {
    expect(ed().validate("2026-04-20T12:00:00").ok).toBe(false);
  });
});

describe("vector editor", () => {
  const ed = () => editRegistry.get("vector");

  it("accepts [1,2,3] (pgvector format)", () => {
    const r = ed().validate("[1,2,3]");
    expect(r.ok).toBe(true);
  });

  it("rejects PG array syntax {1,2,3}", () => {
    expect(ed().validate("{1,2,3}").ok).toBe(false);
  });

  it("rejects a vector containing non-finite numbers", () => {
    expect(ed().validate("[NaN, 1, 2]").ok).toBe(false);
    expect(ed().validate("[Infinity, 1, 2]").ok).toBe(false);
  });
});

describe("PostGIS geometry editor", () => {
  const ed = () => editRegistry.get("geometry");

  it("is a modal editor (map dialog)", () => {
    expect(ed().kind).toBe("modal");
  });

  it("accepts WKT POINT", () => {
    expect(ed().validate("POINT(13.405 52.52)").ok).toBe(true);
  });

  it("accepts EWKT with SRID", () => {
    expect(ed().validate("SRID=4326;POINT(13.405 52.52)").ok).toBe(true);
  });

  it("rejects empty string", () => {
    expect(ed().validate("").ok).toBe(false);
  });
});

describe("pass-through types", () => {
  // These types have grammars too large or too locale-dependent for useful
  // pre-validation. Validator should accept any non-empty string and let
  // Postgres do the parsing.
  it.each(["interval", "money", "xml"])(
    "%s accepts any non-empty string",
    (pgType) => {
      const ed = editRegistry.get(pgType);
      expect(ed.validate("anything at all").ok).toBe(true);
      expect(ed.validate("").ok).toBe(false); // empty still rejected
    },
  );
});

describe("registry mechanics", () => {
  it("falls back to a text editor for unknown pg types", () => {
    const fallback = editRegistry.get("some_unknown_type");
    expect(fallback.kind).toBe("inline");
    expect(fallback.validate("anything").ok).toBe(true);
  });

  it("has() reports explicit registration only", () => {
    expect(editRegistry.has("text")).toBe(true);
    expect(editRegistry.has("some_unknown_type")).toBe(false);
  });
});
