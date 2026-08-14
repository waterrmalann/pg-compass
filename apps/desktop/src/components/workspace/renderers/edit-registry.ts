/**
 * Cell editor registry — parallel to `type-registry.ts`.
 *
 * A missing editor means "we haven't made this type editable yet" (the cell
 * falls back to a plain text editor), not a broken state. This keeps display
 * and edit concerns separable.
 *
 * The renderer validates values before sending to the main process, but the
 * main process is authoritative: it re-checks read-only mode, rejects unknown
 * pgCast values through an allowlist, and surfaces Postgres constraint errors
 * verbatim.
 */

import type { ComponentType } from "react";

export interface EditResult {
  /** JS value to send to the main process (pg driver parameterises it). */
  value: unknown;
  /** Explicit pg cast for the UPDATE statement (e.g. `jsonb`, `int4`). */
  pgCast: string;
}

export type EditValidation =
  | { ok: true; result: EditResult }
  | { ok: false; error: string };

export interface TypeEditorProps {
  initialValue: unknown;
  onSave: (result: EditResult) => void;
  onCancel: () => void;
}

export interface TypeEditor {
  /** Inline = `<Input>` in a popover; modal = dedicated `<Dialog>` editor. */
  kind: "inline" | "modal";
  /** Serialize the current DB value to the string the editor opens with. */
  toInput(value: unknown): string;
  /** Parse + validate editor output before sending to the main process. */
  validate(raw: string): EditValidation;
  /** Custom component for modal editors (PostGIS map, future JSON tree). */
  Component?: ComponentType<TypeEditorProps>;
}

class EditRegistry {
  private readonly editors = new Map<string, TypeEditor>();
  private fallback: TypeEditor | null = null;

  register(pgType: string, editor: TypeEditor): void {
    this.editors.set(pgType, editor);
  }

  registerMany(pgTypes: string[], editor: TypeEditor): void {
    for (const t of pgTypes) this.editors.set(t, editor);
  }

  setFallback(editor: TypeEditor): void {
    this.fallback = editor;
  }

  /** Returns the editor for a type, or the fallback when unregistered. */
  get(pgType: string): TypeEditor {
    const editor = this.editors.get(pgType);
    if (editor) return editor;
    if (!this.fallback) {
      throw new Error(
        "edit-registry: fallback editor is not set — did you forget to call registerDefaultEditors()?",
      );
    }
    return this.fallback;
  }

  has(pgType: string): boolean {
    return this.editors.has(pgType);
  }
}

export const editRegistry = new EditRegistry();

// ---------------------------------------------------------------------------
// Built-in editors
//
// Each editor is responsible for parsing a user-typed string into a JS value
// that can safely travel over IPC and be applied with an explicit `$n::<cast>`
// in the UPDATE. Values are pre-validated so a clean rejection happens on the
// renderer side before any round-trip — the main process then re-checks the
// cast against its allowlist as a second line of defence.
//
// When a user-facing grammar is locale- or parser-dependent enough that a
// per-case pre-validator would drift from Postgres's (e.g. `interval`,
// `money`, `xml`), we fall through and let Postgres error. Those editors
// only reject the empty string.
// ---------------------------------------------------------------------------

const ok = (value: unknown, pgCast: string): EditValidation => ({
  ok: true,
  result: { value, pgCast },
});
const err = (error: string): EditValidation => ({ ok: false, error });

