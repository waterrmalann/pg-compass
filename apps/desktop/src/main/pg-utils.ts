import { Client, Pool } from "pg";
import type { PoolClient, QueryConfig } from "pg";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConnectionConfig } from "../shared/types/connection";
import { getConnectionById } from "./connection-store";

type ExtendedQueryConfig = QueryConfig & { queryMode: "extended" };

/**
 * Force PostgreSQL's extended protocol for SQL that contains a renderer-
 * authored fragment. Extended parsing rejects stacked statements.
 */
export function extendedQuery(text: string): ExtendedQueryConfig {
  return { text, queryMode: "extended" };
}

// ---------------------------------------------------------------------------
// Connection config
// ---------------------------------------------------------------------------

/** Build a pg connection config from a ConnectionConfig. */
export function buildPgConfig(connection: ConnectionConfig) {
  // The SSH tunnel option is validated, encrypted, and stored, but no tunnel
  // is actually established anywhere connections are made — refuse rather
  // than silently connecting directly to `fields.host`/`uri`, which would
  // give the user a false sense of their traffic being tunneled.
  if (connection.ssh?.enabled) {
    throw new Error(
      `"${connection.label}" has an SSH tunnel enabled, but SSH tunneling is not yet supported. Disable it on this connection to connect directly.`,
    );
  }

  const config: Record<string, unknown> =
    connection.mode === "uri" && connection.uri
      ? { connectionString: connection.uri }
      : buildFieldPgConfig(connection);

  if (connection.ssl?.enabled) {
    config.ssl = buildPgSslConfig(connection);
  }

  return config;
}

function buildFieldPgConfig(
  connection: ConnectionConfig,
): Record<string, unknown> {
  const fields = connection.fields;
  if (!fields)
    throw new Error('Connection fields are required when mode is "fields".');

  return {
    host: fields.host,
    port: fields.port,
    database: fields.database,
    user: fields.user,
    password: fields.password,
  };
}

/** Resolve a connection's SSL settings to actual PEM content (ca/cert/key). */
export function buildPgSslConfig(
  connection: ConnectionConfig,
): Record<string, unknown> {
  const ssl = connection.ssl;
  if (!ssl?.enabled) return {};

  return {
    rejectUnauthorized: ssl.rejectUnauthorized ?? true,
    ...(ssl.ca ? { ca: resolveSslCa(ssl.ca, ssl.caSource ?? "file") } : {}),
    ...(ssl.cert
      ? { cert: readConnectionFile(ssl.cert, "SSL client certificate") }
      : {}),
    ...(ssl.key ? { key: readConnectionFile(ssl.key, "SSL client key") } : {}),
  };
}

function resolveSslCa(value: string, source: "file" | "inline"): string {
  if (source === "file") {
    return readConnectionFile(value, "SSL CA certificate");
  }

  return normalizeInlineCa(value);
}

function normalizeInlineCa(value: string): string {
  const trimmed = value.trim();
  if (isPemCertificate(trimmed)) {
    return trimmed;
  }

  const compact = trimmed.replace(/\s+/g, "");
  if (!looksLikeBase64(compact)) {
    throw new Error(
      "Inline SSL CA must be PEM text or a base64-encoded PEM certificate.",
    );
  }

  const decoded = Buffer.from(compact, "base64").toString("utf8").trim();
  if (!isPemCertificate(decoded)) {
    throw new Error("Inline SSL CA must decode to a PEM certificate.");
  }

  return decoded;
}

function isPemCertificate(value: string): boolean {
  return value.startsWith("-----BEGIN CERTIFICATE-----");
}

