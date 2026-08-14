import type { ClientBase } from "pg";
import type {
  AccessLevel,
  AlterRoleCommentInput,
  AlterRoleInput,
  CloneRoleInput,
  CreateRoleInput,
  MembershipInput,
  RenameRoleInput,
  SetDbAccessLevelInput,
  TableRestrictionInput,
} from "../shared/types/roles";
import type { IpcResult } from "../shared/types/ipc";
import {
  quoteIdent,
  quoteLiteral,
  withDatabaseClient,
  withPoolClient,
} from "./pg-utils";
import { getConnectionById } from "./connection-store";
import { getSettings } from "./settings-store";
import { logAudit } from "./audit-store";
import { buildScramSha256Verifier } from "./scram-verifier";
import { fetchMemberships, requireSuperuser } from "./roles-queries";

// ---------------------------------------------------------------------------
// Mutation runner (read-only gate + audit log)
// ---------------------------------------------------------------------------

async function resolveActor(connectionId: string): Promise<string> {
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

/**
 * Runs one RBAC mutation and records it in the audit log. Every mutation goes
 * through here, so Read-only mode is enforced in one place: it throws before
 * touching the server, exactly like the table-data write paths.
 */
export async function runRoleMutation(
  connectionId: string,
  action: string,
  target: string,
  mutate: () => Promise<void>,
): Promise<IpcResult<void>> {
  if (getSettings().general.readOnlyMode) {
    throw new Error(`Cannot ${action}: read-only mode is enabled.`);
  }

  const connectionLabel =
    getConnectionById(connectionId)?.label ?? connectionId;
  let error: string | undefined;
  try {
    await mutate();
  } catch (err) {
    error = (err as Error).message;
  }

  const succeeded = error === undefined;
  logAudit({
    connectionId,
    connectionLabel,
    actor: await resolveActor(connectionId),
    action,
    target,
    success: succeeded,
    error,
  });

  if (!succeeded) {
    return { success: false, error: error ?? "Unknown error" };
  }
  return { success: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Runs `work` in one transaction so multi-statement DDL is all-or-nothing. */
async function inTransaction(
  client: ClientBase,
  work: () => Promise<void>,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await work();
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

/**
 * `PASSWORD <SCRAM verifier>`, so the plaintext never reaches the server (or
 * its logs). An empty or null password clears it, as PostgreSQL itself does
 * for `PASSWORD ''`.
 */
async function buildPasswordOption(
  client: ClientBase,
  password: string | null,
): Promise<string> {
  if (password === null || password === "") {
    return "PASSWORD NULL";
  }
  const verifier = buildScramSha256Verifier(password);
  const literal = await quoteLiteral(client, verifier);
  return `PASSWORD ${literal}`;
}

/** Empty or null means "never expires". */
async function buildValidUntilOption(
  client: ClientBase,
  validUntil: string | null,
): Promise<string> {
  if (validUntil === null || validUntil === "") {
    return "VALID UNTIL 'infinity'";
  }
  const literal = await quoteLiteral(client, validUntil);
  return `VALID UNTIL ${literal}`;
}

function flagOption(value: boolean, enabled: string, disabled: string) {
  return value ? enabled : disabled;
}

function connectionLimitOption(limit: number): string {
  // Validated as an integer; Number() keeps the interpolation numeric.
  return `CONNECTION LIMIT ${Number(limit)}`;
}

// ---------------------------------------------------------------------------
// Role lifecycle
// ---------------------------------------------------------------------------

export async function createRole(input: CreateRoleInput): Promise<void> {
  await withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);

    const options = [flagOption(input.login, "LOGIN", "NOLOGIN")];
    if (input.createRole !== undefined) {
      options.push(flagOption(input.createRole, "CREATEROLE", "NOCREATEROLE"));
    }
    if (input.createDb !== undefined) {
      options.push(flagOption(input.createDb, "CREATEDB", "NOCREATEDB"));
    }
    if (input.inherit !== undefined) {
      options.push(flagOption(input.inherit, "INHERIT", "NOINHERIT"));
    }
    if (input.connectionLimit !== undefined) {
      options.push(connectionLimitOption(input.connectionLimit));
    }
    if (input.validUntil !== undefined && input.validUntil !== "") {
      options.push(await buildValidUntilOption(client, input.validUntil));
    }
    if (input.password !== undefined && input.password !== "") {
      options.push(await buildPasswordOption(client, input.password));
    }

    const roleIdent = quoteIdent(input.name);
    const membershipRoles = input.membershipRoles ?? [];
    await inTransaction(client, async () => {
      await client.query(`CREATE ROLE ${roleIdent} WITH ${options.join(" ")}`);
      if (membershipRoles.length > 0) {
        const parentList = membershipRoles.map(quoteIdent).join(", ");
        await client.query(`GRANT ${parentList} TO ${roleIdent}`);
      }
    });
  });
}

export async function alterRole(input: AlterRoleInput): Promise<void> {
  await withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);

    const options: string[] = [];
    if (input.login !== undefined) {
      options.push(flagOption(input.login, "LOGIN", "NOLOGIN"));
    }
    if (input.createRole !== undefined) {
      options.push(flagOption(input.createRole, "CREATEROLE", "NOCREATEROLE"));
    }
    if (input.createDb !== undefined) {
      options.push(flagOption(input.createDb, "CREATEDB", "NOCREATEDB"));
    }
    if (input.connectionLimit !== undefined) {
      options.push(connectionLimitOption(input.connectionLimit));
    }
    if (input.validUntil !== undefined) {
      options.push(await buildValidUntilOption(client, input.validUntil));
    }
    if (input.password !== undefined) {
      options.push(await buildPasswordOption(client, input.password));
    }
    if (options.length === 0) return;

    await inTransaction(client, async () => {
      await client.query(
        `ALTER ROLE ${quoteIdent(input.name)} WITH ${options.join(" ")}`,
      );
    });
  });
}