function toInputString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * `date`/`timestamp` (no time zone) carry no offset on the wire, so the `pg`
 * driver parses them into a `Date` using the LOCAL-time constructor (its
 * Y/M/D/H/M/S become the Date's local fields, not UTC ones). Reading them
 * back with `toISOString()` re-interprets those same fields as UTC, shifting
 * the displayed (and, if saved unchanged, the stored) value by the system's
 * UTC offset — a full day for `date` in any non-UTC zone. These two read the
 * Date's LOCAL fields back out instead, which is the correct inverse.
 */
function toLocalDateString(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function toLocalTimestampString(value: Date): string {
  const ms = value.getMilliseconds();
  const msPart = ms ? `.${String(ms).padStart(3, "0")}` : "";
  return `${toLocalDateString(value)}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}${msPart}`;
}

// --- text -------------------------------------------------------------------

const textEditor: TypeEditor = {
  kind: "inline",
  toInput: toInputString,
  validate(raw) {
    if (raw.includes("\u0000")) {
      return err("Postgres text columns cannot contain NUL (\\u0000).");
    }
    return ok(raw, "text");
  },
};

function varyingTextEditor(pgCast: string): TypeEditor {
  return {
    kind: "inline",
    toInput: toInputString,
    validate(raw) {
      if (raw.includes("\u0000")) {
        return err(`${pgCast} columns cannot contain NUL (\\u0000).`);
      }
      return ok(raw, pgCast);
    },
  };
}

// --- integer ----------------------------------------------------------------

// Accept optional leading +/- followed by digits. Whitespace around the
// number is tolerated. No decimals, no thousands separators, no exponents.
const INTEGER_RE = /^[+-]?\d+$/;

function makeIntEditor(
  pgCast: "int2" | "int4" | "int8",
  min: bigint,
  max: bigint,
): TypeEditor {
  return {
    kind: "inline",
    toInput: toInputString,
    validate(raw) {
      const trimmed = raw.trim();
      if (!INTEGER_RE.test(trimmed)) {
        return err(`Not a valid ${pgCast}: ${raw}`);
      }
      let big: bigint;
      try {
        big = BigInt(trimmed);
      } catch {
        return err(`Not a valid ${pgCast}: ${raw}`);
      }
      if (big < min || big > max) {
        return err(`Out of ${pgCast} range: ${trimmed}`);
      }
      // For int2/int4 we can safely represent as Number (fits); for int8 we
      // keep the canonical string to avoid Number precision loss on the wire
      // and at the pg driver.
      const value =
        pgCast === "int8"
          ? trimmed.replace(/^\+/, "") // strip leading + for Postgres literal parity
          : Number(trimmed);
      return ok(value, pgCast);
    },
  };
}

const INT2_MIN = -32768n;
const INT2_MAX = 32767n;
const INT4_MIN = -2147483648n;
const INT4_MAX = 2147483647n;
const INT8_MIN = -9223372036854775808n;
const INT8_MAX = 9223372036854775807n;

// --- float / numeric --------------------------------------------------------

// Postgres floats accept NaN, Infinity, -Infinity (case-insensitive), plus
// the usual decimal/exponent grammar. We mirror that: explicit keywords are
// passed through as-is; everything else must parse through Number.
function makeFloatEditor(pgCast: "float4" | "float8"): TypeEditor {
  return {
    kind: "inline",
    toInput: toInputString,
    validate(raw) {
      const trimmed = raw.trim();
      if (trimmed === "") return err(`Not a valid ${pgCast}.`);
      const lower = trimmed.toLowerCase();
      if (lower === "nan") return ok("NaN", pgCast);
      if (lower === "infinity" || lower === "inf")
        return ok("Infinity", pgCast);
      if (lower === "-infinity" || lower === "-inf") {
        return ok("-Infinity", pgCast);
      }
      // Strict decimal/exponent grammar — reject junk that Number() silently
      // accepts (e.g. leading hex, trailing characters).
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
        return err(`Not a valid ${pgCast}: ${raw}`);
      }
      const n = Number(trimmed);
      if (Number.isNaN(n)) return err(`Not a valid ${pgCast}: ${raw}`);
      return ok(n, pgCast);
    },
  };
}

// numeric preserves arbitrary precision — we keep the canonical string and
// forward it unchanged so the driver hands it to Postgres verbatim.
const numericEditor: TypeEditor = {
  kind: "inline",
  toInput: toInputString,
  validate(raw) {
    const trimmed = raw.trim();
    if (trimmed === "") return err("Not a valid numeric.");
    const lower = trimmed.toLowerCase();
    if (lower === "nan") return ok("NaN", "numeric");
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
      return err(`Not a valid numeric: ${raw}`);
    }
    return ok(trimmed, "numeric");
  },
};

// --- bool -------------------------------------------------------------------

const BOOL_TRUE = new Set(["true", "t", "yes", "y", "on", "1"]);
const BOOL_FALSE = new Set(["false", "f", "no", "n", "off", "0"]);

