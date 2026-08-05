import { app, type WebContents } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { DbSyncChannels } from "../shared/constants/ipc-channels";
import type {
  BackupFileInfo,
  DbSyncBackupInput,
  DbSyncEndpoint,
  DbSyncLogLevel,
  DbSyncResult,
  DbSyncRestoreInput,
  DbSyncRunInput,
} from "../shared/types/db-sync";
import { getConnectionById } from "./connection-store";
import {
  buildPgConfig,
  buildPgSslConfig,
  extendedQuery,
  quoteIdent,
  withPoolClient,
} from "./pg-utils";
import { registerIpcHandler } from "./ipc-security";
import { logAudit } from "./audit-store";
import { getProdGuardState, setProdGuardEnabled } from "./db-sync-prod-guard";
import {
  validateDbSyncBackupInput,
  validateDbSyncCancelInput,
  validateDbSyncListDatabasesInput,
  validateDbSyncRestoreInput,
  validateDbSyncRunInput,
  validateDbSyncSetProdGuardInput,
} from "./ipc-validation";

// ---------------------------------------------------------------------------
// Connection helpers (mirrors roles-ipc.ts's private runInDatabase, which
// isn't exported — each ipc module owns its own copy of this small helper).
// ---------------------------------------------------------------------------

function buildPgConfigForDatabase(
  connectionId: string,
  database: string,
): Record<string, unknown> {
  const connection = getConnectionById(connectionId);
  if (!connection) throw new Error("Connection not found.");

  const baseConfig = buildPgConfig(connection);
  if (typeof baseConfig.connectionString === "string") {
    const url = new URL(baseConfig.connectionString);
    url.pathname = `/${database}`;
    return { ...baseConfig, connectionString: url.toString() };
  }

  return { ...baseConfig, database };
}

