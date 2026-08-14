import { Client, type PoolClient } from "pg";
import { RolesChannels } from "../shared/constants/ipc-channels";
import type {
  AccessLevel,
  AlterRoleInput,
  AuditLogEntry,
  CloneRoleInput,
  CreateRoleInput,
  CreateTriggerFunctionInput,
  CreateTriggerInput,
  DropTriggerInput,
  EffectivePermissions,
  MembershipInput,
  PgDatabaseInfo,
  PgMembership,
  PgRole,
  PgTableAccess,
  PgTriggerFunction,
  PgTriggerInfo,
  RenameRoleInput,
  RolesSidebarSummary,
  RolesSnapshot,
  SetDbAccessLevelInput,
  SetTriggerEnabledInput,
  TableRestrictionInput,
} from "../shared/types/roles";
import {
  buildPgConfig,
  withPoolClient,
  quoteIdent,
  quoteLiteral,
  extendedQuery,
} from "./pg-utils";
import { getConnectionById } from "./connection-store";
import { registerIpcHandler } from "./ipc-security";
import {
  clearAuditLog,
  getAuditLog,
  logAudit,
} from "./audit-store";
import {
  validateAlterRoleCommentInput,
  validateAlterRoleInput,
  validateAlterRolePasswordInput,
  validateCloneRoleInput,
  validateConnectionIdInput,
  validateConnectionUserInput,
  validateCreateRoleInput,
  validateCreateTriggerFunctionInput,
  validateCreateTriggerInput,
  validateDbAccessInput,
  validateDbReadonlyGrantInput,
  validateDropRoleInput,
  validateDropTriggerInput,
  validateMembershipInput,
  validateRenameRoleInput,
  validateRolesSnapshotInput,
  validateSetDbAccessLevelInput,
  validateSetTriggerEnabledInput,
  validateTableRestrictionInput,
  validateTriggerListInput,
} from "./ipc-validation";

// ---------------------------------------------------------------------------
// Row shapes (PostgreSQL queries)
// ---------------------------------------------------------------------------

interface PgCurrentUserRow {
  rolname: string;
  rolsuper: boolean;
  rolcanlogin: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
}

interface PgRoleRow {
  rolname: string;
  rolsuper: boolean;
  rolcanlogin: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolinherit: boolean;
  rolconnlimit: number;
  rolvaliduntil: Date | null;
  rolpassword: string | null;
  rolreplication: boolean;
  rolbypassrls: boolean;
  description: string | null;
}

interface PgMembershipRow {
  member_name: string;
  parent_name: string;
  admin_option: boolean;
}

interface PgDatabaseRow {
  datname: string;
  datistemplate: boolean;
  datallowconn: boolean;
}

interface PgDatabasePrivilegeRow {
  datname: string;
  can_connect: boolean;
  can_create: boolean;
  can_temp: boolean;
}

interface PgDatabaseExtRow {
  datname: string;
  owner: string;
  size: string | null;
  role_count: number;
}

interface PgSchemaPrivacyRow {
  schema_name: string;
  has_usage: boolean;
}

interface PgTableSelectRow {
  table_schema: string;
  table_name: string;
  has_select: boolean;
  has_write: boolean;
}

interface PgTriggerRow {
  schema_name: string;
  table_name: string;
  trigger_name: string;
  timing: string;
  events: string;
  function_name: string;
  function_schema: string;
  enabled_mode: "origin" | "disabled" | "replica" | "always";
  orientation: string;
}

interface PgTriggerFunctionRow {
  schema_name: string;
  function_name: string;
  source: string | null;
}