const boolEditor: TypeEditor = {
  kind: "inline",
  toInput(value) {
    if (typeof value === "boolean") return value ? "true" : "false";
    return toInputString(value);
  },
  validate(raw) {
    const lower = raw.trim().toLowerCase();
    if (BOOL_TRUE.has(lower)) return ok(true, "bool");
    if (BOOL_FALSE.has(lower)) return ok(false, "bool");
    return err(`Not a valid bool: ${raw}`);
  },
};

// --- uuid -------------------------------------------------------------------

// Canonical, dashless, and brace-wrapped forms. Postgres's uuid_in() accepts
// all three; we normalise to the canonical 8-4-4-4-12 form before sending.
const UUID_CANONICAL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_NO_HYPHENS = /^[0-9a-f]{32}$/i;
const UUID_BRACED =
  /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i;

function normaliseUuid(raw: string): string | null {
  const trimmed = raw.trim();
  if (UUID_CANONICAL.test(trimmed)) return trimmed.toLowerCase();
  if (UUID_BRACED.test(trimmed)) return trimmed.slice(1, -1).toLowerCase();
  if (UUID_NO_HYPHENS.test(trimmed)) {
    const lower = trimmed.toLowerCase();
    return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
  }
  return null;
}

const uuidEditor: TypeEditor = {
  kind: "inline",
  toInput: toInputString,
  validate(raw) {
    const normalised = normaliseUuid(raw);
    if (!normalised) return err(`Not a valid uuid: ${raw}`);
    return ok(normalised, "uuid");
  },
};

// --- json / jsonb -----------------------------------------------------------

function makeJsonEditor(pgCast: "json" | "jsonb"): TypeEditor {
  return {
    kind: "inline",
    toInput(value) {
      if (value === null || value === undefined) return "";
      if (typeof value === "string") return value;
      return JSON.stringify(value, null, 2);
    },
    validate(raw) {
      const trimmed = raw.trim();
      if (trimmed === "") return err(`${pgCast} cannot be empty.`);
      try {
        JSON.parse(trimmed);
      } catch (e) {
        return err(`Invalid JSON: ${(e as Error).message}`);
      }
      // jsonb storage cannot hold the NUL code point; json can (as escaped
      // text), so only gate jsonb.
      if (pgCast === "jsonb" && /\\u0000/i.test(trimmed)) {
        return err("jsonb cannot contain the NUL code point (\\u0000).");
      }
      // Send the raw string and let Postgres do the canonical parse; this
      // preserves user formatting and handles `null`, primitives, etc.
      return ok(trimmed, pgCast);
    },
  };
}

// --- arrays -----------------------------------------------------------------

// We accept a JSON-style literal in the editor (e.g. `[1,2,3]`, `["a","b"]`)
// and hand the resulting JS array to pg, which will format it as a PG array
// literal via the driver's type coercion. We reject PG curly-brace syntax to
// avoid the ambiguity that bit JSONB earlier in Phase 1.
function parseJsonArray(raw: string): unknown[] | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function makeIntArrayEditor(
  pgCast: "_int2" | "_int4" | "_int8",
  min: bigint,
  max: bigint,
): TypeEditor {
  return {
    kind: "inline",
    toInput(value) {
      return Array.isArray(value)
        ? JSON.stringify(value)
        : toInputString(value);
    },
    validate(raw) {
      const parsed = parseJsonArray(raw);
      if (!parsed) return err(`Not a valid integer array: ${raw}`);
      const normalized: Array<number | string> = [];
      for (const item of parsed) {
        const itemText =
          typeof item === "number" && Number.isInteger(item)
            ? String(item)
            : typeof item === "string" && INTEGER_RE.test(item)
              ? item
              : null;
        if (itemText === null) {
          return err(`Array contains a non-integer value: ${String(item)}`);
        }
        const integer = BigInt(itemText);
        if (integer < min || integer > max) {
          return err(
            `Array value is out of ${pgCast.slice(1)} range: ${itemText}`,
          );
        }
        normalized.push(pgCast === "_int8" ? itemText : Number(itemText));
      }
      return ok(normalized, pgCast);
    },
  };
}