async function runInDatabase<T>(
  connectionId: string,
  database: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(buildPgConfigForDatabase(connectionId, database));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function resolveConnectionLabel(connectionId: string): string {
  return getConnectionById(connectionId)?.label ?? connectionId;
}

async function resolveActorSafe(connectionId: string): Promise<string> {
  try {
    return await withPoolClient(connectionId, async (client) => {
      const result = await client.query<{ rolname: string }>(
        "SELECT current_user AS rolname",
      );
      return result.rows[0]?.rolname ?? "unknown";
    });
  } catch {
    return "unknown";
  }
}

function qualifiedTable(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

// ---------------------------------------------------------------------------
// listDatabases
// ---------------------------------------------------------------------------

export async function listDatabases(connectionId: string): Promise<string[]> {
  return withPoolClient(connectionId, async (client) => {
    const result = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database
       WHERE datistemplate = false AND datallowconn = true
       ORDER BY datname`,
    );
    return result.rows.map((row) => row.datname);
  });
}

// ---------------------------------------------------------------------------
// Progress + cancellation
// ---------------------------------------------------------------------------

interface ActiveRun {
  cancelled: boolean;
  child?: ChildProcess;
}

const activeRuns = new Map<string, ActiveRun>();

function emit(
  sender: WebContents,
  runId: string,
  line: string,
  level: DbSyncLogLevel = "info",
): void {
  sender.send(DbSyncChannels.PROGRESS, { runId, line, level });
}

export function cancelSync(runId: string): void {
  const active = activeRuns.get(runId);
  if (!active) return;
  active.cancelled = true;
  active.child?.kill();
}

// ---------------------------------------------------------------------------
// Mode 1: Full Override (pg_dump / pg_restore subprocesses)
// ---------------------------------------------------------------------------

const FATAL_ERROR_PATTERN =
  /FATAL|could not connect|password authentication failed|connection to server/i;

interface DumpTarget {
  /** --host/--port/--username args, empty when using a full connection URI. */
  connArgs: string[];
  /** Either a bare database name (fields mode) or a full connection URI. */
  dbnameArg: string;
  env: Record<string, string>;
  cleanup: () => Promise<void>;
}

async function resolveDumpTarget(endpoint: DbSyncEndpoint): Promise<DumpTarget> {
  const connection = getConnectionById(endpoint.connectionId);
  if (!connection) throw new Error("Connection not found.");
  if (connection.ssh?.enabled) {
    throw new Error(
      `"${connection.label}" uses an SSH tunnel, which Database Sync does not support.`,
    );
  }

  if (connection.mode === "uri" && connection.uri) {
    const url = new URL(connection.uri);
    url.pathname = `/${endpoint.database}`;
    return {
      connArgs: [],
      dbnameArg: url.toString(),
      env: {},
      cleanup: async () => undefined,
    };
  }

  const fields = connection.fields;
  if (!fields) {
    throw new Error('Connection fields are required when mode is "fields".');
  }

  const env: Record<string, string> = { PGPASSWORD: fields.password };
  const cleanups: Array<() => Promise<void>> = [];

  if (connection.ssl?.enabled) {
    const ssl = buildPgSslConfig(connection) as {
      rejectUnauthorized?: boolean;
      ca?: string;
      cert?: string;
      key?: string;
    };
    env.PGSSLMODE = ssl.rejectUnauthorized === false ? "require" : "verify-ca";

    const writePem = async (content: string, label: string): Promise<string> => {
      const filePath = path.join(
        os.tmpdir(),
        `db-sync-${label}-${randomUUID()}.pem`,
      );
      await fsp.writeFile(filePath, content, "utf8");
      cleanups.push(() => fsp.unlink(filePath).catch(() => undefined));
      return filePath;
    };

    if (ssl.ca) env.PGSSLROOTCERT = await writePem(ssl.ca, "ca");
    if (ssl.cert) env.PGSSLCERT = await writePem(ssl.cert, "cert");
    if (ssl.key) env.PGSSLKEY = await writePem(ssl.key, "key");
  }

  return {
    connArgs: ["--host", fields.host, "--port", String(fields.port), "--username", fields.user],
    dbnameArg: endpoint.database,
    env,
    cleanup: async () => {
      for (const fn of cleanups) await fn();
    },
  };
}

interface ProcessResult {
  code: number;
  stderr: string;
  error?: string;
}

function runProcess(
  cmd: string,
  args: string[],
  extraEnv: Record<string, string>,
  onLine: (line: string) => void,
  active: ActiveRun,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...extraEnv },
      shell: false,
    });
    active.child = child;
    let stderrBuf = "";

    const handleChunk = (chunk: Buffer) => {
      for (const line of chunk.toString("utf-8").split("\n")) {
        if (line.trim()) onLine(line);
      }
    };
    child.stdout?.on("data", handleChunk);
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf-8");
      handleChunk(chunk);
    });
    child.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      const message =
        code === "ENOENT"
          ? `${cmd} not found. Install the PostgreSQL client tools (pg_dump/pg_restore) and ensure they're on your PATH.`
          : err.message;
      resolve({ code: -1, stderr: stderrBuf, error: message });
    });
    child.on("close", (code) => resolve({ code: code ?? -1, stderr: stderrBuf }));
  });
}

/** Restores `backupFilePath` into `target`. Throws on a fatal pg_restore failure. */
async function runRestoreProcess(
  backupFilePath: string,
  target: DumpTarget,
  runId: string,
  sender: WebContents,
  active: ActiveRun,
): Promise<void> {
  const restoreArgs = [
    "--no-owner",
    "--no-acl",
    "--clean",
    "--if-exists",
    "--single-transaction",
    ...target.connArgs,
    "--dbname",
    target.dbnameArg,
    backupFilePath,
  ];
  const restoreRun = await runProcess(
    "pg_restore",
    restoreArgs,
    target.env,
    (line) => emit(sender, runId, line),
    active,
  );
  if (active.cancelled) return;
  if (restoreRun.code !== 0) {
    const isFatal =
      restoreRun.code > 1 || FATAL_ERROR_PATTERN.test(restoreRun.stderr);
    if (isFatal) {
      throw new Error(
        restoreRun.error ||
          restoreRun.stderr.trim().slice(0, 500) ||
          `pg_restore exited with code ${restoreRun.code}`,
      );
    }
    emit(
      sender,
      runId,
      `pg_restore exited with warnings (code ${restoreRun.code}) — likely harmless "already exists" notices.`,
      "warn",
    );
  }
}

