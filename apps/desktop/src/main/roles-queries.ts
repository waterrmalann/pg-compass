import type { ClientBase } from "pg";
import type {
  AccessLevel,
  CurrentUser,
  DashboardStats,
  EffectivePermissions,
  PgDatabaseInfo,
  PgMembership,
  PgRole,
  PgTableAccess,
  RolesSidebarSummary,
  RolesSnapshot,
} from "../shared/types/roles";
import { withDatabaseClient, withPoolClient } from "./pg-utils";

// ---------------------------------------------------------------------------
// Row shapes
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
  has_password: boolean | null;
  rolreplication: boolean;
  rolbypassrls: boolean;
  description: string | null;
}

interface PgDatabaseRow {
  datname: string;
  datistemplate: boolean;
  datallowconn: boolean;
  owner: string;
  size: string | null;
  role_count: number | null;
  can_connect: boolean;
  can_create: boolean;
  can_temp: boolean;
}

interface PgSchemaUsageRow {
  schema_name: string;
  has_usage: boolean;
}

interface PgTablePrivilegeRow {
  table_schema: string;
  table_name: string;
  has_select: boolean;
  has_write: boolean;
}

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

export async function getCurrentUser(
  client: ClientBase,
): Promise<PgCurrentUserRow> {
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

/** Server-side gate for every admin action; the renderer's gating is cosmetic. */
export async function requireSuperuser(client: ClientBase): Promise<void> {
  const user = await getCurrentUser(client);
  if (!user.rolsuper) {
    throw new Error("This action requires a PostgreSQL superuser connection.");
  }
}

function toCurrentUser(row: PgCurrentUserRow): CurrentUser {
  return {
    name: row.rolname,
    isSuperuser: row.rolsuper,
    canLogin: row.rolcanlogin,
    canCreateRole: row.rolcreaterole,
    canCreateDb: row.rolcreatedb,
  };
}

// ---------------------------------------------------------------------------
// Roles and memberships
// ---------------------------------------------------------------------------

/**
 * Superusers read every role; everyone else reads only their own row.
 * `pg_roles.rolpassword` is always masked, so whether a password is set can
 * only be read from `pg_authid`, which is superuser-only — hence null.
 */
async function fetchRoles(
  client: ClientBase,
  currentUser: PgCurrentUserRow,
): Promise<PgRole[]> {
  const isSuperuser = currentUser.rolsuper;
  const hasPasswordSql = isSuperuser
    ? "(SELECT a.rolpassword IS NOT NULL FROM pg_authid a WHERE a.oid = r.oid)"
    : "NULL::boolean";
  const filterSql = isSuperuser ? "" : "WHERE r.rolname = $1";
  const params = isSuperuser ? [] : [currentUser.rolname];

  const result = await client.query<PgRoleRow>(
    `
    SELECT
      r.rolname,
      r.rolsuper,
      r.rolcanlogin,
      r.rolcreaterole,
      r.rolcreatedb,
      r.rolinherit,
      r.rolconnlimit,
      r.rolvaliduntil,
      ${hasPasswordSql} AS has_password,
      r.rolreplication,
      r.rolbypassrls,
      pg_catalog.shobj_description(r.oid, 'pg_authid') AS description
    FROM pg_roles r
    ${filterSql}
    ORDER BY r.rolcanlogin DESC, r.rolname
  `,
    params,
  );

  return result.rows.map((row) => ({
    name: row.rolname,
    isSuperuser: row.rolsuper,
    canLogin: row.rolcanlogin,
    canCreateRole: row.rolcreaterole,
    canCreateDb: row.rolcreatedb,
    inherit: row.rolinherit,
    connectionLimit: row.rolconnlimit,
    validUntil: row.rolvaliduntil ? row.rolvaliduntil.toISOString() : null,
    hasPassword: row.has_password,
    canReplicate: row.rolreplication,
    canBypassRls: row.rolbypassrls,
    description: row.description,
  }));
}

export async function fetchMemberships(
  client: ClientBase,
  filterForMember?: string,
): Promise<PgMembership[]> {
  const filterSql = filterForMember ? "WHERE m.rolname = $1" : "";
  const params = filterForMember ? [filterForMember] : [];
  const result = await client.query<{
    member_name: string;
    parent_name: string;
    admin_option: boolean;
  }>(
    `
    SELECT
      m.rolname AS member_name,
      r.rolname AS parent_name,
      am.admin_option
    FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles r ON r.oid = am.roleid
    ${filterSql}
    ORDER BY r.rolname, m.rolname
  `,
    params,
  );
  return result.rows.map((row) => ({
    memberName: row.member_name,
    parentName: row.parent_name,
    withAdminOption: row.admin_option,
  }));
}

// ---------------------------------------------------------------------------
// Databases and per-database access
// ---------------------------------------------------------------------------

async function fetchDatabases(
  client: ClientBase,
  targetUser: string,
): Promise<PgDatabaseInfo[]> {
  const result = await client.query<PgDatabaseRow>(
    `
    SELECT
      d.datname,
      d.datistemplate,
      d.datallowconn,
      pg_catalog.pg_get_userbyid(d.datdba) AS owner,
      -- pg_database_size() errors without CONNECT; CASE short-circuits it.
      CASE
        WHEN has_database_privilege(d.datname, 'CONNECT')
          THEN pg_size_pretty(pg_database_size(d.datname))
      END AS size,
      (
        SELECT COUNT(DISTINCT acl.grantee)::int
        FROM aclexplode(
          COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))
        ) acl
      ) AS role_count,
      has_database_privilege($1, d.datname, 'CONNECT') AS can_connect,
      has_database_privilege($1, d.datname, 'CREATE') AS can_create,
      has_database_privilege($1, d.datname, 'TEMPORARY') AS can_temp
    FROM pg_database d
    WHERE d.datallowconn
    ORDER BY d.datname
  `,
    [targetUser],
  );

  return result.rows.map((row) => ({
    name: row.datname,
    owner: row.owner,
    size: row.size,
    // Schemas are a per-database catalog: filled in by
    // computeEffectiveLevels only for databases it can actually reach.
    schemaCount: null,
    roleCount: Number(row.role_count ?? 0),
    isTemplate: row.datistemplate,
    allowConnections: row.datallowconn,
    canConnect: row.can_connect,
    canCreate: row.can_create,
    canTemp: row.can_temp,
    level: "none",
    tables: [],
  }));
}

/**
 * Per-table privileges of role `$1` across every non-system schema. pg_class
 * lists every table regardless of the session role's own privileges
 * (information_schema.tables would hide some).
 */
const TABLE_PRIVILEGES_SQL = `
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
`;

interface DbAccessEvaluation {
  level: AccessLevel;
  tables: PgTableAccess[];
  /** Non-system schema count, read while connected to the database. */
  schemaCount: number;
}

function resolveTableLevel(
  row: PgTablePrivilegeRow,
  hasUsage: boolean,
): AccessLevel {
  // A table grant is inert without schema USAGE.
  if (!hasUsage) return "none";
  if (row.has_write) return "readwrite";
  if (row.has_select) return "readonly";
  return "none";
}

function resolveDatabaseLevel(tables: PgTableAccess[]): AccessLevel {
  if (tables.length === 0) return "none";
  const hasAnyWrite = tables.some((table) => table.level === "readwrite");
  if (hasAnyWrite) return "readwrite";
  const allReadable = tables.every((table) => table.level !== "none");
  if (allReadable) return "readonly";
  return "none";
}

async function computeDbAccess(
  connectionId: string,
  database: string,
  userName: string,
): Promise<DbAccessEvaluation> {
  return withDatabaseClient(connectionId, database, async (client) => {
    const usageResult = await client.query<PgSchemaUsageRow>(
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

    const tableResult = await client.query<PgTablePrivilegeRow>(
      TABLE_PRIVILEGES_SQL,
      [userName],
    );

    const tables: PgTableAccess[] = tableResult.rows.map((row) => {
      const hasUsage = usageBySchema.get(row.table_schema) ?? false;
      return {
        schemaName: row.table_schema,
        tableName: row.table_name,
        level: resolveTableLevel(row, hasUsage),
      };
    });

    return {
      level: resolveDatabaseLevel(tables),
      tables,
      schemaCount: usageResult.rows.length,
    };
  });
}

/**
 * Evaluates each database over its own connection. A database that cannot be
 * reached (no CONNECT, pg_hba rules, connection limits, dropped mid-scan) is
 * reported as "none" instead of failing the whole snapshot.
 */
async function computeEffectiveLevels(
  connectionId: string,
  databases: PgDatabaseInfo[],
  targetUser: string,
): Promise<PgDatabaseInfo[]> {
  const result: PgDatabaseInfo[] = [];
  for (const database of databases) {
    if (!database.canConnect) {
      result.push(database);
      continue;
    }
    try {
      const access = await computeDbAccess(
        connectionId,
        database.name,
        targetUser,
      );
      result.push({
        ...database,
        level: access.level,
        tables: access.tables,
        schemaCount: access.schemaCount,
      });
    } catch {
      result.push(database);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

/** Counts only: no role names, so non-superusers learn nothing about others. */
async function fetchDashboardStats(
  client: ClientBase,
): Promise<DashboardStats> {
  const totals = await client.query<{
    total_roles: number;
    total_users: number;
    superusers: number;
    total_databases: number;
  }>(`
    SELECT
      COUNT(*)::int AS total_roles,
      COUNT(*) FILTER (WHERE rolcanlogin)::int AS total_users,
      COUNT(*) FILTER (WHERE rolsuper)::int AS superusers,
      (SELECT COUNT(*)::int FROM pg_database WHERE datallowconn)
        AS total_databases
    FROM pg_roles
  `);
  const totalsRow = totals.rows[0];

  let activeConnections = -1;
  try {
    const activity = await client.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count
      FROM pg_stat_activity
      WHERE state IS NOT NULL
    `);
    activeConnections = Number(activity.rows[0]?.count ?? -1);
  } catch {
    activeConnections = -1;
  }

  return {
    totalDatabases: Number(totalsRow?.total_databases ?? 0),
    totalRoles: Number(totalsRow?.total_roles ?? 0),
    totalUsers: Number(totalsRow?.total_users ?? 0),
    superusersCount: Number(totalsRow?.superusers ?? 0),
    activeConnections,
  };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/** Cheap read for surfaces that only need the role list + admin flag. */
export async function buildSidebarSummary(
  connectionId: string,
): Promise<RolesSidebarSummary> {
  return withPoolClient(connectionId, async (client) => {
    const currentUserRow = await getCurrentUser(client);
    const roles = await fetchRoles(client, currentUserRow);
    return { currentUser: toCurrentUser(currentUserRow), roles };
  });
}

/**
 * Superusers see every principal and may evaluate privileges for any
 * `targetUserOverride`; everyone else only sees themselves. The pooled client
 * is released before the per-database connections are opened.
 */
export async function buildSnapshot(
  connectionId: string,
  targetUserOverride?: string,
): Promise<RolesSnapshot> {
  const serverState = await withPoolClient(connectionId, async (client) => {
    const currentUserRow = await getCurrentUser(client);
    const isSuperuser = currentUserRow.rolsuper;
    const targetUser =
      isSuperuser && targetUserOverride
        ? targetUserOverride
        : currentUserRow.rolname;
    const membershipFilter = isSuperuser ? undefined : currentUserRow.rolname;

    return {
      currentUserRow,
      targetUser,
      roles: await fetchRoles(client, currentUserRow),
      memberships: await fetchMemberships(client, membershipFilter),
      databases: await fetchDatabases(client, targetUser),
      stats: await fetchDashboardStats(client),
    };
  });

  const databases = await computeEffectiveLevels(
    connectionId,
    serverState.databases,
    serverState.targetUser,
  );

  return {
    currentUser: toCurrentUser(serverState.currentUserRow),
    roles: serverState.roles,
    memberships: serverState.memberships,
    databases,
    targetUser: serverState.targetUser,
    stats: serverState.stats,
  };
}

// ---------------------------------------------------------------------------
// Effective permissions
// ---------------------------------------------------------------------------

async function fetchInheritedRoles(
  client: ClientBase,
  user: string,
): Promise<string[]> {
  const inherited = new Set<string>();
  const visited = new Set<string>();
  const queue = [user];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const parents = await fetchMemberships(client, current);
    for (const membership of parents) {
      inherited.add(membership.parentName);
      queue.push(membership.parentName);
    }
  }
  return Array.from(inherited).sort();
}

async function fetchTablePrivileges(
  client: ClientBase,
  user: string,
): Promise<PgTablePrivilegeRow[]> {
  try {
    const result = await client.query<PgTablePrivilegeRow>(
      TABLE_PRIVILEGES_SQL,
      [user],
    );
    return result.rows;
  } catch {
    // Privileges that cannot be evaluated leave the table lists empty.
    return [];
  }
}

export async function getEffectivePermissions(
  connectionId: string,
  user: string,
): Promise<EffectivePermissions> {
  const serverState = await withPoolClient(connectionId, async (client) => {
    await requireSuperuser(client);
    const databases = await client.query<{
      datname: string;
      can_connect: boolean;
    }>(
      `
      SELECT datname, has_database_privilege($1, datname, 'CONNECT') AS can_connect
      FROM pg_database
      WHERE datallowconn
      ORDER BY datname
    `,
      [user],
    );
    return {
      databases: databases.rows,
      inheritedRoles: await fetchInheritedRoles(client, user),
      tables: await fetchTablePrivileges(client, user),
    };
  });

  const databaseLevels: EffectivePermissions["databases"] = [];
  for (const database of serverState.databases) {
    if (!database.can_connect) {
      databaseLevels.push({ name: database.datname, level: "none" });
      continue;
    }
    try {
      const access = await computeDbAccess(
        connectionId,
        database.datname,
        user,
      );
      databaseLevels.push({ name: database.datname, level: access.level });
    } catch {
      databaseLevels.push({ name: database.datname, level: "none" });
    }
  }

  const toTableRef = (row: PgTablePrivilegeRow) => ({
    schemaName: row.table_schema,
    tableName: row.table_name,
  });

  return {
    user,
    databases: databaseLevels,
    readableTables: serverState.tables
      .filter((row) => row.has_select)
      .map(toTableRef),
    writableTables: serverState.tables
      .filter((row) => row.has_write)
      .map(toTableRef),
    inheritedRoles: serverState.inheritedRoles,
  };
}