function makeTextArrayEditor(pgCast: "_text" | "_varchar"): TypeEditor {
  return {
    kind: "inline",
    toInput(value) {
      return Array.isArray(value)
        ? JSON.stringify(value)
        : toInputString(value);
    },
    validate(raw) {
      const parsed = parseJsonArray(raw);
      if (!parsed) return err(`Not a valid text array: ${raw}`);
      for (const item of parsed) {
        if (typeof item !== "string") {
          return err(`Array contains a non-string value: ${String(item)}`);
        }
      }
      return ok(parsed, pgCast);
    },
  };
}

// --- temporal ---------------------------------------------------------------

function makeTimestampEditor(pgCast: "timestamp" | "timestamptz"): TypeEditor {
  return {
    kind: "inline",
    toInput(value) {
      if (value instanceof Date) {
        return pgCast === "timestamptz"
          ? value.toISOString()
          : toLocalTimestampString(value);
      }
      return toInputString(value);
    },
    validate(raw) {
      const trimmed = raw.trim();
      if (trimmed === "") return err(`Not a valid ${pgCast}.`);
      // Require an ISO-ish shape; reject bare day-only strings.
      if (!/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(trimmed)) {
        return err(`Not a valid ${pgCast}: ${raw}`);
      }
      const parsed = Date.parse(trimmed);
      if (Number.isNaN(parsed)) return err(`Not a valid ${pgCast}: ${raw}`);
      // Send the user's string through so Postgres preserves the precise
      // offset/precision they typed; pg will format it via ::timestamptz.
      return ok(trimmed, pgCast);
    },
  };
}

const dateEditor: TypeEditor = {
  kind: "inline",
  toInput(value) {
    if (value instanceof Date) return toLocalDateString(value);
    return toInputString(value);
  },
  validate(raw) {
    const trimmed = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return err(`Not a valid date (expected YYYY-MM-DD): ${raw}`);
    }
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) return err(`Not a valid date: ${raw}`);
    return ok(trimmed, "date");
  },
};

const timeEditor: TypeEditor = {
  kind: "inline",
  toInput: toInputString,
  validate(raw) {
    const trimmed = raw.trim();
    if (!/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
      return err(`Not a valid time: ${raw}`);
    }
    return ok(trimmed, "time");
  },
};

const timetzEditor: TypeEditor = {
  kind: "inline",
  toInput: toInputString,
  validate(raw) {
    const trimmed = raw.trim();
    if (
      !/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/i.test(trimmed)
    ) {
      return err(`Not a valid timetz value: ${raw}`);
    }
    return ok(trimmed, "timetz");
  },
};

// --- vector (pgvector) ------------------------------------------------------

const vectorEditor: TypeEditor = {
  kind: "inline",
  toInput(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return `[${value.join(",")}]`;
    return toInputString(value);
  },
  validate(raw) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
      return err("Vectors use [x,y,z] syntax (not {x,y,z}).");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return err(`Not a valid vector literal: ${raw}`);
    }
    if (!Array.isArray(parsed)) return err(`Not a vector: ${raw}`);
    for (const item of parsed) {
      if (typeof item !== "number" || !Number.isFinite(item)) {
        return err(`Vector element is not a finite number: ${String(item)}`);
      }
    }
    // Send the canonical bracket form; pgvector accepts it verbatim.
    return ok(trimmed, "vector");
  },
};

// --- PostGIS geometry / geography (modal) -----------------------------------

// WKT: `GEOMETRY(...)` with optional `SRID=<n>;` prefix (EWKT). We only
// pre-validate shape so the modal can ship the string; detailed parsing
// lives in the map editor.
const GEOMETRY_TYPES = [
  "POINT",
  "LINESTRING",
  "POLYGON",
  "MULTIPOINT",
  "MULTILINESTRING",
  "MULTIPOLYGON",
  "GEOMETRYCOLLECTION",
];

function makeGeometryEditor(pgCast: "geometry" | "geography"): TypeEditor {
  return {
    kind: "modal",
    toInput: toInputString,
    validate(raw) {
      const trimmed = raw.trim();
      if (trimmed === "") return err(`${pgCast} cannot be empty.`);
      const withoutSrid = trimmed.replace(/^SRID=\d+\s*;\s*/i, "").trim();
      const upper = withoutSrid.toUpperCase();
      if (!GEOMETRY_TYPES.some((t) => upper.startsWith(t))) {
        return err(`Not a recognised ${pgCast} WKT: ${raw}`);
      }
      return ok(trimmed, pgCast);
    },
  };
}