async function runFullOverride(
  input: DbSyncRunInput,
  sender: WebContents,
  active: ActiveRun,
): Promise<DbSyncResult> {
  const dumpFilePath = path.join(os.tmpdir(), `db-sync-${input.runId}.dump`);
  const source = await resolveDumpTarget(input.source);
  const target = await resolveDumpTarget(input.target);

  try {
    emit(sender, input.runId, `Dumping "${input.source.database}"...`);
    const dumpArgs = [
      "--no-owner",
      "--no-acl",
      "-Fc",
      `--file=${dumpFilePath}`,
      ...source.connArgs,
      "--dbname",
      source.dbnameArg,
    ];
    const dumpRun = await runProcess(
      "pg_dump",
      dumpArgs,
      source.env,
      (line) => emit(sender, input.runId, line),
      active,
    );
    if (active.cancelled) return { status: "cancelled" };
    if (dumpRun.code !== 0) {
      throw new Error(dumpRun.error ?? `pg_dump exited with code ${dumpRun.code}`);
    }

    emit(
      sender,
      input.runId,
      `Restoring into "${input.target.database}" (existing data will be replaced)...`,
    );
    await runRestoreProcess(dumpFilePath, target, input.runId, sender, active);
    if (active.cancelled) return { status: "cancelled" };

    emit(sender, input.runId, "Full override complete.");
    return { status: "ok" };
  } finally {
    await fsp.unlink(dumpFilePath).catch(() => undefined);
    await source.cleanup();
    await target.cleanup();
  }
}

function backupsDir(): string {
  return path.join(app.getPath("userData"), "backups");
}

/** Dumps `endpoint` to a timestamped file. Throws (aborting the caller) on failure. */
async function backupDatabase(
  endpoint: DbSyncEndpoint,
  runId: string,
  sender: WebContents,
  active: ActiveRun,
): Promise<string> {
  const dir = backupsDir();
  await fsp.mkdir(dir, { recursive: true });
  const label = resolveConnectionLabel(endpoint.connectionId).replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const backupPath = path.join(dir, `${label}-${endpoint.database}-${stamp}.dump`);

  const dumpTarget = await resolveDumpTarget(endpoint);
  try {
    emit(sender, runId, `Backing up "${endpoint.database}" to ${backupPath}...`);
    const dumpRun = await runProcess(
      "pg_dump",
      [
        "--no-owner",
        "--no-acl",
        "-Fc",
        `--file=${backupPath}`,
        ...dumpTarget.connArgs,
        "--dbname",
        dumpTarget.dbnameArg,
      ],
      dumpTarget.env,
      (line) => emit(sender, runId, line),
      active,
    );
    if (dumpRun.code !== 0) {
      throw new Error(dumpRun.error ?? `pg_dump exited with code ${dumpRun.code}`);
    }
    emit(sender, runId, `Backup saved to ${backupPath}.`);
    return backupPath;
  } catch (err) {
    await fsp.unlink(backupPath).catch(() => undefined);
    throw new Error(`Backup failed: ${(err as Error).message}`);
  } finally {
    await dumpTarget.cleanup();
  }
}

