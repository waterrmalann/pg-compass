import { spawn, type ChildProcess } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ConnectionConfig } from "../shared/types/connection";
import { buildPgSslConfig } from "./pg-utils";

/** Connection details for one pg_dump / pg_restore invocation. */
export interface PgToolTarget {
  /**
   * `--dbname` value: a libpq URI or keyword/value conninfo string built here,
   * so a database name is always a quoted value and can never be reinterpreted
   * as connection options (libpq only expands the outermost dbname).
   */
  dbname: string;
  /** PGPASSWORD / PGSSL* variables; secrets never go on the command line. */
  env: Record<string, string>;
  /** Removes the private directory holding SSL PEM files, if any. */
  cleanup: () => Promise<void>;
}

interface SslSetup {
  env: Record<string, string>;
  cleanup: () => Promise<void>;
}

const NO_CLEANUP = async (): Promise<void> => undefined;

/** Quote a libpq keyword/value conninfo value: `'` and `\` are backslash-escaped. */
export function quoteConninfoValue(value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  return `'${escaped}'`;
}

/**
 * Mirrors buildPgConfig's SSL handling for libpq. node-pg verifies the
 * hostname whenever it verifies the certificate, so that maps to
 * `verify-full`; unverified maps to `require`. Without a custom CA, verifying
 * uses the system trust store (`sslrootcert=system`, libpq 16+) like node-pg
 * does. PEMs go into a private mkdtemp directory with owner-only files.
 */
export async function prepareSslEnv(
  connection: ConnectionConfig,
): Promise<SslSetup> {
  if (!connection.ssl?.enabled) {
    return { env: {}, cleanup: NO_CLEANUP };
  }

  const ssl = buildPgSslConfig(connection) as {
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
  const verify = ssl.rejectUnauthorized !== false;
  const env: Record<string, string> = {
    PGSSLMODE: verify ? "verify-full" : "require",
  };

  const pemFiles: Array<{ envKey: string; fileName: string; content: string }> =
    [];
  if (verify && ssl.ca) {
    pemFiles.push({
      envKey: "PGSSLROOTCERT",
      fileName: "root.crt",
      content: ssl.ca,
    });
  }
  if (verify && !ssl.ca) {
    env.PGSSLROOTCERT = "system";
  }
  if (ssl.cert) {
    pemFiles.push({
      envKey: "PGSSLCERT",
      fileName: "client.crt",
      content: ssl.cert,
    });
  }
  if (ssl.key) {
    pemFiles.push({
      envKey: "PGSSLKEY",
      fileName: "client.key",
      content: ssl.key,
    });
  }
  if (pemFiles.length === 0) {
    return { env, cleanup: NO_CLEANUP };
  }

  const pemDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pg-compass-ssl-"));
  const cleanup = () => fsp.rm(pemDir, { recursive: true, force: true });
  try {
    for (const pemFile of pemFiles) {
      const filePath = path.join(pemDir, pemFile.fileName);
      await fsp.writeFile(filePath, pemFile.content, { mode: 0o600 });
      env[pemFile.envKey] = filePath;
    }
  } catch (err) {
    await cleanup();
    throw err;
  }
  return { env, cleanup };
}

function buildUriDbname(
  uri: string,
  database: string,
  env: Record<string, string>,
): string {
  const url = new URL(uri);
  // libpq percent-decodes the whole path, so any database name round-trips.
  url.pathname = `/${encodeURIComponent(database)}`;
  url.searchParams.delete("dbname");
  // Keep the password out of the process arguments (visible to local users);
  // libpq falls back to PGPASSWORD. A `password` query parameter overrides
  // the userinfo one in libpq, so it wins here too.
  if (url.password) {
    env.PGPASSWORD = decodeURIComponent(url.password);
  }
  const queryPassword = url.searchParams.get("password");
  if (queryPassword !== null) {
    env.PGPASSWORD = queryPassword;
  }
  url.password = "";
  url.searchParams.delete("password");
  return url.toString();
}

/** Resolve how pg_dump / pg_restore / psql reach `database` on `connection`'s server. */
export async function resolvePgToolTarget(
  connection: ConnectionConfig,
  database: string,
): Promise<PgToolTarget> {
  if (connection.ssh?.enabled) {
    throw new Error(
      `"${connection.label}" uses an SSH tunnel, which the PostgreSQL client tools (backup, restore and the shell) do not support.`,
    );
  }

  const env: Record<string, string> = {};
  let dbname: string;
  if (connection.mode === "uri" && connection.uri) {
    dbname = buildUriDbname(connection.uri, database, env);
  } else {
    const fields = connection.fields;
    if (!fields) {
      throw new Error('Connection fields are required when mode is "fields".');
    }
    env.PGPASSWORD = fields.password;
    dbname = [
      `host=${quoteConninfoValue(fields.host)}`,
      `port=${quoteConninfoValue(String(fields.port))}`,
      `user=${quoteConninfoValue(fields.user)}`,
      `dbname=${quoteConninfoValue(database)}`,
    ].join(" ");
  }

  const ssl = await prepareSslEnv(connection);
  return { dbname, env: { ...env, ...ssl.env }, cleanup: ssl.cleanup };
}

export function buildPgDumpArgs(
  target: PgToolTarget,
  filePath: string,
): string[] {
  return [
    "--no-owner",
    "--no-acl",
    "--format=custom",
    `--file=${filePath}`,
    `--dbname=${target.dbname}`,
  ];
}

/** `--` ends option parsing so the positional file path is never an option. */
export function buildPgRestoreArgs(
  target: PgToolTarget,
  filePath: string,
): string[] {
  return [
    "--no-owner",
    "--no-acl",
    "--clean",
    "--if-exists",
    "--single-transaction",
    `--dbname=${target.dbname}`,
    "--",
    filePath,
  ];
}

export function buildPgRestoreListArgs(filePath: string): string[] {
  return ["--list", "--", filePath];
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

export interface ActiveRun {
  cancelled: boolean;
  child?: ChildProcess;
}

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  error?: string;
}

function describeSpawnError(command: string, err: Error): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    return `${command} not found. Install the PostgreSQL client tools (pg_dump/pg_restore) and ensure they're on your PATH.`;
  }
  return err.message;
}

/**
 * Spawns a PostgreSQL client tool without a shell. Output lines are streamed
 * to `onLine`; `active.child` lets a cancel request kill the process.
 */
export function runPgTool(
  command: "pg_dump" | "pg_restore",
  args: string[],
  env: Record<string, string>,
  onLine: (line: string) => void,
  active: ActiveRun,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    // A cancel can land while the caller was still preparing (resolving the
    // connection, writing PEM files); never start a destructive tool then.
    if (active.cancelled) {
      resolve({ code: -1, stdout: "", stderr: "" });
      return;
    }

    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      shell: false,
    });
    active.child = child;
    let stdout = "";
    let stderr = "";

    const emitLines = (chunk: Buffer) => {
      for (const line of chunk.toString("utf-8").split("\n")) {
        if (line.trim()) onLine(line);
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      emitLines(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
      emitLines(chunk);
    });
    child.on("error", (err) => {
      resolve({
        code: -1,
        stdout,
        stderr,
        error: describeSpawnError(command, err),
      });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