export async function alterRolePassword(input: {
  connectionId: string;
  name: string;
  password: string;
}): Promise<void> {
  await withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);
    const passwordOption = await buildPasswordOption(client, input.password);
    await client.query(
      `ALTER ROLE ${quoteIdent(input.name)} ${passwordOption}`,
    );
  });
}

export async function alterRoleComment(
  input: AlterRoleCommentInput,
): Promise<void> {
  await withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);
    const roleIdent = quoteIdent(input.name);
    if (input.comment === null || input.comment === "") {
      await client.query(`COMMENT ON ROLE ${roleIdent} IS NULL`);
      return;
    }
    const literal = await quoteLiteral(client, input.comment);
    await client.query(`COMMENT ON ROLE ${roleIdent} IS ${literal}`);
  });
}

export async function dropRole(
  connectionId: string,
  name: string,
): Promise<void> {
  await withPoolClient(connectionId, async (client) => {
    await requireSuperuser(client);
    await client.query(`DROP ROLE IF EXISTS ${quoteIdent(name)}`);
  });
}

export async function cloneRole(input: CloneRoleInput): Promise<void> {
  await withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);

    const source = await client.query<{
      rolsuper: boolean;
      rolcanlogin: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolinherit: boolean;
      rolconnlimit: number;
    }>(
      `SELECT rolsuper, rolcanlogin, rolcreaterole, rolcreatedb, rolinherit,
              rolconnlimit
       FROM pg_roles WHERE rolname = $1`,
      [input.sourceName],
    );
    const sourceRow = source.rows[0];
    if (!sourceRow) {
      throw new Error(`Role "${input.sourceName}" not found.`);
    }
    if (sourceRow.rolsuper) {
      throw new Error("Refusing to clone a superuser role.");
    }

    const options = [
      flagOption(sourceRow.rolcanlogin, "LOGIN", "NOLOGIN"),
      flagOption(sourceRow.rolcreaterole, "CREATEROLE", "NOCREATEROLE"),
      flagOption(sourceRow.rolcreatedb, "CREATEDB", "NOCREATEDB"),
      flagOption(sourceRow.rolinherit, "INHERIT", "NOINHERIT"),
      connectionLimitOption(sourceRow.rolconnlimit),
    ];
    const memberships = await fetchMemberships(client, input.sourceName);
    const newRoleIdent = quoteIdent(input.newName);

    await inTransaction(client, async () => {
      await client.query(
        `CREATE ROLE ${newRoleIdent} WITH ${options.join(" ")}`,
      );
      for (const membership of memberships) {
        const adminClause = membership.withAdminOption
          ? " WITH ADMIN OPTION"
          : "";
        await client.query(
          `GRANT ${quoteIdent(membership.parentName)} TO ${newRoleIdent}${adminClause}`,
        );
      }
    });
  });
}

export async function renameRole(input: RenameRoleInput): Promise<void> {
  await withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);
    if (input.newName === input.oldName) return;
    await client.query(
      `ALTER ROLE ${quoteIdent(input.oldName)} RENAME TO ${quoteIdent(input.newName)}`,
    );
  });
}

export async function grantMembership(input: MembershipInput): Promise<void> {
  await withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);
    const adminClause = input.withAdminOption ? " WITH ADMIN OPTION" : "";
    await client.query(
      `GRANT ${quoteIdent(input.parentRoleName)} TO ${quoteIdent(input.memberName)}${adminClause}`,
    );
  });
}

export async function revokeMembership(input: MembershipInput): Promise<void> {
  await withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);
    await client.query(
      `REVOKE ${quoteIdent(input.parentRoleName)} FROM ${quoteIdent(input.memberName)}`,
    );
  });
}

// ---------------------------------------------------------------------------
// Database access abstraction (no access / read only / read + write)
// ---------------------------------------------------------------------------

async function fetchGrantableSchemas(client: ClientBase): Promise<string[]> {
  const result = await client.query<{ nspname: string }>(`
    SELECT nspname
    FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog', 'information_schema')
      AND nspname NOT LIKE 'pg_toast%'
      AND nspname NOT LIKE 'pg_temp%'
    ORDER BY nspname
  `);
  return result.rows.map((row) => row.nspname);
}