async function listBackups(): Promise<BackupFileInfo[]> {
  const dir = backupsDir();
  await fsp.mkdir(dir, { recursive: true });
  const entries = await fsp.readdir(dir);
  const infos = await Promise.all(
    entries
      .filter((name) => name.endsWith(".dump"))
      .map(async (fileName) => {
        const filePath = path.join(dir, fileName);
        const stat = await fsp.stat(filePath);
        return {
          path: filePath,
          fileName,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
        };
      }),
  );
  return infos.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function runBackup(
  input: DbSyncBackupInput,
  sender: WebContents,
): Promise<DbSyncResult> {
  if (activeRuns.has(input.runId)) {
    throw new Error("A backup with this identifier is already running.");
  }

  const active: ActiveRun = { cancelled: false };
  activeRuns.set(input.runId, active);
  const sourceLabel = resolveConnectionLabel(input.source.connectionId);

  let result: DbSyncResult;
  try {
    const backupPath = await backupDatabase(input.source, input.runId, sender, active);
    result = active.cancelled ? { status: "cancelled" } : { status: "ok", backupPath };
  } catch (err) {
    result = { status: "error", message: (err as Error).message };
  } finally {
    activeRuns.delete(input.runId);
  }

  logAudit({
    connectionId: input.source.connectionId,
    connectionLabel: sourceLabel,
    actor: await resolveActorSafe(input.source.connectionId),
    action: "db-sync-backup",
    target: `${sourceLabel}:${input.source.database}`,
    success: result.status === "ok",
    error: result.status === "error" ? result.message : undefined,
  });

  return result;
}

async function restoreDatabase(
  input: DbSyncRestoreInput,
  sender: WebContents,
): Promise<DbSyncResult> {
  if (activeRuns.has(input.runId)) {
    throw new Error("A restore with this identifier is already running.");
  }

  const active: ActiveRun = { cancelled: false };
  activeRuns.set(input.runId, active);
  const targetLabel = resolveConnectionLabel(input.target.connectionId);
  const targetDesc = `${input.backupPath} -> ${targetLabel}:${input.target.database}`;

  let result: DbSyncResult;
  try {
    await fsp.access(input.backupPath).catch(() => {
      throw new Error(`Backup file not found: ${input.backupPath}`);
    });

    let backupPath: string | undefined;
    if (input.backupTarget) {
      backupPath = await backupDatabase(input.target, input.runId, sender, active);
    }

    if (active.cancelled) {
      result = { status: "cancelled" };
    } else {
      const target = await resolveDumpTarget(input.target);
      try {
        emit(
          sender,
          input.runId,
          `Restoring into "${input.target.database}" (existing data will be replaced)...`,
        );
        await runRestoreProcess(input.backupPath, target, input.runId, sender, active);
      } finally {
        await target.cleanup();
      }
      result = active.cancelled ? { status: "cancelled" } : { status: "ok" };
      if (backupPath && result.status === "ok") result.backupPath = backupPath;
      if (result.status === "ok") {
        emit(sender, input.runId, "Restore complete.");
      }
    }
  } catch (err) {
    result = { status: "error", message: (err as Error).message };
  } finally {
    activeRuns.delete(input.runId);
  }

  logAudit({
    connectionId: input.target.connectionId,
    connectionLabel: targetLabel,
    actor: await resolveActorSafe(input.target.connectionId),
    action: "db-sync-restore",
    target: targetDesc,
    success: result.status === "ok",
    error: result.status === "error" ? result.message : undefined,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Mode 2: Row Sync (pure `pg` driver — insert/update/delete by primary key)
// ---------------------------------------------------------------------------

interface TableKey {
  schema: string;
  table: string;
}

interface TablePlan extends TableKey {
  key: string;
  columns: string[];
  pk: string[];
}

interface FkEdge {
  parent: string;
  child: string;
}

async function discoverTables(client: Client): Promise<Map<string, TableKey>> {
  const result = await client.query<{ schema_name: string; table_name: string }>(`
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND n.nspname NOT LIKE 'pg_temp%'
  `);
  const map = new Map<string, TableKey>();
  for (const row of result.rows) {
    map.set(`${row.schema_name}.${row.table_name}`, {
      schema: row.schema_name,
      table: row.table_name,
    });
  }
  return map;
}

async function fetchPrimaryKey(
  client: Client,
  schema: string,
  table: string,
): Promise<string[]> {
  const result = await client.query<{ attname: string }>(
    `
    SELECT a.attname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'p' AND n.nspname = $1 AND t.relname = $2
    ORDER BY array_position(c.conkey, a.attnum)
  `,
    [schema, table],
  );
  return result.rows.map((row) => row.attname);
}

async function fetchColumns(
  client: Client,
  schema: string,
  table: string,
): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table],
  );
  return result.rows.map((row) => row.column_name);
}

async function fetchForeignKeyEdges(
  client: Client,
  relevantKeys: Set<string>,
): Promise<FkEdge[]> {
  const result = await client.query<{
    child_schema: string;
    child_table: string;
    parent_schema: string;
    parent_table: string;
  }>(`
    SELECT
      cn.nspname AS child_schema, c.relname AS child_table,
      pn.nspname AS parent_schema, p.relname AS parent_table
    FROM pg_constraint fk
    JOIN pg_class c ON c.oid = fk.conrelid
    JOIN pg_namespace cn ON cn.oid = c.relnamespace
    JOIN pg_class p ON p.oid = fk.confrelid
    JOIN pg_namespace pn ON pn.oid = p.relnamespace
    WHERE fk.contype = 'f'
  `);
  const edges: FkEdge[] = [];
  for (const row of result.rows) {
    const parent = `${row.parent_schema}.${row.parent_table}`;
    const child = `${row.child_schema}.${row.child_table}`;
    if (relevantKeys.has(parent) && relevantKeys.has(child) && parent !== child) {
      edges.push({ parent, child });
    }
  }
  return edges;
}

/** Kahn's algorithm; leftover nodes on a cycle are appended in a stable order. */
function topoOrderTables(
  keys: string[],
  edges: FkEdge[],
): { order: string[]; hasCycle: boolean } {
  const inDegree = new Map<string, number>(keys.map((k) => [k, 0]));
  const children = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const { parent, child } of edges) {
    children.get(parent)?.push(child);
    inDegree.set(child, (inDegree.get(child) ?? 0) + 1);
  }

  const queue = keys.filter((k) => inDegree.get(k) === 0).sort();
  const order: string[] = [];
  while (queue.length > 0) {
    const key = queue.shift()!;
    order.push(key);
    for (const child of children.get(key) ?? []) {
      const next = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, next);
      if (next === 0) {
        queue.push(child);
        queue.sort();
      }
    }
  }

  const hasCycle = order.length < keys.length;
  if (hasCycle) {
    const remaining = keys.filter((k) => !order.includes(k)).sort();
    order.push(...remaining);
  }
  return { order, hasCycle };
}