interface PgActivityRow {
  count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCurrentUser(client: PoolClient): Promise<PgCurrentUserRow> {
  const result = await client.query<PgCurrentUserRow>(`
    SELECT rolname, rolsuper, rolcanlogin, rolcreaterole, rolcreatedb
    FROM pg_roles
    WHERE rolname = current_user
  `);
  const row = result.rows[0];
  if (!row) {
    throw new Error("Could not resolve the current PostgreSQL role.");
  }
  return row;
}

async function requireSuperuser(client: PoolClient): Promise<void> {
  const user = await getCurrentUser(client);
  if (!user.rolsuper) {
    throw new Error(
      "This action requires a PostgreSQL superuser connection.",
    );
  }
}

function toIso(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString();
}

function rolesFromRows(rows: PgRoleRow[]): PgRole[] {
  return rows.map((row) => ({
    name: row.rolname,
    isSuperuser: row.rolsuper,
    canLogin: row.rolcanlogin,
    canCreateRole: row.rolcreaterole,
    canCreateDb: row.rolcreatedb,
    inherit: row.rolinherit,
    connectionLimit: row.rolconnlimit,
    validUntil: toIso(row.rolvaliduntil),
    hasPassword: row.rolpassword !== null,
    canReplicate: row.rolreplication,
    canBypassRls: row.rolbypassrls,
    description: row.description,
  }));
}

async function fetchRoles(
  client: PoolClient,
  filterToUser?: string,
): Promise<PgRole[]> {
  const query = `
    SELECT
      rolname,
      rolsuper,
      rolcanlogin,
      rolcreaterole,
      rolcreatedb,
      rolinherit,
      rolconnlimit,
      rolvaliduntil,
      rolpassword,
      rolreplication,
      rolbypassrls,
      pg_catalog.shobj_description(oid, 'pg_authid') AS description
    FROM pg_roles
    ${filterToUser ? "WHERE rolname = $1" : ""}
    ORDER BY rolcanlogin DESC, rolname
  `;
  const params = filterToUser ? [filterToUser] : undefined;
  const result = await client.query<PgRoleRow>(query, params);
  return rolesFromRows(result.rows);
}

async function fetchMemberships(
  client: PoolClient,
  filterForMember?: string,
): Promise<PgMembership[]> {
  const query = `
    SELECT
      m.rolname AS member_name,
      r.rolname AS parent_name,
      am.admin_option
    FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles r ON r.oid = am.roleid
    ${filterForMember ? "WHERE m.rolname = $1" : ""}
    ORDER BY r.rolname, m.rolname
  `;
  const params = filterForMember ? [filterForMember] : undefined;
  const result = await client.query<PgMembershipRow>(query, params);
  return result.rows.map((row) => ({
    memberName: row.member_name,
    parentName: row.parent_name,
    withAdminOption: row.admin_option,
  }));
}

/**
 * Build a pg config that targets a different database on the same server as
 * the saved connection. Cross-database GRANTs must run against the database
 * whose objects are being modified.
 */
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

async function fetchDatabaseExtensions(
  client: PoolClient,
): Promise<Map<string, PgDatabaseExtRow>> {
  const result = await client.query<PgDatabaseExtRow>(`
    SELECT
      d.datname,
      pg_catalog.pg_get_userbyid(d.datdba) AS owner,
      pg_size_pretty(pg_database_size(d.datname)) AS size,
      (
        SELECT COUNT(DISTINCT acl.grantee)
        FROM pg_database dp
        CROSS JOIN LATERAL aclexplode(
          COALESCE(dp.datacl, pg_catalog.acldefault('d', dp.datdba))
        ) acl
        WHERE dp.datname = d.datname
      ) AS role_count
    FROM pg_database d
    WHERE d.datallowconn
    ORDER BY d.datname
  `);

  const map = new Map<string, PgDatabaseExtRow>();
  for (const row of result.rows) {
    if (row.role_count == null || Number.isNaN(row.role_count)) {
      row.role_count = 0;
    }
    map.set(row.datname, row);
  }
  return map;
}

async function fetchDatabases(
  client: PoolClient,
  targetUser: string,
): Promise<PgDatabaseInfo[]> {
  const dbResult = await client.query<PgDatabaseRow>(`
    SELECT datname, datistemplate, datallowconn
    FROM pg_database
    WHERE datallowconn
    ORDER BY datname
  `);

  const ext = await fetchDatabaseExtensions(client);

  const privResult = await client.query<PgDatabasePrivilegeRow>(
    `
    SELECT
      datname,
      has_database_privilege($1, datname, 'CONNECT') AS can_connect,
      has_database_privilege($1, datname, 'CREATE') AS can_create,
      has_database_privilege($1, datname, 'TEMPORARY') AS can_temp
    FROM pg_database
    WHERE datallowconn
    ORDER BY datname
  `,
    [targetUser],
  );

  const privMap = new Map<string, PgDatabasePrivilegeRow>();
  for (const row of privResult.rows) privMap.set(row.datname, row);

  const result: PgDatabaseInfo[] = [];
  for (const row of dbResult.rows) {
    const extRow = ext.get(row.datname);
    const priv = privMap.get(row.datname);
    result.push({
      name: row.datname,
      owner: extRow?.owner ?? "unknown",
      size: extRow?.size ?? null,
      // Schemas are per-database catalogs — accurate only once connected to
      // that specific database. Filled in by computeEffectiveLevels below
      // for every database it can actually reach; left null otherwise.
      schemaCount: null,
      roleCount: Number(extRow?.role_count ?? 0),
      isTemplate: row.datistemplate,
      allowConnections: row.datallowconn,
      canConnect: priv?.can_connect ?? false,
      canCreate: priv?.can_create ?? false,
      canTemp: priv?.can_temp ?? false,
      level: "none",
      tables: [],
    });
  }
  return result;
}

interface DbAccessEvaluation {
  level: AccessLevel;
  tables: PgTableAccess[];
  /** Non-system schema count, read while actually connected to `database`. */
  schemaCount: number;
}

async function computeDbAccess(
  connectionId: string,
  database: string,
  userName: string,
): Promise<DbAccessEvaluation> {
  return runInDatabase(connectionId, database, async (client) => {
    const usageResult = await client.query<PgSchemaPrivacyRow>(
      `
      SELECT n.nspname AS schema_name,
             has_schema_privilege($1, n.nspname, 'USAGE') AS has_usage
      FROM pg_namespace n
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
        AND n.nspname NOT LIKE 'pg_temp%'
    `,
      [userName],
    );
    const usageBySchema = new Map(
      usageResult.rows.map((row) => [row.schema_name, row.has_usage]),
    );
    // usageResult already lists every non-system schema in *this* database
    // (has_schema_privilege only gates the has_usage column, not the row
    // set), so its row count is the accurate per-database schema count —
    // no extra query needed.
    const schemaCount = usageResult.rows.length;

    // pg_class/pg_namespace (unlike information_schema.tables) list every
    // table's metadata regardless of the connected role's own privileges —
    // information_schema.tables only shows rows the connected session role
    // itself can access, which hid non-public schemas whenever the pooled
    // connection wasn't granted on them.
    const tableResult = await client.query<PgTableSelectRow>(
      `
      SELECT
        n.nspname AS table_schema,
        c.relname AS table_name,
        has_table_privilege($1, c.oid, 'SELECT') AS has_select,
        has_table_privilege($1, c.oid, 'INSERT,UPDATE,DELETE') AS has_write
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
        AND n.nspname NOT LIKE 'pg_temp%'
      ORDER BY n.nspname, c.relname
    `,
      [userName],
    );

    // A table-level grant is inert without schema USAGE, so fold both into
    // a single effective per-table level rather than surfacing them
    // separately and confusing the "restrict to tables" UI.
    const tables: PgTableAccess[] = tableResult.rows.map((row) => {
      const hasUsage = usageBySchema.get(row.table_schema) ?? false;
      return {
        schemaName: row.table_schema,
        tableName: row.table_name,
        level:
          hasUsage && row.has_write
            ? "readwrite"
            : hasUsage && row.has_select
              ? "readonly"
              : "none",
      };
    });

    // The rollup badge now spans every schema, matching the database-level
    // toggle which grants/revokes across all of them (not just `public`).
    if (tables.length === 0) {
      return { level: "none", tables, schemaCount };
    }
    const hasAnyWrite = tables.some((t) => t.level === "readwrite");
    const allAccessible = tables.every(
      (t) => t.level === "readonly" || t.level === "readwrite",
    );
    const level: AccessLevel = hasAnyWrite
      ? "readwrite"
      : allAccessible
        ? "readonly"
        : "none";
    return { level, tables, schemaCount };
  });
}

async function computeEffectiveLevels(
  connectionId: string,
  databases: PgDatabaseInfo[],
  targetUser: string,
): Promise<PgDatabaseInfo[]> {
  const result: PgDatabaseInfo[] = [];
  for (const db of databases) {
    // Skip the connection attempt entirely when the privilege check already
    // says CONNECT is missing — and still isolate failures for the rest
    // (pg_hba rules, connection limits, a database dropped mid-scan) so one
    // bad database can't reject the whole snapshot.
    if (!db.canConnect) {
      result.push({ ...db, level: "none", tables: [] });
      continue;
    }
    try {
      const { level, tables, schemaCount } = await computeDbAccess(
        connectionId,
        db.name,
        targetUser,
      );
      result.push({ ...db, level, tables, schemaCount });
    } catch {
      result.push({ ...db, level: "none", tables: [] });
    }
  }
  return result;
}

async function fetchDashboardStats(
  client: PoolClient,
): Promise<RolesSnapshot["stats"]> {
  const totals = await client.query<{
    total_roles: number;
    total_users: number;
    superusers: number;
  }>(`
    SELECT
      COUNT(*)::int AS total_roles,
      COUNT(*) FILTER (WHERE rolcanlogin)::int AS total_users,
      COUNT(*) FILTER (WHERE rolsuper)::int AS superusers
    FROM pg_roles
  `);

  let activeConnections = -1;
  try {
    const activity = await client.query<PgActivityRow>(`
      SELECT COUNT(*)::int AS count
      FROM pg_stat_activity
      WHERE state IS NOT NULL
    `);
    activeConnections = Number(activity.rows[0]?.count ?? -1);
  } catch {
    activeConnections = -1;
  }

  const dbCount = await client.query<{ count: number }>(`
    SELECT COUNT(*)::int AS count
    FROM pg_database
    WHERE datallowconn
  `);

  const recent = await client.query<{ rolname: string; created_at: Date | null }>(`
    SELECT rolname, NULL AS created_at
    FROM pg_roles
    WHERE rolcanlogin
    ORDER BY rolname
    LIMIT 10
  `);

  // pg_roles does not track creation time, so we surface the most-recently
  // created entries from our local audit log later in the renderer if needed.
  return {
    totalDatabases: Number(dbCount.rows[0]?.count ?? 0),
    totalRoles: Number(totals.rows[0]?.total_roles ?? 0),
    totalUsers: Number(totals.rows[0]?.total_users ?? 0),
    superusersCount: Number(totals.rows[0]?.superusers ?? 0),
    activeConnections,
    recentUsers: recent.rows.map((row) => ({
      name: row.rolname,
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    })),
  };
}

/** Cheap read for surfaces that only need the role list + admin flag (see `RolesSidebarSummary`). */
async function buildSidebarSummary(
  connectionId: string,
): Promise<RolesSidebarSummary> {
  return withPoolClient(connectionId, async (client) => {
    const currentUserRow = await getCurrentUser(client);
    const isSuperuser = currentUserRow.rolsuper;
    const roles = await fetchRoles(
      client,
      isSuperuser ? undefined : currentUserRow.rolname,
    );
    return {
      currentUser: {
        name: currentUserRow.rolname,
        isSuperuser,
        canLogin: currentUserRow.rolcanlogin,
        canCreateRole: currentUserRow.rolcreaterole,
        canCreateDb: currentUserRow.rolcreatedb,
      },
      roles,
    };
  });
}

async function buildSnapshot(
  connectionId: string,
  targetUserOverride?: string,
): Promise<RolesSnapshot> {
  return withPoolClient(connectionId, async (client) => {
    const currentUserRow = await getCurrentUser(client);
    const isSuperuser = currentUserRow.rolsuper;

    const targetUser =
      isSuperuser && targetUserOverride
        ? targetUserOverride
        : currentUserRow.rolname;

    const restrictToSelf = !isSuperuser;
    const effectiveTargetUser = restrictToSelf
      ? currentUserRow.rolname
      : targetUser;

    const roles = await fetchRoles(
      client,
      restrictToSelf ? currentUserRow.rolname : undefined,
    );
    const memberships = await fetchMemberships(
      client,
      restrictToSelf ? currentUserRow.rolname : undefined,
    );
    const databasesRaw = await fetchDatabases(client, effectiveTargetUser);
    const databases = await computeEffectiveLevels(
      connectionId,
      databasesRaw,
      effectiveTargetUser,
    );
    const stats = await fetchDashboardStats(client);

    return {
      currentUser: {
        name: currentUserRow.rolname,
        isSuperuser,
        canLogin: currentUserRow.rolcanlogin,
        canCreateRole: currentUserRow.rolcreaterole,
        canCreateDb: currentUserRow.rolcreatedb,
      },
      roles,
      memberships,
      databases,
      targetUser: effectiveTargetUser,
      stats,
    };
  });
}

function resolveConnectionLabel(connectionId: string): string {
  const connection = getConnectionById(connectionId);
  return connection?.label ?? connectionId;
}

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

type RunMutationResult =
  | { success: true; data: undefined }
  | { success: false; error: string };

async function runMutation(
  connectionId: string,
  action: string,
  target: string,
  fn: () => Promise<void>,
): Promise<RunMutationResult> {
  const connectionLabel = resolveConnectionLabel(connectionId);
  try {
    await fn();
  } catch (err) {
    const error = (err as Error).message;
    const actor = await resolveActor(connectionId);
    logAudit({
      connectionId,
      connectionLabel,
      actor,
      action,
      target,
      success: false,
      error,
    });
    return { success: false, error };
  }
  const actor = await resolveActor(connectionId);
  logAudit({
    connectionId,
    connectionLabel,
    actor,
    action,
    target,
    success: true,
  });
  return { success: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function buildCreateRoleSql(input: {
  name: string;
  login: boolean;
  createRole?: boolean;
  createDb?: boolean;
  inherit?: boolean;
  connectionLimit?: number;
  /** Already `quote_literal()`-quoted (including its own surrounding quotes), or undefined for "no expiry given". */
  validUntilLiteral?: string;
}): string {
  const options: string[] = [];
  options.push(input.login ? "LOGIN" : "NOLOGIN");
  if (input.createRole !== undefined) {
    options.push(input.createRole ? "CREATEROLE" : "NOCREATEROLE");
  }
  if (input.createDb !== undefined) {
    options.push(input.createDb ? "CREATEDB" : "NOCREATEDB");
  }
  if (input.inherit !== undefined) {
    options.push(input.inherit ? "INHERIT" : "NOINHERIT");
  }
  if (input.connectionLimit !== undefined) {
    options.push(`CONNECTION LIMIT ${Number(input.connectionLimit)}`);
  }
  if (input.validUntilLiteral !== undefined) {
    options.push(`VALID UNTIL ${input.validUntilLiteral}`);
  }
  return `CREATE ROLE ${quoteIdent(input.name)} WITH ${options.join(" ")};`;
}

async function createRole(input: CreateRoleInput): Promise<void> {
  return withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);

    const validUntilLiteral =
      input.validUntil !== undefined && input.validUntil !== ""
        ? await quoteLiteral(client, input.validUntil)
        : undefined;
    const createSql = buildCreateRoleSql({
      name: input.name,
      login: input.login,
      createRole: input.createRole,
      createDb: input.createDb,
      inherit: input.inherit,
      connectionLimit: input.connectionLimit,
      validUntilLiteral,
    });
    await client.query(createSql);

    if (input.password && input.password.length > 0) {
      const literal = await quoteLiteral(client, input.password);
      await client.query(
        `ALTER ROLE ${quoteIdent(input.name)} PASSWORD ${literal};`,
      );
    }

    if (input.membershipRoles && input.membershipRoles.length > 0) {
      const grantList = input.membershipRoles
        .map((role) => quoteIdent(role))
        .join(", ");
      await client.query(
        `GRANT ${grantList} TO ${quoteIdent(input.name)};`,
      );
    }
  });
}

