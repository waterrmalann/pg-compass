import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { WebContents } from "electron";
import { createTempDir } from "../support/store";

const mocks = vi.hoisted(() => ({ withPoolClient: vi.fn() }));

vi.mock("@/main/pg-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main/pg-utils")>()),
  withPoolClient: mocks.withPoolClient,
}));

vi.mock("@/main/settings-store", () => ({
  getSettings: () => ({ general: { readOnlyMode: false } }),
}));

import {
  buildInsertBatchSql,
  computeBatchSize,
  CsvRecordParser,
  importData,
} from "@/main/table-data-import";

function parseCsvChunks(...chunks: string[]): string[][] {
  const parser = new CsvRecordParser();
  const records = chunks.flatMap((chunk) => parser.feed(chunk));
  return [...records, ...parser.finish()].map((record) => record.cells);
}

interface InsertCall {
  sql: string;
  values: unknown[];
}

const noopSender = { send: () => undefined } as unknown as WebContents;

/** Runs the production streaming import on a temp file and returns its INSERTs. */
async function importFile(
  format: "csv" | "json",
  content: string,
): Promise<InsertCall[]> {
  const filePath = path.join(
    createTempDir("pg-compass-import-"),
    `data.${format}`,
  );
  fs.writeFileSync(filePath, content, "utf-8");
  const inserts: InsertCall[] = [];
  const client = {
    query: (sql: string, values: unknown[] = []) => {
      if (sql.startsWith("INSERT")) inserts.push({ sql, values });
      return Promise.resolve({ rowCount: null });
    },
  };
  mocks.withPoolClient.mockImplementation(
    (_connectionId: string, callback: (c: typeof client) => unknown) =>
      callback(client),
  );
  await importData(
    {
      connectionId: "conn-1",
      schema: "app",
      table: "t",
      filePath,
      format,
      operationId: "op-1",
    },
    noopSender,
  );
  return inserts;
}