function buildValuesPlaceholders(rowCount: number, colCount: number): string {
  const groups: string[] = [];
  let paramIndex = 1;
  for (let r = 0; r < rowCount; r++) {
    const placeholders: string[] = [];
    for (let c = 0; c < colCount; c++) {
      placeholders.push(`$${paramIndex}`);
      paramIndex += 1;
    }
    groups.push(`(${placeholders.join(", ")})`);
  }
  return groups.join(", ");
}

function buildUpsertSql(
  qualified: string,
  colsQuoted: string[],
  nonPkColsQuoted: string[],
  pkQuoted: string[],
  rowCount: number,
): string {
  const insert = `INSERT INTO ${qualified} AS t (${colsQuoted.join(", ")}) VALUES ${buildValuesPlaceholders(rowCount, colsQuoted.length)}`;
  if (nonPkColsQuoted.length === 0) {
    return `${insert} ON CONFLICT (${pkQuoted.join(", ")}) DO NOTHING`;
  }
  const setClause = nonPkColsQuoted.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  const targetTuple = `(${nonPkColsQuoted.map((c) => `t.${c}`).join(", ")})`;
  const excludedTuple = `(${nonPkColsQuoted.map((c) => `EXCLUDED.${c}`).join(", ")})`;
  return `${insert} ON CONFLICT (${pkQuoted.join(", ")}) DO UPDATE SET ${setClause} WHERE ${targetTuple} IS DISTINCT FROM ${excludedTuple}`;
}

