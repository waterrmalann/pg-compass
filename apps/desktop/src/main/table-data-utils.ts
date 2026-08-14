import type { PoolClient } from "pg";
import { quoteIdent } from "./pg-utils";

/**
 * PostgreSQL ARRAY subqueries may arrive as a string like "{a,b}" rather than
 * a JS array, depending on the `pg` type-parser configuration.  This helper
 * normalises the value to a proper string array.
 *
 * These arrays are built from raw identifiers (e.g. column names via
 * `a.attname`), which can legally contain commas, double quotes, or
 * backslashes — Postgres represents such an element as a double-quoted,
 * backslash-escaped run within the `{...}` literal (e.g. a column literally
 * named `a,b` becomes `{"a,b"}`, not `{a,b}`), so this can't be a plain
 * comma-split: that would silently mis-split one element into two and
 * corrupt the constraint metadata built from it.
 */
export function ensureArray(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  const inner = value.replace(/^\{|\}$/g, "");
  if (inner === "") return [];

  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inQuotes) {
      if (ch === "\\" && i + 1 < inner.length) {
        current += inner[++i];
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Build a type-name lookup from pg_type for a set of OIDs. */
export async function buildTypeMap(
  client: PoolClient,
  oids: number[],
): Promise<Map<number, string>> {
  if (oids.length === 0) return new Map();

  const unique = [...new Set(oids)];
  const result = await client.query<{ oid: string; typname: string }>(
    `SELECT oid, typname FROM pg_type WHERE oid = ANY($1::oid[])`,
    [unique],
  );

  const map = new Map<number, string>();
  for (const row of result.rows) {
    map.set(Number(row.oid), row.typname);
  }
  return map;
}

/**
 * Build a label lookup for enum-typed OIDs. Non-enum OIDs are absent from the
 * returned map, so callers can distinguish "no labels" (regular type) from
 * "empty labels" (enum with zero values, which PostgreSQL disallows anyway).
 */
export interface EnumTypeInfo {
  labels: string[];
  pgCast: string;
}

export async function buildEnumTypeMap(
  client: PoolClient,
  oids: number[],
): Promise<Map<number, EnumTypeInfo>> {
  if (oids.length === 0) return new Map();

  const unique = [...new Set(oids)];
  const result = await client.query<{
    oid: string;
    enumlabel: string;
    nspname: string;
    typname: string;
  }>(
    `
    SELECT t.oid, e.enumlabel, n.nspname, t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.oid = ANY($1::oid[])
    ORDER BY t.oid, e.enumsortorder
    `,
    [unique],
  );

  const map = new Map<number, EnumTypeInfo>();
  for (const row of result.rows) {
    const oid = Number(row.oid);
    const pgCast = `${quoteIdent(row.nspname)}.${quoteIdent(row.typname)}`;
    const existing = map.get(oid);
    if (existing) {
      existing.labels.push(row.enumlabel);
      continue;
    }
    map.set(oid, { labels: [row.enumlabel], pgCast });
  }
  return map;
}