async function alterRole(input: AlterRoleInput): Promise<void> {
  return withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);

    const options: string[] = [];
    if (input.login !== undefined) {
      options.push(input.login ? "LOGIN" : "NOLOGIN");
    }
    if (input.createRole !== undefined) {
      options.push(input.createRole ? "CREATEROLE" : "NOCREATEROLE");
    }
    if (input.createDb !== undefined) {
      options.push(input.createDb ? "CREATEDB" : "NOCREATEDB");
    }
    if (input.connectionLimit !== undefined) {
      options.push(`CONNECTION LIMIT ${Number(input.connectionLimit)}`);
    }
    if (input.validUntil !== undefined) {
      if (input.validUntil === null || input.validUntil === "") {
        options.push("VALID UNTIL 'infinity'");
      } else {
        const literal = await quoteLiteral(client, input.validUntil);
        options.push(`VALID UNTIL ${literal}`);
      }
    }
    if (input.password !== undefined && input.password !== null) {
      const literal = await quoteLiteral(client, input.password);
      await client.query(
        `ALTER ROLE ${quoteIdent(input.name)} PASSWORD ${literal};`,
      );
    }
    if (options.length > 0) {
      await client.query(
        `ALTER ROLE ${quoteIdent(input.name)} WITH ${options.join(" ")};`,
      );
    }
  });
}