const BATCH_SIZE = 500;

async function syncTablePhaseA(
  sourceClient: Client,
  targetClient: Client,
  plan: TablePlan,
  active: ActiveRun,
): Promise<{ tempName: string; upserted: number }> {
  const qualified = qualifiedTable(plan.schema, plan.table);
  const colsQuoted = plan.columns.map(quoteIdent);
  const pkQuoted = plan.pk.map(quoteIdent);
  const nonPkColsQuoted = plan.columns
    .filter((c) => !plan.pk.includes(c))
    .map(quoteIdent);
  const tempName = `_dbsync_keep_${randomUUID().replaceAll("-", "")}`;

  await targetClient.query(
    `CREATE TEMP TABLE "${tempName}" AS SELECT ${pkQuoted.join(", ")} FROM ${qualified} WHERE false`,
  );
  await targetClient.query(
    `CREATE INDEX ON "${tempName}" (${pkQuoted.join(", ")})`,
  );

  const cursorName = "_dbsync_cursor";
  await sourceClient.query("BEGIN READ ONLY");
  let upserted = 0;
  try {
    await sourceClient.query(
      extendedQuery(
        `DECLARE ${cursorName} CURSOR FOR SELECT ${colsQuoted.join(", ")} FROM ${qualified}`,
      ),
    );

    while (!active.cancelled) {
      const batch = await sourceClient.query<Record<string, unknown>>(
        `FETCH ${BATCH_SIZE} FROM ${cursorName}`,
      );
      if (batch.rows.length === 0) break;

      const upsertResult = await targetClient.query(
        buildUpsertSql(qualified, colsQuoted, nonPkColsQuoted, pkQuoted, batch.rows.length),
        batch.rows.flatMap((row) => plan.columns.map((c) => row[c])),
      );
      upserted += upsertResult.rowCount ?? 0;

      await targetClient.query(
        `INSERT INTO "${tempName}" (${pkQuoted.join(", ")}) VALUES ${buildValuesPlaceholders(batch.rows.length, plan.pk.length)}`,
        batch.rows.flatMap((row) => plan.pk.map((c) => row[c])),
      );
    }

    await sourceClient.query(`CLOSE ${cursorName}`);
    await sourceClient.query("COMMIT");
  } catch (err) {
    await sourceClient.query("ROLLBACK").catch(() => undefined);
    throw err;
  }

  return { tempName, upserted };
}

async function deleteMissingRows(
  targetClient: Client,
  plan: TablePlan,
  tempName: string,
): Promise<number> {
  const qualified = qualifiedTable(plan.schema, plan.table);
  const pkQuoted = plan.pk.map(quoteIdent);
  const targetTuple = `(${pkQuoted.map((c) => `t.${c}`).join(", ")})`;
  const keepTuple = `(${pkQuoted.map((c) => `k.${c}`).join(", ")})`;
  const result = await targetClient.query(
    `DELETE FROM ${qualified} AS t WHERE NOT EXISTS (SELECT 1 FROM "${tempName}" AS k WHERE ${keepTuple} = ${targetTuple})`,
  );
  return result.rowCount ?? 0;
}