// --- pass-through (grammar too large to mirror) -----------------------------

function passThroughEditor(pgCast: string): TypeEditor {
  return {
    kind: "inline",
    toInput: toInputString,
    validate(raw) {
      if (raw === "") return err(`${pgCast} cannot be empty.`);
      return ok(raw, pgCast);
    },
  };
}

// --- bytea ------------------------------------------------------------------

// Accept Postgres's hex form only (`\x...`). Plain hex (no prefix) is also
// accepted and rewritten. Anything else is rejected — the cell renderer will
// fall back to showing the hex blob read-only until we ship a richer editor.
const byteaEditor: TypeEditor = {
  kind: "inline",
  toInput(value) {
    if (typeof value === "string") return value;
    return toInputString(value);
  },
  validate(raw) {
    const trimmed = raw.trim();
    if (trimmed === "") return err("bytea cannot be empty.");
    if (/^\\x[0-9a-f]*$/i.test(trimmed)) return ok(trimmed, "bytea");
    if (/^[0-9a-f]+$/i.test(trimmed)) return ok(`\\x${trimmed}`, "bytea");
    return err(`Not a valid bytea hex literal: ${raw}`);
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDefaultEditors(): void {
  // Text family
  editRegistry.register("text", textEditor);
  editRegistry.register("varchar", varyingTextEditor("varchar"));
  editRegistry.register("bpchar", varyingTextEditor("bpchar"));
  editRegistry.register("char", varyingTextEditor("char"));
  editRegistry.register("name", varyingTextEditor("name"));
  editRegistry.register("citext", varyingTextEditor("citext"));

  // Integers
  editRegistry.register("int2", makeIntEditor("int2", INT2_MIN, INT2_MAX));
  editRegistry.register("int4", makeIntEditor("int4", INT4_MIN, INT4_MAX));
  editRegistry.register("int8", makeIntEditor("int8", INT8_MIN, INT8_MAX));

  // Floats / numeric
  editRegistry.register("float4", makeFloatEditor("float4"));
  editRegistry.register("float8", makeFloatEditor("float8"));
  editRegistry.register("numeric", numericEditor);

  // Bool
  editRegistry.register("bool", boolEditor);

  // UUID
  editRegistry.register("uuid", uuidEditor);

  // JSON / JSONB
  editRegistry.register("json", makeJsonEditor("json"));
  editRegistry.register("jsonb", makeJsonEditor("jsonb"));

  // Arrays
  editRegistry.register(
    "_int2",
    makeIntArrayEditor("_int2", INT2_MIN, INT2_MAX),
  );
  editRegistry.register(
    "_int4",
    makeIntArrayEditor("_int4", INT4_MIN, INT4_MAX),
  );
  editRegistry.register(
    "_int8",
    makeIntArrayEditor("_int8", INT8_MIN, INT8_MAX),
  );
  editRegistry.register("_text", makeTextArrayEditor("_text"));
  editRegistry.register("_varchar", makeTextArrayEditor("_varchar"));

  // Temporal
  editRegistry.register("timestamp", makeTimestampEditor("timestamp"));
  editRegistry.register("timestamptz", makeTimestampEditor("timestamptz"));
  editRegistry.register("date", dateEditor);
  editRegistry.register("time", timeEditor);
  editRegistry.register("timetz", timetzEditor);

  // Vectors
  editRegistry.register("vector", vectorEditor);

  // PostGIS
  editRegistry.register("geometry", makeGeometryEditor("geometry"));
  editRegistry.register("geography", makeGeometryEditor("geography"));

  // Bytea
  editRegistry.register("bytea", byteaEditor);

  // Pass-through grammars
  for (const t of ["interval", "money", "xml", "inet", "cidr", "macaddr"]) {
    editRegistry.register(t, passThroughEditor(t));
  }

  // Fallback for unregistered types — we still validate NUL, never SQL-null.
  editRegistry.setFallback(textEditor);
}
