import type { ConnectionFields } from "@/shared/types/connection";

export interface ParsedEnvConnection {
  /** Full connection URI, if one of DATABASE_URL/POSTGRES_URL etc. was found. */
  uri?: string;
  fields: Partial<ConnectionFields>;
  /** Inline SSL CA certificate contents (PEM or base64-encoded PEM). */
  ca?: string;
}

const FIELD_ALIASES: Record<keyof ConnectionFields, string[]> = {
  host: ["POSTGRES_HOST", "PGHOST", "DB_HOST", "HOST"],
  port: ["POSTGRES_PORT", "PGPORT", "DB_PORT", "PORT"],
  database: [
    "POSTGRES_DB",
    "POSTGRES_DATABASE",
    "PGDATABASE",
    "DB_NAME",
    "DATABASE",
  ],
  user: ["POSTGRES_USER", "PGUSER", "DB_USER", "USERNAME"],
  password: ["POSTGRES_PASSWORD", "PGPASSWORD", "DB_PASSWORD", "PASSWORD"],
};

const CA_ALIASES = [
  "POSTGRES_SSL_CA",
  "PGSSLROOTCERT",
  "PGSSLCERT",
  "SSL_CA",
  "DB_SSL_CA",
  "CA_CERT",
];

const URI_ALIASES = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRESQL_URL",
  "PG_URI",
  "PGURI",
];

// Matches `KEY=VALUE`, optionally prefixed with "export " or a leading "#"
// (copied .env blocks are often commented out line-by-line for reference).
const LINE_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/** Parse a pasted block of `KEY=VALUE` lines into connection fields. */
export function parseEnvBlock(text: string): ParsedEnvConnection {
  const values = new Map<string, string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^#\s*/, "");
    if (!line) continue;

    const match = LINE_RE.exec(line);
    if (!match) continue;

    const key = match[1];
    if (!key) continue;
    const rawValue = match[2] ?? "";
    values.set(key.toUpperCase(), unquote(rawValue.trim()));
  }

  const result: ParsedEnvConnection = { fields: {} };

  const uri = firstValue(values, URI_ALIASES);
  if (uri) result.uri = uri;

  const host = firstValue(values, FIELD_ALIASES.host);
  if (host) result.fields.host = host;

  const port = firstValue(values, FIELD_ALIASES.port);
  if (port) {
    const parsedPort = Number.parseInt(port, 10);
    if (Number.isInteger(parsedPort)) result.fields.port = parsedPort;
  }

  const database = firstValue(values, FIELD_ALIASES.database);
  if (database) result.fields.database = database;

  const user = firstValue(values, FIELD_ALIASES.user);
  if (user) result.fields.user = user;

  const password = firstValue(values, FIELD_ALIASES.password);
  if (password) result.fields.password = password;

  const ca = firstValue(values, CA_ALIASES);
  if (ca) result.ca = ca;

  return result;
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

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