async function alterRolePasswordInternal(input: {
  connectionId: string;
  name: string;
  password: string;
}): Promise<void> {
  return withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);
    const literal = await quoteLiteral(client, input.password);
    await client.query(
      `ALTER ROLE ${quoteIdent(input.name)} PASSWORD ${literal};`,
    );
  });
}

async function alterRoleCommentInternal(input: {
  connectionId: string;
  name: string;
  comment: string | null;
}): Promise<void> {
  return withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);
    if (input.comment === null || input.comment.length === 0) {
      await client.query(`COMMENT ON ROLE ${quoteIdent(input.name)} IS NULL;`);
    } else {
      const literal = await quoteLiteral(client, input.comment);
      await client.query(
        `COMMENT ON ROLE ${quoteIdent(input.name)} IS ${literal};`,
      );
    }
  });
}

async function dropRole(connectionId: string, name: string): Promise<void> {
  return withPoolClient(connectionId, async (client) => {
    await requireSuperuser(client);
    await client.query(`DROP ROLE IF EXISTS ${quoteIdent(name)};`);
  });
}

async function cloneRole(input: CloneRoleInput): Promise<void> {
  return withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);

    const source = await client.query<PgRoleRow>(
      `SELECT rolname, rolsuper, rolcanlogin, rolcreaterole, rolcreatedb,
              rolinherit, rolconnlimit, rolvaliduntil, rolpassword,
              rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname = $1`,
      [input.sourceName],
    );
    const sourceRow = source.rows[0];
    if (!sourceRow) throw new Error(`Role "${input.sourceName}" not found.`);

    if (sourceRow.rolsuper) {
      throw new Error("Refusing to clone a superuser role.");
    }

    const options: string[] = [
      sourceRow.rolcanlogin ? "LOGIN" : "NOLOGIN",
      sourceRow.rolcreaterole ? "CREATEROLE" : "NOCREATEROLE",
      sourceRow.rolcreatedb ? "CREATEDB" : "NOCREATEDB",
      sourceRow.rolinherit ? "INHERIT" : "NOINHERIT",
      `CONNECTION LIMIT ${sourceRow.rolconnlimit}`,
    ];
    await client.query(
      `CREATE ROLE ${quoteIdent(input.newName)} WITH ${options.join(" ")};`,
    );

    const memberships = await client.query<PgMembershipRow>(
      `SELECT m.rolname AS member_name, r.rolname AS parent_name,
              am.admin_option
       FROM pg_auth_members am
       JOIN pg_roles m ON m.oid = am.member
       JOIN pg_roles r ON r.oid = am.roleid
       WHERE m.rolname = $1`,
      [input.sourceName],
    );
    for (const row of memberships.rows) {
      const adminClause = row.admin_option ? " WITH ADMIN OPTION" : "";
      await client.query(
        `GRANT ${quoteIdent(row.parent_name)} TO ${quoteIdent(input.newName)}${adminClause};`,
      );
    }
  });
}

