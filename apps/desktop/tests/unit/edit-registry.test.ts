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

function accepted(value: unknown, pgCast: string) {
  return { ok: true, result: { value, pgCast } };
}

describe("text editor", () => {
  it.each(["", "hello", "   trailing whitespace   ", "emoji \u{1F600}"])(
    "accepts %j verbatim with the text cast",
    (raw) => {
      expect(editRegistry.get("text").validate(raw)).toEqual(
        accepted(raw, "text"),
      );
    },
  );

  it("rejects strings containing NUL (U+0000)", () => {
    const ed = editRegistry.get("text");
    const result = ed.validate("with\u0000null");
    expect(result.ok).toBe(false);
  });

  it("does not interpret the literal 'NULL' as SQL NULL", () => {
    const ed = editRegistry.get("text");
    expect(ed.validate("NULL")).toEqual(accepted("NULL", "text"));
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
  ])("accepts %s as the number %s", (raw, expected) => {
    expect(ed().validate(raw)).toEqual(accepted(expected, "int4"));
  });

  it.each([
    "",
    "1.0",
    "1e3",
    "NaN",
    "Infinity",
    "1,000",
    "42abc",
    "2147483648",
    "-2147483649",
    "true",
    "--5",
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

  it("keeps values above Number.MAX_SAFE_INTEGER as the exact digit string", () => {
    const big = "9007199254740993"; // 2^53 + 1 — lossy in Number
    expect(ed().validate(big)).toEqual(accepted(big, "int8"));
  });

  it("strips a leading + from the digit string", () => {
    expect(ed().validate("+42")).toEqual(accepted("42", "int8"));
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
  ])("accepts %s as the number %s", (raw, expected) => {
    expect(ed().validate(raw)).toEqual(accepted(expected, "float8"));
  });

  it.each(["", "1.2.3", "1e", "hello", "1,5"])("rejects %s", (raw) => {
    expect(ed().validate(raw).ok).toBe(false);
  });

  it.each([
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["-Infinity", "-Infinity"],
    ["inf", "Infinity"],
    ["-INF", "-Infinity"],
  ])(
    "accepts the special value %s as the Postgres keyword %s",
    (raw, keyword) => {
      expect(ed().validate(raw)).toEqual(accepted(keyword, "float8"));
    },
  );
});

describe("numeric editor", () => {
  const ed = () => editRegistry.get("numeric");

  it("preserves arbitrary-precision decimals exactly as a string", () => {
    const precise = "123456789012345678901234567890.987654321";
    // MUST NOT round-trip through Number (would lose precision).
    expect(ed().validate(precise)).toEqual(accepted(precise, "numeric"));
  });

  it("accepts nan as the NaN keyword", () => {
    expect(ed().validate("nan")).toEqual(accepted("NaN", "numeric"));
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
    expect(ed().validate(raw)).toEqual(accepted(expected, "bool"));
  });

  it.each(["", "maybe", "2", "0.0", "tru", "ja"])("rejects %s", (raw) => {
    expect(ed().validate(raw).ok).toBe(false);
  });
});

describe("uuid editor", () => {
  const ed = () => editRegistry.get("uuid");
  const canonical = "550e8400-e29b-41d4-a716-446655440000";

  it.each([
    canonical,
    "550E8400-E29B-41D4-A716-446655440000",
    "550e8400e29b41d4a716446655440000",
    "{550e8400-e29b-41d4-a716-446655440000}",
  ])("normalises %s to the canonical lowercase form", (raw) => {
    expect(ed().validate(raw)).toEqual(accepted(canonical, "uuid"));
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

  it("accepts JSON null as the text 'null' (distinct from SQL NULL)", () => {
    expect(ed().validate("null")).toEqual(accepted("null", "jsonb"));
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

  it("rejects an escaped NUL in jsonb but accepts it in json", () => {
    // The escaped form is valid JSON, so only the jsonb storage rule rejects it.
    const withNul = String.raw`"with\u0000null"`;
    expect(ed().validate(withNul).ok).toBe(false);
    expect(editRegistry.get("json").validate(withNul)).toEqual(
      accepted(withNul, "json"),
    );
  });

  it("uses pgCast 'jsonb'", () => {
    expect(ed().validate("{}")).toEqual(accepted("{}", "jsonb"));
  });

  // `pg` parses json/jsonb into JS values, so a string scalar arrives as a
  // plain JS string; the editor must reopen it as a JSON string literal.
  it.each([
    ["hello", '"hello"'],
    ["123", '"123"'],
  ])(
    "re-saves the string scalar %j unchanged as %s",
    (dbValue, expectedInput) => {
      const input = ed().toInput(dbValue);
      expect(input).toBe(expectedInput);
      expect(ed().validate(input)).toEqual(accepted(expectedInput, "jsonb"));
    },
  );
});

describe("_int4 array editor", () => {
  const ed = () => editRegistry.get("_int4");

  it("accepts [1,2,3] (JSON-ish array syntax for the editor)", () => {
    expect(ed().validate("[1,2,3]")).toEqual(accepted([1, 2, 3], "_int4"));
  });

  it("accepts empty array []", () => {
    expect(ed().validate("[]").ok).toBe(true);
  });

  it.each(['[1,"x"]', "[1.5]", "1,2,3", "{1,2,3}", ""])("rejects %s", (raw) => {
    expect(ed().validate(raw).ok).toBe(false);
  });
});

describe("integer array ranges", () => {
  it("rejects an _int2 element outside the int2 range", () => {
    expect(editRegistry.get("_int2").validate("[1,40000]").ok).toBe(false);
  });

  it("keeps _int8 elements as digit strings so they stay exact", () => {
    expect(
      editRegistry.get("_int8").validate('[1,"9223372036854775807"]'),
    ).toEqual(accepted(["1", "9223372036854775807"], "_int8"));
  });
});

describe("_text array editor", () => {
  const ed = () => editRegistry.get("_text");

  it("accepts a JSON-style array of strings", () => {
    expect(ed().validate('["a","b"]')).toEqual(accepted(["a", "b"], "_text"));
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
    expect(result).toMatchObject({ ok: true, result: { pgCast: pgType } });
  });
});

describe("timetz editor", () => {
  it("accepts an explicit offset and preserves the timetz cast", () => {
    expect(editRegistry.get("timetz").validate("12:30:00+05:30")).toEqual(
      accepted("12:30:00+05:30", "timetz"),
    );
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

  it("rejects strings without a date-and-time shape", () => {
    expect(ed().validate("2026-13-01").ok).toBe(false);
    expect(ed().validate("not-a-date").ok).toBe(false);
  });

  it.each(["2026-13-01 12:00", "2026-01-15T25:00"])(
    "rejects the well-shaped but impossible timestamp %s",
    (raw) => {
      expect(ed().validate(raw).ok).toBe(false);
    },
  );
});

describe("date editor", () => {
  const ed = () => editRegistry.get("date");

  it("accepts ISO date", () => {
    expect(ed().validate("2026-04-20")).toEqual(accepted("2026-04-20", "date"));
  });

  it("rejects a time component", () => {
    expect(ed().validate("2026-04-20T12:00:00").ok).toBe(false);
  });

  it("rejects a well-shaped but impossible month", () => {
    expect(ed().validate("2026-00-10").ok).toBe(false);
  });
});

describe("vector editor", () => {
  const ed = () => editRegistry.get("vector");

  it("accepts [1,2,3] (pgvector format)", () => {
    expect(ed().validate("[1,2,3]")).toEqual(accepted("[1,2,3]", "vector"));
  });

  it("rejects PG array syntax {1,2,3}", () => {
    expect(ed().validate("{1,2,3}").ok).toBe(false);
  });

  it.each(['["a",1]', "[null]", "[true]"])(
    "rejects the JSON array %s with a non-number element",
    (raw) => {
      expect(ed().validate(raw).ok).toBe(false);
    },
  );
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
    expect(ed().validate("SRID=4326;POINT(13.405 52.52)")).toEqual(
      accepted("SRID=4326;POINT(13.405 52.52)", "geometry"),
    );
  });

  it("rejects empty string", () => {
    expect(ed().validate("").ok).toBe(false);
  });

  it("rejects text that is not a WKT geometry", () => {
    expect(ed().validate("hello").ok).toBe(false);
  });
});

describe("bytea editor", () => {
  const ed = () => editRegistry.get("bytea");

  it("accepts the \\x hex form unchanged", () => {
    expect(ed().validate(String.raw`\xDEAD`)).toEqual(
      accepted(String.raw`\xDEAD`, "bytea"),
    );
  });

  it("prefixes bare hex with \\x", () => {
    expect(ed().validate("dead")).toEqual(
      accepted(String.raw`\xdead`, "bytea"),
    );
  });

  it.each(["", "xyz", String.raw`\xZZ`])("rejects %j", (raw) => {
    expect(ed().validate(raw).ok).toBe(false);
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
      expect(ed.validate("anything at all")).toEqual(
        accepted("anything at all", pgType),
      );
      expect(ed.validate("").ok).toBe(false); // empty still rejected
    },
  );
});

describe("registry mechanics", () => {
  it("falls back to the text editor for unknown pg types", () => {
    const fallback = editRegistry.get("some_unknown_type");
    expect(fallback.kind).toBe("inline");
    expect(fallback.validate("anything")).toEqual(accepted("anything", "text"));
    expect(fallback.validate("")).toEqual(accepted("", "text"));
    expect(fallback.validate("with\u0000null").ok).toBe(false);
  });

  it("has() reports explicit registration only", () => {
    expect(editRegistry.has("text")).toBe(true);
    expect(editRegistry.has("some_unknown_type")).toBe(false);
  });
});