function looksLikeBase64(value: string): boolean {
  if (!value || value.length % 4 === 1) return false;
  return value.startsWith("LS0t") && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

// Matches a Windows UNC path (`\\server\share\...`) or its POSIX-style
// double-slash alias (`//server/share/...`), but not a normal absolute path
// (`/etc/...`) or the `\\?\` local extended-length prefix. A bare
// `fs.readFileSync` on a UNC path makes the OS open an SMB connection to
// whatever host the string names — a known technique (forced NTLM
// authentication / SMB relay) for leaking or relaying the current user's
// Windows credentials to an attacker-controlled server, and on any OS it's
// an oracle for probing arbitrary network-reachable paths. SSL cert/key/CA
// paths are meant to name a local file, so network paths are rejected.
const UNC_PATH_PATTERN = /^\\\\[^?\\]|^\/\/[^/]/;

function readConnectionFile(filePath: string, label: string): string {
  const trimmed = filePath.trim();
  if (UNC_PATH_PATTERN.test(trimmed)) {
    throw new Error(
      `${label} path must be a local file path, not a network (UNC) path: "${filePath}".`,
    );
  }
  const resolvedPath = resolveUserPath(trimmed);
  try {
    return fs.readFileSync(resolvedPath, "utf8");
  } catch (err) {
    const message = (err as Error).message;
    throw new Error(
      `Could not read ${label} file at "${filePath}": ${message}`,
    );
  }
}

function resolveUserPath(filePath: string): string {
  if (filePath === "~") {
    return os.homedir();
  }

  if (filePath.startsWith(`~${path.sep}`) || filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

/** Quote a PostgreSQL identifier to prevent SQL injection. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Safely quote a string literal for DDL that can't accept a bound
 * parameter — PostgreSQL's grammar rejects `$1` in places like
 * `ALTER ROLE ... PASSWORD '...'` or `COMMENT ON ... IS '...'`, so these
 * values have to be embedded as a literal. Manual `'`-doubling is only a
 * correct escape when `standard_conforming_strings = on` (the default
 * since PG 9.1, but not guaranteed) — a value ending in a backslash on a
 * server with it `off` could swallow the closing quote and break out of
 * the literal. Asking the server to quote it via `quote_literal()` is
 * correct regardless of that setting, since it accounts for the server's
 * own escaping rules.
 */
export async function quoteLiteral(
  client: Pick<Client, "query">,
  value: string,
): Promise<string> {
  const result = await client.query<{ quoted: string }>(
    "SELECT quote_literal($1) AS quoted",
    [value],
  );
  return result.rows[0]!.quoted;
}

// ---------------------------------------------------------------------------
// Connection pooling
// ---------------------------------------------------------------------------

const pools = new Map<string, Pool>();

/** Get or create a connection pool for a given connection ID. */
function getOrCreatePool(connectionId: string): Pool {
  let pool = pools.get(connectionId);
  if (pool) return pool;

  const connection = getConnectionById(connectionId);
  if (!connection) throw new Error("Connection not found.");

  pool = new Pool({ ...buildPgConfig(connection), max: 5 });
  pools.set(connectionId, pool);
  return pool;
}

/** Run a function with a pooled client, automatically releasing it afterwards. */
export async function withPoolClient<T>(
  connectionId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getOrCreatePool(connectionId);
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Run a one-off operation outside the shared pool. Cancellation uses this so
 * it remains available even when every pooled client is occupied by work.
 */
export async function withDedicatedClient<T>(
  connectionId: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const connection = getConnectionById(connectionId);
  if (!connection) throw new Error("Connection not found.");
  const client = new Client(buildPgConfig(connection));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Destroy the pool for a specific connection (e.g. after config change or deletion). */
export async function destroyPool(connectionId: string): Promise<void> {
  const pool = pools.get(connectionId);
  if (!pool) return;
  pools.delete(connectionId);
  try {
    await pool.end();
  } catch (err) {
    console.error(`[pg-utils] destroyPool(${connectionId}) failed:`, err);
  }
}

/** Destroy all connection pools (e.g. on app quit). */
export async function destroyAllPools(): Promise<void> {
  const entries = Array.from(pools.entries());
  pools.clear();
  await Promise.all(
    entries.map(async ([id, pool]) => {
      try {
        await pool.end();
      } catch (err) {
        console.error(`[pg-utils] destroyAllPools: pool ${id} failed:`, err);
      }
    }),
  );
}