describe("CsvRecordParser (RFC 4180)", () => {
  it("parses simple comma-separated LF rows", () => {
    expect(parseCsvChunks("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsvChunks("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not emit a phantom trailing row after a final newline", () => {
    expect(parseCsvChunks("a\n1\n")).toEqual([["a"], ["1"]]);
  });

  it("keeps a final row that lacks a trailing newline", () => {
    expect(parseCsvChunks("a\n1")).toEqual([["a"], ["1"]]);
  });

  it("preserves commas inside quoted fields", () => {
    expect(parseCsvChunks('name,note\n"Smith, Jr.",hi\n')).toEqual([
      ["name", "note"],
      ["Smith, Jr.", "hi"],
    ]);
  });

  it("preserves newlines inside quoted fields", () => {
    expect(parseCsvChunks('a\n"line1\nline2"\n')).toEqual([
      ["a"],
      ["line1\nline2"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsvChunks('a\n"she said ""hi"""\n')).toEqual([
      ["a"],
      ['she said "hi"'],
    ]);
  });

  it("distinguishes trailing empty field from missing", () => {
    expect(parseCsvChunks("a,b,\n")).toEqual([["a", "b", ""]]);
  });

  it("throws on an unterminated quoted field", () => {
    expect(() => parseCsvChunks('a\n"unterminated\n')).toThrow(/unterminated/i);
  });

  it("rejects content after a closing quote", () => {
    expect(() => parseCsvChunks('a,b\n"x"junk,y\n')).toThrow(/closing quote/i);
  });

  it("rejects a quote inside an unquoted field", () => {
    expect(() => parseCsvChunks('a\nabc"def\n')).toThrow(/unquoted field/i);
  });

  // Files are streamed in chunks, so a token can straddle a chunk boundary.
  it("unescapes a doubled quote split across chunks", () => {
    expect(parseCsvChunks('a\n"x"', '"y"\n')).toEqual([["a"], ['x"y']]);
  });

  it("closes a quoted field whose closing quote ends a chunk", () => {
    expect(parseCsvChunks('a,b\n"x"', ",y\n")).toEqual([
      ["a", "b"],
      ["x", "y"],
    ]);
  });

  it("treats a CRLF split across chunks as one line ending", () => {
    expect(parseCsvChunks("a\r", "\n1\r\n")).toEqual([["a"], ["1"]]);
  });
});

describe("importData CSV parsing", () => {
  beforeEach(() => {
    mocks.withPoolClient.mockReset();
  });

  it("strips a UTF-8 BOM from the first header", async () => {
    const inserts = await importFile("csv", "﻿id,name\n1,alice\n");
    expect(inserts).toEqual([
      {
        sql: 'INSERT INTO "app"."t" ("id", "name") VALUES ($1, $2)',
        values: ["1", "alice"],
      },
    ]);
  });

  it("maps empty cells to NULL and keeps non-empty cells as strings", async () => {
    const inserts = await importFile("csv", "a,b\n1,\n,2\n");
    expect(inserts[0]!.values).toEqual(["1", null, null, "2"]);
  });

  it("skips blank lines between rows", async () => {
    const inserts = await importFile("csv", "a\n1\n\n2\n");
    expect(inserts[0]!.values).toEqual(["1", "2"]);
  });

  it("keeps a quoted empty field as a real one-column row", async () => {
    const inserts = await importFile("csv", 'a\n""\n');
    expect(inserts[0]!.values).toEqual([null]);
  });

  it("pads a short row with NULLs", async () => {
    const inserts = await importFile("csv", "a,b,c\n1,2\n");
    expect(inserts[0]!.values).toEqual(["1", "2", null]);
  });

  it("rejects a row with more cells than the header", async () => {
    await expect(importFile("csv", "a,b\n1,2,3\n")).rejects.toThrow(
      "Row 2 has 3 values but the header declares 2 columns.",
    );
  });

  it("rejects duplicate headers", async () => {
    await expect(importFile("csv", "id,id\n1,2\n")).rejects.toThrow(
      /duplicate/i,
    );
  });

  it("rejects an empty header name", async () => {
    await expect(importFile("csv", "a,,c\n1,2,3\n")).rejects.toThrow(
      /empty column/i,
    );
  });
});

describe("importData JSON parsing", () => {
  beforeEach(() => {
    mocks.withPoolClient.mockReset();
  });

  it("unions keys across objects in first-seen order and fills missing keys with NULL", async () => {
    const inserts = await importFile("json", '[{"a":1},{"b":"x"}]');
    expect(inserts).toEqual([
      {
        sql: 'INSERT INTO "app"."t" ("a", "b") VALUES ($1, $2), ($3, $4)',
        values: ["1", null, null, "x"],
      },
    ]);
  });

  it("maps JSON null to SQL NULL", async () => {
    const inserts = await importFile("json", '[{"a":null}]');
    expect(inserts[0]!.values).toEqual([null]);
  });

  it("keeps the exact digits of numbers, including inside nested values", async () => {
    const inserts = await importFile(
      "json",
      '[{"id":9007199254740993,"meta":{"id":9007199254740993,"ratio":1.234567890123456789},"tags":[1,2]}]',
    );
    expect(inserts[0]!.values).toEqual([
      "9007199254740993",
      '{"id":9007199254740993,"ratio":1.234567890123456789}',
      "[1,2]",
    ]);
  });

  it.each(["[1,2]", '[{"a":1},2]', '[{"a":1},[1]]', '"text"'])(
    "rejects %s because every row must be an object",
    async (content) => {
      await expect(importFile("json", content)).rejects.toThrow(
        "JSON import expects an array of objects (one object per row).",
      );
    },
  );

  it.each(["{not json", '{"a":1}{"a":2}'])(
    "rejects %s as invalid JSON",
    async (content) => {
      await expect(importFile("json", content)).rejects.toThrow(
        /^Invalid JSON: /,
      );
    },
  );

  it("rejects an empty file", async () => {
    await expect(importFile("json", "   ")).rejects.toThrow(
      "The JSON file is empty.",
    );
  });
});

describe("computeBatchSize", () => {
  it("caps at 1000 rows for narrow tables", () => {
    expect(computeBatchSize(1)).toBe(1000);
    expect(computeBatchSize(10)).toBe(1000);
  });

  it("keeps rows × columns under the 65535 bind-param limit for wide tables", () => {
    const cols = 100;
    const batch = computeBatchSize(cols);
    expect(batch * cols).toBeLessThanOrEqual(65_535);
    expect(batch).toBe(655);
  });

  it("never returns less than one", () => {
    expect(computeBatchSize(70_000)).toBe(1);
  });
});

describe("buildInsertBatchSql", () => {
  it("builds a multi-row INSERT with dense placeholders and quoted identifiers", () => {
    const sql = buildInsertBatchSql('"app"."notes"', ["a", "b"], 2);
    expect(sql).toBe(
      'INSERT INTO "app"."notes" ("a", "b") VALUES ($1, $2), ($3, $4)',
    );
  });

  it("quotes identifiers containing double quotes", () => {
    const sql = buildInsertBatchSql('"app"."t"', ['ev"il'], 1);
    expect(sql).toBe('INSERT INTO "app"."t" ("ev""il") VALUES ($1)');
  });
});