const TABLE_PRIVILEGES: Record<Exclude<AccessLevel, "none">, string> = {
  readonly: "SELECT",
  readwrite: "SELECT, INSERT, UPDATE, DELETE",
};

const SEQUENCE_PRIVILEGES: Record<Exclude<AccessLevel, "none">, string> = {
  readonly: "SELECT",
  readwrite: "SELECT, USAGE",
};

/**
 * Resets every grant this abstraction owns across all schemas of the
 * database, then applies the requested level. Runs in the target database,
 * inside one transaction.
 */
export async function setDbAccessLevel(
  input: SetDbAccessLevelInput,
): Promise<void> {
  await withDatabaseClient(
    input.connectionId,
    input.databaseName,
    async (client) => {
      await requireSuperuser(client);
      const schemas = await fetchGrantableSchemas(client);
      const userIdent = quoteIdent(input.userName);
      const databaseIdent = quoteIdent(input.databaseName);

      await inTransaction(client, async () => {
        await client.query(
          `REVOKE ALL PRIVILEGES ON DATABASE ${databaseIdent} FROM ${userIdent}`,
        );
        for (const schemaName of schemas) {
          const schemaIdent = quoteIdent(schemaName);
          await client.query(
            `REVOKE ALL PRIVILEGES ON SCHEMA ${schemaIdent} FROM ${userIdent}`,
          );
          await client.query(
            `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schemaIdent} FROM ${userIdent}`,
          );
          await client.query(
            `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${schemaIdent} FROM ${userIdent}`,
          );
          await client.query(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdent} REVOKE ALL ON TABLES FROM ${userIdent}`,
          );
          await client.query(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdent} REVOKE ALL ON SEQUENCES FROM ${userIdent}`,
          );
        }

        if (input.level === "none") return;

        const tablePrivileges = TABLE_PRIVILEGES[input.level];
        const sequencePrivileges = SEQUENCE_PRIVILEGES[input.level];
        await client.query(
          `GRANT CONNECT ON DATABASE ${databaseIdent} TO ${userIdent}`,
        );
        for (const schemaName of schemas) {
          const schemaIdent = quoteIdent(schemaName);
          await client.query(
            `GRANT USAGE ON SCHEMA ${schemaIdent} TO ${userIdent}`,
          );
          await client.query(
            `GRANT ${tablePrivileges} ON ALL TABLES IN SCHEMA ${schemaIdent} TO ${userIdent}`,
          );
          await client.query(
            `GRANT ${sequencePrivileges} ON ALL SEQUENCES IN SCHEMA ${schemaIdent} TO ${userIdent}`,
          );
          if (!input.applyToFutureTables) continue;
          await client.query(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdent} GRANT ${tablePrivileges} ON TABLES TO ${userIdent}`,
          );
          await client.query(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdent} GRANT ${sequencePrivileges} ON SEQUENCES TO ${userIdent}`,
          );
        }
      });
    },
  );
}

// GRANT's explicit table-list form has no "IN SCHEMA" clause, so each name
// is schema-qualified.
function quoteQualifiedList(schema: string, names: string[]): string {
  return names
    .map((name) => `${quoteIdent(schema)}.${quoteIdent(name)}`)
    .join(", ");
}

/**
 * Per-table overrides. Within each schema in the list, unlisted tables are
 * revoked and future tables get nothing by default.
 */
export async function setTableRestrictions(
  input: TableRestrictionInput,
): Promise<void> {
  const tablesBySchema = new Map<
    string,
    Array<{ name: string; level: AccessLevel }>
  >();
  for (const table of input.tables) {
    const entries = tablesBySchema.get(table.schema) ?? [];
    entries.push({ name: table.name, level: table.level });
    tablesBySchema.set(table.schema, entries);
  }

  await withDatabaseClient(
    input.connectionId,
    input.databaseName,
    async (client) => {
      await requireSuperuser(client);
      const userIdent = quoteIdent(input.userName);

      await inTransaction(client, async () => {
        for (const [schema, tables] of tablesBySchema) {
          const schemaIdent = quoteIdent(schema);
          const readOnlyTables = tables
            .filter((table) => table.level === "readonly")
            .map((table) => table.name);
          const readWriteTables = tables
            .filter((table) => table.level === "readwrite")
            .map((table) => table.name);

          await client.query(
            `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schemaIdent} FROM ${userIdent}`,
          );
          const grantsAnything =
            readOnlyTables.length > 0 || readWriteTables.length > 0;
          if (grantsAnything) {
            await client.query(
              `GRANT USAGE ON SCHEMA ${schemaIdent} TO ${userIdent}`,
            );
          }
          if (readOnlyTables.length > 0) {
            await client.query(
              `GRANT SELECT ON ${quoteQualifiedList(schema, readOnlyTables)} TO ${userIdent}`,
            );
          }
          if (readWriteTables.length > 0) {
            await client.query(
              `GRANT SELECT, INSERT, UPDATE, DELETE ON ${quoteQualifiedList(schema, readWriteTables)} TO ${userIdent}`,
            );
          }
          await client.query(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdent} REVOKE ALL ON TABLES FROM ${userIdent}`,
          );
        }
      });
    },
  );
}
