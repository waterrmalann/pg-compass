import { type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { to as copyTo } from "pg-copy-streams";
import { TableDataChannels } from "../shared/constants/ipc-channels";
import type {
  ExportDataParams,
  ExportResult,
  SqlDumpParams,
} from "../shared/types/table-data";
import { extendedQuery, quoteIdent, withPoolClient } from "./pg-utils";
import { isReadOnlyQuery } from "./table-data-rows";
import type { CompiledDataQuery } from "./query-dsl/compile";
import { bindAndCompile, parseDataQueryOrThrow } from "./query-dsl/prepare";

function createTemporaryExportPath(filePath: string): string {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
}

// ---------------------------------------------------------------------------
// EXPORT_DATA (CSV / JSON)
// ---------------------------------------------------------------------------

/** Throttle progress IPC sends to avoid flooding the renderer. */
export function createProgressThrottle(
  sender: WebContents,
  intervalMs = 200,
  channel: string = TableDataChannels.EXPORT_PROGRESS,
  mapPayload: (rowCount: number) => unknown = (rowCount) => rowCount,
) {
  let lastSent = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;

  function sendToRenderer(rowCount: number): void {
    if (sender.isDestroyed?.()) return;
    try {
      sender.send(channel, mapPayload(rowCount));
    } catch {
      // Progress is best-effort and must never fail the database/file operation.
    }
  }

  function send(rowCount: number) {
    const now = Date.now();
    if (now - lastSent >= intervalMs) {
      lastSent = now;
      sendToRenderer(rowCount);
    } else {
      pending ??= setTimeout(
        () => {
          pending = null;
          lastSent = Date.now();
          sendToRenderer(rowCount);
        },
        intervalMs - (now - lastSent),
      );
    }
  }

  function flush(rowCount: number) {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    sendToRenderer(rowCount);
  }

  function cancel() {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
  }

  return { send, flush, cancel };
}

/** Convert a row to a CSV line, properly quoting values. */
export function csvEscapeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return csvQuoteField(JSON.stringify(value));
  if (typeof value === "symbol") return csvQuoteField(value.toString());
  return csvQuoteField(String(value as string | number | boolean | bigint));
}

export function csvQuoteField(str: string): string {
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

/** Build the SQL to run for the export (either a full table or a user query). */
export function buildExportSql(params: ExportDataParams): string {
  if (params.sql) {
    if (!isReadOnlyQuery(params.sql)) {
      throw new Error("Only SELECT statements are allowed for export.");
    }
    return params.sql.replace(/;\s*$/, "");
  }
  const qualifiedTable = `${quoteIdent(params.schema!)}.${quoteIdent(params.table!)}`;
  return `SELECT * FROM ${qualifiedTable}`;
}

/** `SELECT` for a compiled Data-tab query over a whole relation. */
export function buildRelationQuerySql(
  schema: string,
  table: string,
  compiled: CompiledDataQuery,
): string {
  const qualifiedTable = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  const whereFragment = compiled.whereSql ? ` WHERE ${compiled.whereSql}` : "";
  const orderByFragment = compiled.orderBySql
    ? ` ORDER BY ${compiled.orderBySql}`
    : "";
  return `SELECT ${compiled.selectListSql} FROM ${qualifiedTable}${whereFragment}${orderByFragment}`;
}

export async function exportData(
  params: ExportDataParams,
  sender: WebContents,
): Promise<ExportResult> {
  const { filePath } = params;
  const temporaryPath = createTemporaryExportPath(filePath);

  // Data-tab DSL is syntax-checked before any database work.
  const queryAst = params.query ? parseDataQueryOrThrow(params.query) : null;

  return withPoolClient(params.connectionId, async (client) => {
    const progress = createProgressThrottle(sender);

    // Stream all rows using a cursor to avoid loading everything into memory
    await client.query("BEGIN READ ONLY");
    try {
      let sql = buildExportSql(params);
      let values: unknown[] = [];
      if (queryAst) {
        // Same parser, binder and compiler as row loading, without
        // pagination, so the export matches the Data tab's active query.
        const { compiled } = await bindAndCompile(
          client,
          params.schema!,
          params.table!,
          queryAst,
        );
        sql = buildRelationQuerySql(params.schema!, params.table!, compiled);
        values = compiled.values;
      }

      const cursorName = "__export_cursor";
      await client.query({
        ...extendedQuery(`DECLARE ${cursorName} CURSOR FOR ${sql}`),
        values,
      });

      const writeStream = fs.createWriteStream(temporaryPath, {
        encoding: "utf-8",
      });
      let rowCount = 0;
      let columns: string[] | null = null;
      const batchSize = 1000;

      async function* generateExport(): AsyncGenerator<string> {
        if (params.format === "json") yield "[\n";

        while (true) {
          const batch = await client.query(
            `FETCH ${batchSize} FROM ${cursorName}`,
          );
          if (batch.rows.length === 0) break;

          columns ??= batch.fields.map((field) => field.name);
          if (params.format === "csv" && rowCount === 0) {
            yield columns.map(csvEscapeValue).join(",") + "\n";
          }

          for (const row of batch.rows) {
            if (params.format === "csv") {
              yield columns
                .map((column) => csvEscapeValue(row[column]))
                .join(",") + "\n";
            } else {
              const prefix = rowCount === 0 ? "  " : ",\n  ";
              yield prefix + JSON.stringify(row);
            }
            rowCount += 1;
          }
          progress.send(rowCount);
        }

        if (params.format === "json") {
          yield rowCount > 0 ? "\n]\n" : "]\n";
        }
      }

      await pipeline(Readable.from(generateExport()), writeStream);
      await client.query(`CLOSE ${cursorName}`);
      await client.query("COMMIT");
      progress.flush(rowCount);
      await fs.promises.rename(temporaryPath, filePath);

      return { filePath, rowCount };
    } catch (err) {
      progress.cancel();
      await client.query("ROLLBACK").catch(() => undefined);
      // Clean up partial file
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        /* ignore */
      }
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// SQL_DUMP (COPY TO STDOUT)
// ---------------------------------------------------------------------------

export async function sqlDump(
  params: SqlDumpParams,
  sender: WebContents,
): Promise<ExportResult> {
  const { filePath } = params;
  const temporaryPath = createTemporaryExportPath(filePath);
  const qualifiedTable = `${quoteIdent(params.schema)}.${quoteIdent(params.table)}`;

  return withPoolClient(params.connectionId, async (client) => {
    const fileStream = fs.createWriteStream(temporaryPath, {
      encoding: "utf-8",
    });
    const progress = createProgressThrottle(sender);

    const copyStream = client.query(
      copyTo(`COPY ${qualifiedTable} TO STDOUT WITH (FORMAT text)`),
    );

    let rowCount = 0;
    copyStream.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      const lines = text.split("\n").filter((l) => l.length > 0);
      rowCount += lines.length;
      progress.send(rowCount);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        copyStream.pipe(fileStream);
        fileStream.on("finish", () => {
          progress.flush(rowCount);
          resolve();
        });
        copyStream.on("error", (err) => {
          fileStream.destroy();
          reject(err);
        });
        fileStream.on("error", (err) => {
          copyStream.destroy();
          reject(err);
        });
      });
      await fs.promises.rename(temporaryPath, filePath);
    } catch (error) {
      progress.cancel();
      await fs.promises.unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

    return { filePath: path.resolve(filePath), rowCount };
  });
}