async function runRowSync(
  input: DbSyncRunInput,
  sender: WebContents,
  active: ActiveRun,
): Promise<DbSyncResult> {
  const { runId } = input;

  return runInDatabase(input.source.connectionId, input.source.database, (sourceClient) =>
    runInDatabase(input.target.connectionId, input.target.database, async (targetClient) => {
      let bypassFk = false;
      try {
        await targetClient.query("SET session_replication_role = replica");
        bypassFk = true;
      } catch {
        emit(
          sender,
          runId,
          "Target role can't bypass triggers/foreign keys (not superuser) — falling back to dependency-ordered sync.",
          "warn",
        );
      }

      const sourceTables = await discoverTables(sourceClient);
      const targetTables = await discoverTables(targetClient);
      const commonKeys = [...sourceTables.keys()]
        .filter((k) => targetTables.has(k))
        .sort();

      for (const key of [...sourceTables.keys()].filter((k) => !targetTables.has(k))) {
        emit(sender, runId, `${key}: skipped — table does not exist on target.`, "warn");
      }
      for (const key of [...targetTables.keys()].filter((k) => !sourceTables.has(k))) {
        emit(sender, runId, `${key}: skipped — target-only table, left untouched.`, "warn");
      }

      if (commonKeys.length === 0) {
        emit(sender, runId, "No common tables to sync.", "warn");
        return { status: "ok" as const };
      }

      const plans: TablePlan[] = [];
      for (const key of commonKeys) {
        const { schema, table } = sourceTables.get(key)!;
        const [sourcePk, targetPk, sourceCols, targetCols] = await Promise.all([
          fetchPrimaryKey(sourceClient, schema, table),
          fetchPrimaryKey(targetClient, schema, table),
          fetchColumns(sourceClient, schema, table),
          fetchColumns(targetClient, schema, table),
        ]);
        if (sourcePk.length === 0 || targetPk.length === 0) {
          emit(sender, runId, `${key}: skipped — no primary key.`, "warn");
          continue;
        }
        if (sourcePk.join(",") !== targetPk.join(",")) {
          emit(
            sender,
            runId,
            `${key}: skipped — primary key columns differ between source and target.`,
            "warn",
          );
          continue;
        }
        const columns = sourceCols.filter((c) => targetCols.includes(c));
        if (columns.length === 0) {
          emit(sender, runId, `${key}: skipped — no columns in common.`, "warn");
          continue;
        }
        plans.push({ schema, table, key, columns, pk: sourcePk });
      }

      if (plans.length === 0) {
        emit(sender, runId, "No syncable tables (all skipped).", "warn");
        return { status: "ok" as const };
      }

      let order = plans.map((p) => p.key);
      if (!bypassFk) {
        const edges = await fetchForeignKeyEdges(targetClient, new Set(order));
        const topo = topoOrderTables(order, edges);
        order = topo.order;
        if (topo.hasCycle) {
          emit(
            sender,
            runId,
            "Circular foreign keys detected — using best-effort table order.",
            "warn",
          );
        }
      }
      const planByKey = new Map(plans.map((p) => [p.key, p]));

      const tempNames = new Map<string, string>();
      const skippedDelete = new Set<string>();

      for (const key of order) {
        if (active.cancelled) break;
        const plan = planByKey.get(key)!;
        try {
          const { tempName, upserted } = await syncTablePhaseA(
            sourceClient,
            targetClient,
            plan,
            active,
          );
          tempNames.set(key, tempName);
          emit(sender, runId, `${key}: ${upserted} row(s) synced.`);
        } catch (err) {
          skippedDelete.add(key);
          emit(sender, runId, `${key}: sync failed — ${(err as Error).message}`, "warn");
        }
      }

      for (const key of [...order].reverse()) {
        if (active.cancelled) break;
        if (skippedDelete.has(key)) {
          emit(sender, runId, `${key}: skipping delete pass (sync failed earlier).`, "warn");
          continue;
        }
        const plan = planByKey.get(key)!;
        const tempName = tempNames.get(key);
        if (!tempName) continue;
        try {
          const deleted = await deleteMissingRows(targetClient, plan, tempName);
          emit(sender, runId, `${key}: ${deleted} row(s) deleted.`);
        } catch (err) {
          emit(sender, runId, `${key}: delete pass failed — ${(err as Error).message}`, "warn");
        } finally {
          await targetClient.query(`DROP TABLE IF EXISTS "${tempName}"`).catch(() => undefined);
        }
      }

      if (active.cancelled) {
        return { status: "cancelled" as const };
      }
      emit(sender, runId, "Row sync complete.");
      return { status: "ok" as const };
    }),
  );
}

