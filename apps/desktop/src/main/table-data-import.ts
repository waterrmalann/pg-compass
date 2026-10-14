/**
 * Streaming JSON / CSV import. Rows are parsed and inserted in bounded batches
 * on one client and one transaction, so large files do not need to fit in
 * memory and any failure rolls the entire import back.
 */

import { type WebContents } from "electron";
import fs from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  isLosslessNumber,
  LosslessNumber,
  stringify as stringifyLosslessJson,
} from "lossless-json";
import parser from "stream-json/parser.js";
import streamArray from "stream-json/streamers/stream-array.js";
import streamValues from "stream-json/streamers/stream-values.js";
import { TableDataChannels } from "../shared/constants/ipc-channels";
import type {
  ImportDataParams,
  ImportResult,
} from "../shared/types/table-data";
import { quoteIdent, withPoolClient } from "./pg-utils";
import { getSettings } from "./settings-store";
import { createProgressThrottle } from "./table-data-export";

const MAX_BIND_PARAMS = 65_535;
const MAX_ROWS_PER_BATCH = 1_000;

interface CsvRecord {
  cells: string[];
  blank: boolean;
}

/** Incremental RFC 4180 parser. A quoted empty field is not a blank line. */
export class CsvRecordParser {
  private readonly records: CsvRecord[] = [];
  private row: string[] = [];
  private field = "";
  private inQuotes = false;
  private pendingQuote = false;
  private pendingCr = false;
  private afterQuote = false;
  private atFieldStart = true;
  private rowHasSyntax = false;

  feed(text: string): CsvRecord[] {
    for (let index = 0; index < text.length; index++) {
      const character = text[index]!;

      if (this.pendingCr) {
        this.pendingCr = false;
        if (character === "\n") continue;
      }

      if (this.inQuotes && this.pendingQuote) {
        this.pendingQuote = false;
        if (character === '"') {
          this.field += '"';
          continue;
        }
        this.inQuotes = false;
        this.afterQuote = true;
      }

      if (this.inQuotes) {
        if (character !== '"') {
          this.field += character;
          continue;
        }
        if (index === text.length - 1) {
          this.pendingQuote = true;
          continue;
        }
        if (text[index + 1] === '"') {
          this.field += '"';
          index++;
          continue;
        }
        this.inQuotes = false;
        this.afterQuote = true;
        continue;
      }

      if (this.afterQuote) {
        if (character === ",") {
          this.finishField();
          continue;
        }
        if (character === "\n" || character === "\r") {
          this.finishRecord();
          if (character === "\r") {
            if (text[index + 1] === "\n") index++;
            else if (index === text.length - 1) this.pendingCr = true;
          }
          continue;
        }
        throw new Error(
          "Malformed CSV: expected a comma or line ending after a closing quote.",
        );
      }

      if (character === '"') {
        if (!this.atFieldStart) {
          throw new Error("Malformed CSV: quote inside an unquoted field.");
        }
        this.inQuotes = true;
        this.rowHasSyntax = true;
        continue;
      }
      if (character === ",") {
        this.rowHasSyntax = true;
        this.finishField();
        continue;
      }
      if (character === "\n" || character === "\r") {
        this.finishRecord();
        if (character === "\r") {
          if (text[index + 1] === "\n") index++;
          else if (index === text.length - 1) this.pendingCr = true;
        }
        continue;
      }

      this.field += character;
      this.atFieldStart = false;
      this.rowHasSyntax = true;
    }

    return this.takeRecords();
  }

  finish(): CsvRecord[] {
    if (this.pendingQuote) {
      this.pendingQuote = false;
      this.inQuotes = false;
      this.afterQuote = true;
    }
    if (this.inQuotes) {
      throw new Error("Malformed CSV: unterminated quoted field.");
    }
    if (
      this.afterQuote ||
      this.rowHasSyntax ||
      this.field !== "" ||
      this.row.length > 0
    ) {
      this.finishRecord();
    }
    return this.takeRecords();
  }

  private finishField(): void {
    this.row.push(this.field);
    this.field = "";
    this.afterQuote = false;
    this.atFieldStart = true;
  }

  private finishRecord(): void {
    const blank =
      !this.rowHasSyntax && this.field === "" && this.row.length === 0;
    this.finishField();
    this.records.push({ cells: this.row, blank });
    this.row = [];
    this.rowHasSyntax = false;
  }