async function renameRole(input: RenameRoleInput): Promise<void> {
  return withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);
    if (input.newName === input.oldName) return;
    await client.query(
      `ALTER ROLE ${quoteIdent(input.oldName)} RENAME TO ${quoteIdent(input.newName)};`,
    );
  });
}

// ---------------------------------------------------------------------------
// Database access abstraction (no access / read only / read + write)
// ---------------------------------------------------------------------------

// GRANT's explicit-table-list form doesn't accept a trailing "IN SCHEMA"
// clause (that clause only pairs with "ALL TABLES IN SCHEMA"), so callers
// must schema-qualify each name themselves.
function quoteQualifiedList(schema: string, names: string[]): string {
  return names
    .map((name) => `${quoteIdent(schema)}.${quoteIdent(name)}`)
    .join(", ");
}

async function fetchGrantableSchemas(client: Client): Promise<string[]> {
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

async function setDbAccessLevel(input: SetDbAccessLevelInput): Promise<void> {
  await withPoolClient(input.connectionId, requireSuperuser);

  const targetUser = quoteIdent(input.userName);
  const database = input.databaseName;

  return runInDatabase(input.connectionId, database, async (client) => {
    const schemas = await fetchGrantableSchemas(client);

    await client.query("BEGIN");
    try {
      // Always start by clearing previous grants the abstraction owns,
      // across every schema — not just `public` — so the level toggle is a
      // true database-wide reset.
      await client.query(
        `REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdent(database)} FROM ${targetUser};`,
      );
      for (const schemaName of schemas) {
        await client.query(
          `REVOKE ALL PRIVILEGES ON SCHEMA ${quoteIdent(schemaName)} FROM ${targetUser};`,
        );
        await client.query(
          `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${quoteIdent(schemaName)} FROM ${targetUser};`,
        );
        await client.query(
          `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${quoteIdent(schemaName)} FROM ${targetUser};`,
        );
        await client.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(schemaName)} REVOKE ALL ON TABLES FROM ${targetUser};`,
        );
        await client.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(schemaName)} REVOKE ALL ON SEQUENCES FROM ${targetUser};`,
        );
      }

      if (input.level === "none") {
        await client.query("COMMIT");
        return;
      }

      await client.query(
        `GRANT CONNECT ON DATABASE ${quoteIdent(database)} TO ${targetUser};`,
      );

      for (const schemaName of schemas) {
        await client.query(
          `GRANT USAGE ON SCHEMA ${quoteIdent(schemaName)} TO ${targetUser};`,
        );

        // restrictedTables is scoped to `public` only — it's addressed by
        // unqualified name and not currently wired up from the UI (table-
        // level scoping now goes through setTableRestrictions instead).
        if (input.level === "readonly") {
          if (input.restrictedTables && input.restrictedTables.length > 0) {
            if (schemaName === "public") {
              await client.query(
                `GRANT SELECT ON ${quoteQualifiedList(schemaName, input.restrictedTables)} TO ${targetUser};`,
              );
            }
          } else {
            await client.query(
              `GRANT SELECT ON ALL TABLES IN SCHEMA ${quoteIdent(schemaName)} TO ${targetUser};`,
            );
            await client.query(
              `GRANT SELECT ON ALL SEQUENCES IN SCHEMA ${quoteIdent(schemaName)} TO ${targetUser};`,
            );
            if (input.applyToFutureTables) {
              await client.query(
                `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(schemaName)} GRANT SELECT ON TABLES TO ${targetUser};`,
              );
              await client.query(
                `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(schemaName)} GRANT SELECT ON SEQUENCES TO ${targetUser};`,
              );
            }
          }
        }

        if (input.level === "readwrite") {
          if (input.restrictedTables && input.restrictedTables.length > 0) {
            if (schemaName === "public") {
              await client.query(
                `GRANT SELECT, INSERT, UPDATE, DELETE ON ${quoteQualifiedList(schemaName, input.restrictedTables)} TO ${targetUser};`,
              );
            }
          } else {
            await client.query(
              `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quoteIdent(schemaName)} TO ${targetUser};`,
            );
            await client.query(
              `GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA ${quoteIdent(schemaName)} TO ${targetUser};`,
            );
            if (input.applyToFutureTables) {
              await client.query(
                `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(schemaName)} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${targetUser};`,
              );
              await client.query(
                `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(schemaName)} GRANT SELECT, USAGE ON SEQUENCES TO ${targetUser};`,
              );
            }
          }
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  });
}

async function setTableRestrictions(
  input: TableRestrictionInput,
): Promise<void> {
  await withPoolClient(input.connectionId, requireSuperuser);

  const targetUser = quoteIdent(input.userName);

  const bySchema = new Map<
    string,
    Array<{ name: string; level: AccessLevel }>
  >();
  for (const table of input.tables) {
    const entries = bySchema.get(table.schema) ?? [];
    entries.push({ name: table.name, level: table.level });
    bySchema.set(table.schema, entries);
  }

  return runInDatabase(
    input.connectionId,
    input.databaseName,
    async (client) => {
      await client.query("BEGIN");
      try {
        for (const [schema, tables] of bySchema) {
          const readOnlyTables = tables
            .filter((t) => t.level === "readonly")
            .map((t) => t.name);
          const readWriteTables = tables
            .filter((t) => t.level === "readwrite")
            .map((t) => t.name);

          await client.query(
            `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${quoteIdent(schema)} FROM ${targetUser};`,
          );

          if (readOnlyTables.length > 0 || readWriteTables.length > 0) {
            // Table grants are inert without schema USAGE.
            await client.query(
              `GRANT USAGE ON SCHEMA ${quoteIdent(schema)} TO ${targetUser};`,
            );
          }
          if (readOnlyTables.length > 0) {
            await client.query(
              `GRANT SELECT ON ${quoteQualifiedList(schema, readOnlyTables)} TO ${targetUser};`,
            );
          }
          if (readWriteTables.length > 0) {
            await client.query(
              `GRANT SELECT, INSERT, UPDATE, DELETE ON ${quoteQualifiedList(schema, readWriteTables)} TO ${targetUser};`,
            );
          }
          // Per the spec: when table-level restrictions are in place, future
          // tables do NOT automatically receive permissions.
          await client.query(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(schema)} REVOKE ALL ON TABLES FROM ${targetUser};`,
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      }
    },
  );
}

async function grantMembership(input: MembershipInput): Promise<void> {
  return withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);
    const adminClause = input.withAdminOption ? " WITH ADMIN OPTION" : "";
    await client.query(
      `GRANT ${quoteIdent(input.parentRoleName)} TO ${quoteIdent(input.memberName)}${adminClause};`,
    );
  });
}

async function revokeMembership(input: MembershipInput): Promise<void> {
  return withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);
    await client.query(
      `REVOKE ${quoteIdent(input.parentRoleName)} FROM ${quoteIdent(input.memberName)};`,
    );
  });
}

async function grantDbConnect(input: {
  connectionId: string;
  userName: string;
  databaseName: string;
}): Promise<void> {
  return withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);
    await client.query(
      `GRANT CONNECT ON DATABASE ${quoteIdent(input.databaseName)} TO ${quoteIdent(input.userName)};`,
    );
  });
}

async function revokeDbConnect(input: {
  connectionId: string;
  userName: string;
  databaseName: string;
}): Promise<void> {
  return withPoolClient(input.connectionId, async (client) => {
    await requireSuperuser(client);
    await client.query(
      `REVOKE CONNECT ON DATABASE ${quoteIdent(input.databaseName)} FROM ${quoteIdent(input.userName)};`,
    );
  });
}

async function grantDbReadonly(input: {
  connectionId: string;
  userName: string;
  databaseName: string;
  schema?: string;
}): Promise<void> {
  await withPoolClient(input.connectionId, requireSuperuser);

  const schema = input.schema && input.schema.length > 0 ? input.schema : "public";
  return runInDatabase(
    input.connectionId,
    input.databaseName,
    async (client) => {
      await client.query(
        `GRANT CONNECT ON DATABASE ${quoteIdent(input.databaseName)} TO ${quoteIdent(input.userName)};`,
      );
      await client.query(
        `GRANT USAGE ON SCHEMA ${quoteIdent(schema)} TO ${quoteIdent(input.userName)};`,
      );
      await client.query(
        `GRANT SELECT ON ALL TABLES IN SCHEMA ${quoteIdent(schema)} TO ${quoteIdent(input.userName)};`,
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(schema)} GRANT SELECT ON TABLES TO ${quoteIdent(input.userName)};`,
      );
    },
  );
}

async function revokeDbReadonly(input: {
  connectionId: string;
  userName: string;
  databaseName: string;
  schema?: string;
}): Promise<void> {
  await withPoolClient(input.connectionId, requireSuperuser);

  const schema = input.schema && input.schema.length > 0 ? input.schema : "public";
  return runInDatabase(
    input.connectionId,
    input.databaseName,
    async (client) => {
      await client.query(
        `REVOKE SELECT ON ALL TABLES IN SCHEMA ${quoteIdent(schema)} FROM ${quoteIdent(input.userName)};`,
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(schema)} REVOKE SELECT ON TABLES FROM ${quoteIdent(input.userName)};`,
      );
      await client.query(
        `REVOKE USAGE ON SCHEMA ${quoteIdent(schema)} FROM ${quoteIdent(input.userName)};`,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

async function listTriggers(
  connectionId: string,
  database: string,
): Promise<PgTriggerInfo[]> {
  await withPoolClient(connectionId, requireSuperuser);

  return runInDatabase(connectionId, database, async (client) => {
    const result = await client.query<PgTriggerRow>(`
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        t.tgname AS trigger_name,
        -- tgtype bits: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16,
        -- TRUNCATE=32, INSTEAD=64. BEFORE/INSTEAD are mutually exclusive;
        -- AFTER is the default when neither is set. INSERT/UPDATE/DELETE/
        -- TRUNCATE are independent bits a trigger can combine, so they're
        -- decoded (and joined) separately rather than picked with CASE.
        CASE
          WHEN (t.tgtype & 64) <> 0 THEN 'INSTEAD OF'
          WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE'
          ELSE 'AFTER'
        END AS timing,
        concat_ws(',',
          CASE WHEN (t.tgtype & 4) <> 0 THEN 'INSERT' END,
          CASE WHEN (t.tgtype & 8) <> 0 THEN 'DELETE' END,
          CASE WHEN (t.tgtype & 16) <> 0 THEN 'UPDATE' END,
          CASE WHEN (t.tgtype & 32) <> 0 THEN 'TRUNCATE' END
        ) AS events,
        p.proname AS function_name,
        pn.nspname AS function_schema,
        CASE t.tgenabled
          WHEN 'O' THEN 'origin'
          WHEN 'D' THEN 'disabled'
          WHEN 'R' THEN 'replica'
          WHEN 'A' THEN 'always'
          ELSE 'origin'
        END AS enabled_mode,
        CASE WHEN (t.tgtype & 1) <> 0 THEN 'ROW' ELSE 'STATEMENT' END AS orientation
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace pn ON pn.oid = p.pronamespace
      WHERE NOT t.tgisinternal
      ORDER BY n.nspname, c.relname, t.tgname
    `);
    return result.rows.map((row) => ({
      schemaName: row.schema_name,
      tableName: row.table_name,
      triggerName: row.trigger_name,
      timing: row.timing,
      events: row.events,
      functionName: row.function_name,
      functionSchema: row.function_schema,
      enabled: row.enabled_mode !== "disabled",
      enabledMode: row.enabled_mode,
      orientation: row.orientation,
    }));
  });
}

async function createTrigger(input: CreateTriggerInput): Promise<void> {
  await withPoolClient(input.connectionId, requireSuperuser);

  return runInDatabase(
    input.connectionId,
    input.databaseName,
    async (client) => {
      await client.query("BEGIN");
      try {
        const eventClause =
          input.orientation === "ROW"
            ? input.events.join(" OR ")
            : "TRUNCATE";
        // Trigger function arguments belong inside the EXECUTE FUNCTION
        // call's own parentheses — CREATE TRIGGER has no "USING" clause,
        // so the previous form was a guaranteed syntax error. quoteLiteral
        // (not manual escaping) since this value is user-authored text
        // spliced into DDL that can't accept a bound parameter.
        const args = input.functionArgs
          ? await quoteLiteral(client, input.functionArgs)
          : "";
        const sql = `CREATE TRIGGER ${quoteIdent(input.triggerName)} ${input.timing} ${eventClause} ON ${quoteIdent(input.schemaName)}.${quoteIdent(input.tableName)} FOR EACH ${input.orientation} EXECUTE FUNCTION ${quoteIdent(input.functionSchema)}.${quoteIdent(input.functionName)}(${args});`;
        await client.query(sql);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      }
    },
  );
}

async function dropTrigger(input: DropTriggerInput): Promise<void> {
  await withPoolClient(input.connectionId, requireSuperuser);

  return runInDatabase(
    input.connectionId,
    input.databaseName,
    async (client) => {
      await client.query(
        `DROP TRIGGER IF EXISTS ${quoteIdent(input.triggerName)} ON ${quoteIdent(input.schemaName)}.${quoteIdent(input.tableName)};`,
      );
    },
  );
}

async function setTriggerEnabled(input: SetTriggerEnabledInput): Promise<void> {
  await withPoolClient(input.connectionId, requireSuperuser);

  return runInDatabase(
    input.connectionId,
    input.databaseName,
    async (client) => {
      const verb = input.enabled ? "ENABLE" : "DISABLE";
      await client.query(
        `ALTER TABLE ${quoteIdent(input.schemaName)}.${quoteIdent(input.tableName)} ${verb} TRIGGER ${quoteIdent(input.triggerName)};`,
      );
    },
  );
}

async function listTriggerFunctions(
  connectionId: string,
  database: string,
): Promise<PgTriggerFunction[]> {
  await withPoolClient(connectionId, requireSuperuser);

  return runInDatabase(connectionId, database, async (client) => {
    const result = await client.query<PgTriggerFunctionRow>(`
      SELECT
        n.nspname AS schema_name,
        p.proname AS function_name,
        pg_get_functiondef(p.oid) AS source
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prorettype = 2279
        AND n.nspname NOT IN ('pg_catalog')
      ORDER BY n.nspname, p.proname
    `);
    return result.rows.map((row) => ({
      schemaName: row.schema_name,
      functionName: row.function_name,
      source: row.source,
    }));
  });
}

async function createTriggerFunction(
  input: CreateTriggerFunctionInput,
): Promise<void> {
  await withPoolClient(input.connectionId, requireSuperuser);

  return runInDatabase(
    input.connectionId,
    input.databaseName,
    async (client) => {
      // Extended protocol rejects multiple top-level statements in one Parse,
      // so a renderer-supplied body can't stack extra commands after the
      // CREATE FUNCTION it's supposed to contain.
      await client.query(extendedQuery(input.source));
    },
  );
}

// ---------------------------------------------------------------------------
// Effective permissions
// ---------------------------------------------------------------------------

async function getEffectivePermissions(
  connectionId: string,
  user: string,
): Promise<EffectivePermissions> {
  return withPoolClient(connectionId, async (client) => {
    await requireSuperuser(client);

    const dbs = await client.query<{ datname: string }>(`
      SELECT datname FROM pg_database WHERE datallowconn ORDER BY datname
    `);
    const accessResult: Array<{ name: string; level: AccessLevel }> = [];
    for (const row of dbs.rows) {
      const canConnect = await client.query(
        `SELECT has_database_privilege($1, $2, 'CONNECT') AS ok`,
        [user, row.datname],
      );
      if (!canConnect.rows[0]?.ok) {
        accessResult.push({ name: row.datname, level: "none" });
        continue;
      }

      const access = await computeDbAccess(connectionId, row.datname, user);
      accessResult.push({ name: row.datname, level: access.level });
    }

    const inheritedSet = new Set<string>();
    const visited = new Set<string>();
    const queue = [user];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const result = await client.query<{ parent_name: string }>(
        `SELECT r.rolname AS parent_name
         FROM pg_auth_members am
         JOIN pg_roles m ON m.oid = am.member
         JOIN pg_roles r ON r.oid = am.roleid
         WHERE m.rolname = $1`,
        [current],
      );
      for (const parentRow of result.rows) {
        if (!inheritedSet.has(parentRow.parent_name)) {
          inheritedSet.add(parentRow.parent_name);
        }
        queue.push(parentRow.parent_name);
      }
    }
    const inheritedRoles = Array.from(inheritedSet).sort();

    let readableTables: EffectivePermissions["readableTables"] = [];
    let writableTables: EffectivePermissions["writableTables"] = [];
    try {
      const tables = await client.query<PgTableSelectRow>(
        `
        SELECT
          table_schema,
          table_name,
          has_table_privilege(
            $1,
            quote_ident(table_schema) || '.' || quote_ident(table_name),
            'SELECT'
          ) AS has_select,
          has_table_privilege(
            $1,
            quote_ident(table_schema) || '.' || quote_ident(table_name),
            'INSERT,UPDATE,DELETE'
          ) AS has_write
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          AND table_type = 'BASE TABLE'
        ORDER BY table_schema, table_name
      `,
        [user],
      );
      readableTables = tables.rows
        .filter((r) => Boolean(r.has_select))
        .map((r) => ({
          schemaName: r.table_schema,
          tableName: r.table_name,
        }));
      writableTables = tables.rows
        .filter((r) => Boolean(r.has_write))
        .map((r) => ({
          schemaName: r.table_schema,
          tableName: r.table_name,
        }));
    } catch {
      // If we cannot evaluate privileges, leave the table lists empty.
    }

    return {
      user,
      databases: accessResult,
      readableTables,
      writableTables,
      inheritedRoles,
    };
  });
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

export function registerRolesHandlers(): void {
  registerIpcHandler(
    RolesChannels.GET_SNAPSHOT,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateRolesSnapshotInput(rawInput);
        const snapshot = await buildSnapshot(
          input.connectionId,
          input.targetUser,
        );
        return { success: true, data: snapshot };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.GET_SIDEBAR_SUMMARY,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateConnectionIdInput(rawInput);
        const summary = await buildSidebarSummary(input.connectionId);
        return { success: true, data: summary };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.CREATE_ROLE,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateCreateRoleInput(rawInput);
        return await runMutation(
          input.connectionId,
          "create-role",
          `role "${input.name}"`,
          () => createRole(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.ALTER_ROLE,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateAlterRoleInput(rawInput);
        return await runMutation(
          input.connectionId,
          "alter-role",
          `role "${input.name}"`,
          () => alterRole(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.ALTER_ROLE_PASSWORD,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateAlterRolePasswordInput(rawInput);
        return await runMutation(
          input.connectionId,
          "alter-role-password",
          `role "${input.name}"`,
          () =>
            alterRolePasswordInternal({
              connectionId: input.connectionId,
              name: input.name,
              password: input.password,
            }),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.ALTER_ROLE_COMMENT,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateAlterRoleCommentInput(rawInput);
        return await runMutation(
          input.connectionId,
          "alter-role-comment",
          `role "${input.name}"`,
          () =>
            alterRoleCommentInternal({
              connectionId: input.connectionId,
              name: input.name,
              comment: input.comment,
            }),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.DROP_ROLE,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateDropRoleInput(rawInput);
        return await runMutation(
          input.connectionId,
          "drop-role",
          `role "${input.name}"`,
          () => dropRole(input.connectionId, input.name),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.CLONE_ROLE,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateCloneRoleInput(rawInput);
        return await runMutation(
          input.connectionId,
          "clone-role",
          `"${input.sourceName}" → "${input.newName}"`,
          () => cloneRole(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.RENAME_ROLE,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateRenameRoleInput(rawInput);
        return await runMutation(
          input.connectionId,
          "rename-role",
          `"${input.oldName}" → "${input.newName}"`,
          () => renameRole(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.GRANT_MEMBERSHIP,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateMembershipInput(rawInput);
        return await runMutation(
          input.connectionId,
          "grant-membership",
          `"${input.memberName}" ← "${input.parentRoleName}"`,
          () => grantMembership(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.REVOKE_MEMBERSHIP,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateMembershipInput(rawInput);
        return await runMutation(
          input.connectionId,
          "revoke-membership",
          `"${input.memberName}" ← "${input.parentRoleName}"`,
          () => revokeMembership(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.GRANT_DB_CONNECT,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateDbAccessInput(rawInput);
        return await runMutation(
          input.connectionId,
          "grant-db-connect",
          `user "${input.userName}", database "${input.databaseName}"`,
          () => grantDbConnect(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.REVOKE_DB_CONNECT,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateDbAccessInput(rawInput);
        return await runMutation(
          input.connectionId,
          "revoke-db-connect",
          `user "${input.userName}", database "${input.databaseName}"`,
          () => revokeDbConnect(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.GRANT_DB_READONLY,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateDbReadonlyGrantInput(rawInput);
        return await runMutation(
          input.connectionId,
          "grant-db-readonly",
          `user "${input.userName}", database "${input.databaseName}"`,
          () => grantDbReadonly(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.REVOKE_DB_READONLY,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateDbReadonlyGrantInput(rawInput);
        return await runMutation(
          input.connectionId,
          "revoke-db-readonly",
          `user "${input.userName}", database "${input.databaseName}"`,
          () => revokeDbReadonly(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.SET_DB_ACCESS_LEVEL,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateSetDbAccessLevelInput(rawInput);
        return await runMutation(
          input.connectionId,
          "set-db-access-level",
          `user "${input.userName}", database "${input.databaseName}" → ${input.level}`,
          () => setDbAccessLevel(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.SET_TABLE_RESTRICTIONS,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateTableRestrictionInput(rawInput);
        return await runMutation(
          input.connectionId,
          "set-table-restrictions",
          `user "${input.userName}", database "${input.databaseName}"`,
          () => setTableRestrictions(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.LIST_TRIGGERS,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateTriggerListInput(rawInput);
        const triggers = await listTriggers(
          input.connectionId,
          input.databaseName,
        );
        return { success: true, data: triggers };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.CREATE_TRIGGER,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateCreateTriggerInput(rawInput);
        return await runMutation(
          input.connectionId,
          "create-trigger",
          `${input.schemaName}.${input.tableName}.${input.triggerName}`,
          () => createTrigger(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.DROP_TRIGGER,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateDropTriggerInput(rawInput);
        return await runMutation(
          input.connectionId,
          "drop-trigger",
          `${input.schemaName}.${input.tableName}.${input.triggerName}`,
          () => dropTrigger(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.SET_TRIGGER_ENABLED,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateSetTriggerEnabledInput(rawInput);
        return await runMutation(
          input.connectionId,
          input.enabled ? "enable-trigger" : "disable-trigger",
          `${input.schemaName}.${input.tableName}.${input.triggerName}`,
          () => setTriggerEnabled(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.LIST_TRIGGER_FUNCTIONS,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateTriggerListInput(rawInput);
        const functions = await listTriggerFunctions(
          input.connectionId,
          input.databaseName,
        );
        return { success: true, data: functions };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.CREATE_TRIGGER_FUNCTION,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateCreateTriggerFunctionInput(rawInput);
        return await runMutation(
          input.connectionId,
          "create-trigger-function",
          `${input.schemaName}.${input.functionName}`,
          () => createTriggerFunction(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.GET_EFFECTIVE_PERMISSIONS,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateConnectionUserInput(rawInput);
        const data = await getEffectivePermissions(
          input.connectionId,
          input.user,
        );
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.GET_AUDIT_LOG,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateConnectionIdInput(rawInput);
        const entries: AuditLogEntry[] = getAuditLog(input.connectionId);
        return { success: true, data: entries };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.CLEAR_AUDIT_LOG,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateConnectionIdInput(rawInput);
        clearAuditLog(input.connectionId);
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );
}