// ---------------------------------------------------------------------------
// Entry point + IPC registration
// ---------------------------------------------------------------------------

export async function runSync(
  input: DbSyncRunInput,
  sender: WebContents,
): Promise<DbSyncResult> {
  if (activeRuns.has(input.runId)) {
    throw new Error("A sync with this identifier is already running.");
  }
  if (
    input.source.connectionId === input.target.connectionId &&
    input.source.database === input.target.database
  ) {
    throw new Error("Source and target must be different databases.");
  }

  const active: ActiveRun = { cancelled: false };
  activeRuns.set(input.runId, active);

  const sourceLabel = resolveConnectionLabel(input.source.connectionId);
  const targetLabel = resolveConnectionLabel(input.target.connectionId);
  const targetDesc = `${sourceLabel}:${input.source.database} -> ${targetLabel}:${input.target.database}`;
  const action = input.mode === "full-override" ? "db-sync-full-override" : "db-sync-row-sync";

  let result: DbSyncResult;
  try {
    let backupPath: string | undefined;
    if (input.backupTarget) {
      backupPath = await backupDatabase(input.target, input.runId, sender, active);
    }
    if (active.cancelled) {
      result = { status: "cancelled" };
    } else {
      result =
        input.mode === "full-override"
          ? await runFullOverride(input, sender, active)
          : await runRowSync(input, sender, active);
      if (backupPath) result.backupPath = backupPath;
    }
  } catch (err) {
    result = { status: "error", message: (err as Error).message };
  } finally {
    activeRuns.delete(input.runId);
  }

  logAudit({
    connectionId: input.target.connectionId,
    connectionLabel: targetLabel,
    actor: await resolveActorSafe(input.target.connectionId),
    action,
    target: targetDesc,
    success: result.status === "ok",
    error: result.status === "error" ? result.message : undefined,
  });

  return result;
}

export function registerDbSyncHandlers(): void {
  registerIpcHandler(
    DbSyncChannels.LIST_DATABASES,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateDbSyncListDatabasesInput(rawInput);
        const data = await listDatabases(input.connectionId);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(DbSyncChannels.RUN, async (event, rawInput: unknown) => {
    try {
      const input = validateDbSyncRunInput(rawInput);
      const data = await runSync(input, event.sender);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  registerIpcHandler(DbSyncChannels.CANCEL, async (_event, rawInput: unknown) => {
    try {
      const input = validateDbSyncCancelInput(rawInput);
      cancelSync(input.runId);
      return { success: true, data: undefined };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  registerIpcHandler(DbSyncChannels.GET_PROD_GUARD, () => {
    try {
      return { success: true, data: getProdGuardState() };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  registerIpcHandler(
    DbSyncChannels.SET_PROD_GUARD,
    (_event, rawInput: unknown) => {
      try {
        const input = validateDbSyncSetProdGuardInput(rawInput);
        return { success: true, data: setProdGuardEnabled(input.enabled) };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(DbSyncChannels.LIST_BACKUPS, async () => {
    try {
      const data = await listBackups();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  registerIpcHandler(DbSyncChannels.BACKUP, async (event, rawInput: unknown) => {
    try {
      const input = validateDbSyncBackupInput(rawInput);
      const data = await runBackup(input, event.sender);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  registerIpcHandler(DbSyncChannels.RESTORE, async (event, rawInput: unknown) => {
    try {
      const input = validateDbSyncRestoreInput(rawInput);
      const data = await restoreDatabase(input, event.sender);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