  private takeRecords(): CsvRecord[] {
    return this.records.splice(0);
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function validateCsvHeader(header: string[]): void {
  const seen = new Set<string>();
  for (const name of header) {
    if (name.trim() === "") {
      throw new Error("The CSV header contains an empty column name.");
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate column in the CSV header: "${name}".`);
    }
    seen.add(name);
  }
}

function csvRecordToRow(
  record: CsvRecord,
  header: string[],
  rowNumber: number,
): unknown[] {
  if (record.cells.length > header.length) {
    throw new Error(
      `Row ${String(rowNumber)} has ${String(record.cells.length)} values but the header declares ${String(header.length)} columns.`,
    );
  }
  return header.map((_, columnIndex) => {
    const cell = record.cells[columnIndex];
    return cell === undefined || cell === "" ? null : cell;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function coerceJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (isLosslessNumber(value)) return value.toString();
  if (typeof value === "object") return stringifyLosslessJson(value);
  return value;
}

export function computeBatchSize(columnCount: number): number {
  if (columnCount <= 0) return MAX_ROWS_PER_BATCH;
  return Math.max(
    1,
    Math.min(MAX_ROWS_PER_BATCH, Math.floor(MAX_BIND_PARAMS / columnCount)),
  );
}

export function buildInsertBatchSql(
  qualifiedTable: string,
  columns: string[],
  rowCount: number,
): string {
  const columnList = columns.map(quoteIdent).join(", ");
  let parameter = 0;
  const tuples: string[] = [];
  for (let row = 0; row < rowCount; row++) {
    tuples.push(`(${columns.map(() => `$${++parameter}`).join(", ")})`);
  }
  return `INSERT INTO ${qualifiedTable} (${columnList}) VALUES ${tuples.join(", ")}`;
}

async function* streamCsvRecords(filePath: string): AsyncGenerator<CsvRecord> {
  const parserInstance = new CsvRecordParser();
  let firstChunk = true;
  const input = fs.createReadStream(filePath, { encoding: "utf-8" });
  for await (const rawChunk of input) {
    const chunk = firstChunk ? stripBom(rawChunk) : rawChunk;
    firstChunk = false;
    for (const record of parserInstance.feed(chunk)) yield record;
  }
  for (const record of parserInstance.finish()) yield record;
}

async function firstJsonCharacter(filePath: string): Promise<string | null> {
  const input = fs.createReadStream(filePath, {
    encoding: "utf-8",
    highWaterMark: 4_096,
  });
  for await (const rawChunk of input) {
    const chunk = stripBom(rawChunk);
    const match = /\S/.exec(chunk);
    if (match) {
      input.destroy();
      return match[0]!;
    }
  }
  return null;
}

function preserveJsonNumbers(): Transform {
  return new Transform({
    objectMode: true,
    transform(token: { name: string; value?: string }, _encoding, callback) {
      if (token.name === "numberValue") {
        callback(null, {
          name: "stringValue",
          value: new LosslessNumber(token.value!),
        });
        return;
      }
      callback(null, token);
    },
  });
}

async function* streamJsonObjects(
  filePath: string,
): AsyncGenerator<Record<string, unknown>> {
  const firstCharacter = await firstJsonCharacter(filePath);
  if (firstCharacter === null) throw new Error("The JSON file is empty.");
  if (firstCharacter !== "[" && firstCharacter !== "{") {
    throw new Error(
      "JSON import expects an array of objects (one object per row).",
    );
  }

  const source = fs.createReadStream(filePath);
  const jsonParser = parser.asStream();
  const exactNumbers = preserveJsonNumbers();
  const streamer =
    firstCharacter === "[" ? streamArray.asStream() : streamValues.asStream();
  const completion = pipeline(source, jsonParser, exactNumbers, streamer);
  let valueCount = 0;

  try {
    for await (const item of streamer as AsyncIterable<{ value: unknown }>) {
      valueCount++;
      if (!isPlainObject(item.value)) {
        throw new Error(
          "JSON import expects an array of objects (one object per row).",
        );
      }
      yield item.value;
    }
    await completion;
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("JSON import expects")) throw error;
    throw new Error(`Invalid JSON: ${message}`);
  } finally {
    // A database error closes this generator while it is suspended at `yield`.
    // Explicitly dispose and observe the pipeline so its abort cannot become an
    // unhandled rejection in the Electron main process.
    source.destroy();
    jsonParser.destroy();
    exactNumbers.destroy();
    streamer.destroy();
    await completion.catch(() => undefined);
  }

  if (firstCharacter === "{" && valueCount !== 1) {
    throw new Error("JSON import expects one object or an array of objects.");
  }
}

async function collectJsonColumns(filePath: string): Promise<string[]> {
  const columns: string[] = [];
  const seen = new Set<string>();
  for await (const item of streamJsonObjects(filePath)) {
    for (const key of Object.keys(item)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

async function* streamJsonRows(
  filePath: string,
  columns: string[],
): AsyncGenerator<unknown[]> {
  for await (const item of streamJsonObjects(filePath)) {
    yield columns.map((column) =>
      Object.prototype.hasOwnProperty.call(item, column)
        ? coerceJsonValue(item[column])
        : null,
    );
  }
}

async function readCsvHeader(
  records: AsyncIterator<CsvRecord>,
): Promise<{ columns: string[]; nextRowNumber: number }> {
  let rowNumber = 0;
  while (true) {
    const next = await records.next();
    if (next.done)
      throw new Error("The CSV file is empty — expected a header row.");
    rowNumber++;
    if (next.value.blank) continue;
    validateCsvHeader(next.value.cells);
    return { columns: next.value.cells, nextRowNumber: rowNumber + 1 };
  }
}

async function* streamCsvRows(
  records: AsyncIterator<CsvRecord>,
  columns: string[],
  firstRowNumber: number,
): AsyncGenerator<unknown[]> {
  let rowNumber = firstRowNumber;
  while (true) {
    const next = await records.next();
    if (next.done) return;
    if (!next.value.blank) {
      yield csvRecordToRow(next.value, columns, rowNumber);
    }
    rowNumber++;
  }
}

export async function importData(
  params: ImportDataParams,
  sender: WebContents,
): Promise<ImportResult> {
  if (getSettings().general.readOnlyMode) {
    throw new Error("Cannot import data: read-only mode is enabled.");
  }

  let columns: string[];
  let rows: AsyncIterable<unknown[]>;
  if (params.format === "csv") {
    const records = streamCsvRecords(params.filePath)[Symbol.asyncIterator]();
    const header = await readCsvHeader(records);
    columns = header.columns;
    rows = streamCsvRows(records, columns, header.nextRowNumber);
  } else {
    columns = await collectJsonColumns(params.filePath);
    rows = streamJsonRows(params.filePath, columns);
  }

  if (columns.length === 0)
    throw new Error("No columns were found in the file.");
  const batchSize = computeBatchSize(columns.length);

  return withPoolClient(params.connectionId, async (client) => {
    const qualifiedTable = `${quoteIdent(params.schema)}.${quoteIdent(params.table)}`;
    const progress = createProgressThrottle(
      sender,
      200,
      TableDataChannels.IMPORT_PROGRESS,
      (insertedCount) => ({ operationId: params.operationId, insertedCount }),
    );
    let inserted = 0;
    let batch: unknown[][] = [];

    await client.query("BEGIN");
    try {
      for await (const row of rows) {
        batch.push(row);
        if (batch.length < batchSize) continue;
        inserted += await insertBatch(client, qualifiedTable, columns, batch);
        batch = [];
        progress.send(inserted);
      }
      if (batch.length > 0) {
        inserted += await insertBatch(client, qualifiedTable, columns, batch);
        progress.send(inserted);
      }
      await client.query("COMMIT");
      progress.flush(inserted);
      return { insertedCount: inserted };
    } catch (error) {
      progress.cancel();
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

async function insertBatch(
  client: {
    query: (
      sql: string,
      values?: unknown[],
    ) => Promise<{ rowCount: number | null }>;
  },
  qualifiedTable: string,
  columns: string[],
  batch: unknown[][],
): Promise<number> {
  const sql = buildInsertBatchSql(qualifiedTable, columns, batch.length);
  const result = await client.query(sql, batch.flat());
  return result.rowCount ?? batch.length;
}
