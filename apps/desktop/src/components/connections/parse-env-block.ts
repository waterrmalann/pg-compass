import type { ConnectionFields } from "@/shared/types/connection";

export interface ParsedEnvConnection {
  /** Full connection URI, if a postgres:// or postgresql:// URL was found. */
  uri?: string;
  fields: Partial<ConnectionFields>;
  /** Inline SSL CA certificate contents (PEM or base64-encoded PEM). */
  ca?: string;
}

/*
 * Recognised keys. Only Postgres-specific names are accepted: bare generic
 * keys such as HOST, PORT, USER, PASSWORD or DATABASE usually belong to some
 * other service in a real .env file (the web server's PORT, an SMTP
 * PASSWORD, ...), so they are ignored. Earlier keys in each list win.
 *
 * | Field    | Keys                                                                        |
 * | -------- | --------------------------------------------------------------------------- |
 * | uri      | DATABASE_URL, POSTGRES_URL, POSTGRESQL_URL, PG_URI, PGURI (postgres scheme)   |
 * | host     | POSTGRES_HOST, PGHOST, DATABASE_HOST, DB_HOST                                |
 * | port     | POSTGRES_PORT, PGPORT, DATABASE_PORT, DB_PORT                                |
 * | database | POSTGRES_DB, POSTGRES_DATABASE, PGDATABASE, DATABASE_NAME, DB_NAME, DB_DATABASE |
 * | user     | POSTGRES_USER, PGUSER, DATABASE_USER, DATABASE_USERNAME, DB_USER, DB_USERNAME |
 * | password | POSTGRES_PASSWORD, PGPASSWORD, DATABASE_PASSWORD, DB_PASSWORD               |
 * | ca       | POSTGRES_SSL_CA, DATABASE_SSL_CA, DB_SSL_CA, PGSSLROOTCERT (content only)     |
 *
 * PGSSLROOTCERT is normally a file path, so every CA key is only used when
 * its value is certificate content (PEM, or base64-encoded PEM). PGSSLCERT is
 * the client certificate, not a CA, and is ignored.
 */
const FIELD_ALIASES: Record<keyof ConnectionFields, string[]> = {
  host: ["POSTGRES_HOST", "PGHOST", "DATABASE_HOST", "DB_HOST"],
  port: ["POSTGRES_PORT", "PGPORT", "DATABASE_PORT", "DB_PORT"],
  database: [
    "POSTGRES_DB",
    "POSTGRES_DATABASE",
    "PGDATABASE",
    "DATABASE_NAME",
    "DB_NAME",
    "DB_DATABASE",
  ],
  user: [
    "POSTGRES_USER",
    "PGUSER",
    "DATABASE_USER",
    "DATABASE_USERNAME",
    "DB_USER",
    "DB_USERNAME",
  ],
  password: [
    "POSTGRES_PASSWORD",
    "PGPASSWORD",
    "DATABASE_PASSWORD",
    "DB_PASSWORD",
  ],
};

const CA_ALIASES = [
  "POSTGRES_SSL_CA",
  "DATABASE_SSL_CA",
  "DB_SSL_CA",
  "PGSSLROOTCERT",
];

const URI_ALIASES = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRESQL_URL",
  "PG_URI",
  "PGURI",
];

// Matches `KEY=VALUE`, optionally prefixed with "export ".
const LINE_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

const POSTGRES_URI_RE = /^postgres(?:ql)?:\/\//i;

/** Parse a pasted block of `KEY=VALUE` lines into connection fields. */
export function parseEnvBlock(text: string): ParsedEnvConnection {
  const values = readEnvValues(text);
  const result: ParsedEnvConnection = { fields: {} };

  const uri = firstValue(values, URI_ALIASES);
  if (uri && POSTGRES_URI_RE.test(uri)) result.uri = uri;

  const host = firstValue(values, FIELD_ALIASES.host);
  if (host) result.fields.host = host;

  const port = firstValue(values, FIELD_ALIASES.port);
  if (port && /^\d+$/.test(port)) {
    result.fields.port = Number.parseInt(port, 10);
  }

  const database = firstValue(values, FIELD_ALIASES.database);
  if (database) result.fields.database = database;

  const user = firstValue(values, FIELD_ALIASES.user);
  if (user) result.fields.user = user;

  const password = firstValue(values, FIELD_ALIASES.password);
  if (password) result.fields.password = password;

  const ca = firstCertificate(values);
  if (ca) result.ca = ca;

  return result;
}

function readEnvValues(text: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const isComment = line.startsWith("#");
    if (isComment) continue;

    const match = LINE_RE.exec(line);
    if (!match) continue;

    const key = match[1];
    if (!key) continue;
    const rawValue = match[2] ?? "";
    values.set(key.toUpperCase(), parseValue(rawValue.trim()));
  }

  return values;
}

function parseValue(value: string): string {
  const isDoubleQuoted =
    value.length >= 2 && value.startsWith('"') && value.endsWith('"');
  if (isDoubleQuoted) {
    // dotenv expands escaped newlines inside double quotes (PEM blocks).
    return value.slice(1, -1).replaceAll(String.raw`\n`, "\n");
  }

  const isSingleQuoted =
    value.length >= 2 && value.startsWith("'") && value.endsWith("'");
  if (isSingleQuoted) return value.slice(1, -1);

  // Unquoted values may carry a trailing ` # comment`.
  const commentStart = value.search(/\s#/);
  if (commentStart === -1) return value;
  return value.slice(0, commentStart).trim();
}

function firstValue(
  values: Map<string, string>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = values.get(key);
    if (value) return value;
  }
  return undefined;
}

function firstCertificate(values: Map<string, string>): string | undefined {
  for (const key of CA_ALIASES) {
    const value = values.get(key);
    if (value && isCertificateContent(value)) return value;
  }
  return undefined;
}

function isCertificateContent(value: string): boolean {
  const isPem = value.startsWith("-----BEGIN");
  // "LS0t" is "---" base64-encoded: the start of a base64-encoded PEM.
  const isBase64Pem = value.startsWith("LS0t");
  return isPem || isBase64Pem;
}
