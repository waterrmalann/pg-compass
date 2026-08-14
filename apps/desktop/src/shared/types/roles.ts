/**
 * Shared types for PostgreSQL roles / users management.
 *
 * PostgreSQL models both "users" (login roles) and "groups" (non-login roles)
 * as rows in `pg_roles`. A role with `rolcanlogin = true` is a user that can
 * connect; otherwise it is a group role whose only purpose is to bundle
 * privileges that are granted to its members.
 */

export interface PgRole {
  name: string;
  isSuperuser: boolean;
  canLogin: boolean;
  canCreateRole: boolean;
  canCreateDb: boolean;
  inherit: boolean;
  connectionLimit: number;
  /** ISO-8601 expiry timestamp, or null when the role never expires. */
  validUntil: string | null;
  hasPassword: boolean;
  canReplicate: boolean;
  canBypassRls: boolean;
  /** COMMENT ON ROLE text, or null when the role has no comment set. */
  description: string | null;
}

export interface PgMembership {
  /** Role that is the member of `parentName`. */
  memberName: string;
  /** Role whose privileges `memberName` inherits. */
  parentName: string;
  withAdminOption: boolean;
}

export interface PgDatabaseInfo {
  name: string;
  isTemplate: boolean;
  allowConnections: boolean;
  /** Owner of the database. */
  owner: string;
  /** Pretty-printed size (e.g. "12 MB"). */
  size: string | null;
  /**
   * Number of non-system schemas, read while actually connected to this
   * database (schemas are a per-database catalog). Null when the snapshot
   * couldn't connect to this database (no CONNECT privilege, or the
   * connection attempt failed) — never a stand-in for another database's
   * count.
   */
  schemaCount: number | null;
  /** Number of roles whose grants include CONNECT on this database. */
  roleCount: number;
  /** Privileges evaluated for the snapshot's `targetUser`. */
  canConnect: boolean;
  canCreate: boolean;
  canTemp: boolean;
  /**
   * Resolved access level the snapshot's `targetUser` has across every
   * schema in this database. `none` means no CONNECT (or no table grants);
   * `readonly` means SELECT on every table; `readwrite` means at least one
   * table has INSERT/UPDATE/DELETE.
   */
  level: AccessLevel;
  /** Per-table access across every non-system schema in this database. */
  tables: PgTableAccess[];
}

export interface PgTableAccess {
  schemaName: string;
  tableName: string;
  /** Resolved per-table level for the snapshot's `targetUser`. */
  level: AccessLevel;
}

/**
 * Three permission levels the UI exposes per (database, user). The underlying
 * PostgreSQL GRANT/REVOKE cascade is owned by the RBAC service.
 */
export type AccessLevel = "none" | "readonly" | "readwrite";

export interface CurrentUser {
  name: string;
  isSuperuser: boolean;
  canLogin: boolean;
  canCreateRole: boolean;
  canCreateDb: boolean;
}

export interface DashboardStats {
  totalDatabases: number;
  totalRoles: number;
  /** Roles with `rolcanlogin = true`. */
  totalUsers: number;
  /** Roles with `rolsuper = true`. */
  superusersCount: number;
  /**
   * Number of active sessions in the connection's database. Reuse pg_stat_activity.
   * `-1` when the activity view is unavailable (privilege-restricted connection).
   */
  activeConnections: number;
  /** Roles created within the past 7 days, sorted newest-first. */
  recentUsers: Array<{ name: string; createdAt: string }>;
}

/**
 * Cheap subset of `RolesSnapshot` for surfaces (e.g. the sidebar) that only
 * need the role count/list and admin flag — skips the memberships fetch and
 * the per-database connection scan (`databases`/`stats`) that make the full
 * snapshot expensive on servers with many databases.
 */
export interface RolesSidebarSummary {
  currentUser: CurrentUser;
  roles: PgRole[];
}

export interface RolesSnapshot {
  currentUser: CurrentUser;
  /**
   * All roles for superusers; for non-superusers, only the current user's own
   * role row so the renderer never exposes other principals.
   */
  roles: PgRole[];
  /**
   * All memberships for superusers; for non-superusers, only memberships where
   * `memberName === currentUser.name`.
   */
  memberships: PgMembership[];
  databases: PgDatabaseInfo[];
  /** User the per-database privileges were evaluated for. */
  targetUser: string;
  /** High-level dashboard counters. */
  stats: DashboardStats;
}

export interface CreateRoleInput {
  connectionId: string;
  name: string;
  password?: string;
  login: boolean;
  createRole?: boolean;
  createDb?: boolean;
  inherit?: boolean;
  connectionLimit?: number;
  validUntil?: string;
  /** Role names to grant membership in to the newly created role. */
  membershipRoles?: string[];
}

export interface AlterRoleInput {
  connectionId: string;
  name: string;
  /** New password, or null to remove the password. Undefined = unchanged. */
  password?: string | null;
  login?: boolean;
  createRole?: boolean;
  createDb?: boolean;
  connectionLimit?: number;
  validUntil?: string | null;
}

export interface AlterRoleCommentInput {
  connectionId: string;
  name: string;
  /** New COMMENT ON ROLE text, or null to clear it. */
  comment: string | null;
}

export interface MembershipInput {
  connectionId: string;
  memberName: string;
  parentRoleName: string;
  withAdminOption?: boolean;
}

export interface DbAccessInput {
  connectionId: string;
  userName: string;
  databaseName: string;
}

export interface DbReadonlyGrantInput {
  connectionId: string;
  userName: string;
  databaseName: string;
  /** Schema to scope the read-only grant to. Defaults to `public`. */
  schema?: string;
}

export interface SetDbAccessLevelInput {
  connectionId: string;
  userName: string;
  databaseName: string;
  level: AccessLevel;
  /**
   * When true, recovers the historical default privileges on existing tables.
   * Tracked because "Read + Write" + restricted tables should NOT auto-add
   * future tables unless explicitly enabled.
   */
  applyToFutureTables: boolean;
  /**
   * When set, permissions are restricted to exactly these table names in the
   * database's `public` schema. When undefined, every table in `public`
   * receives the grant.
   */
  restrictedTables?: string[];
}

export interface CloneRoleInput {
  connectionId: string;
  /** Name of the existing role to clone. */
  sourceName: string;
  /** Name of the new role to create from `sourceName`. */
  newName: string;
}

export interface RenameRoleInput {
  connectionId: string;
  oldName: string;
  newName: string;
}

export interface TableRestrictionInput {
  connectionId: string;
  userName: string;
  databaseName: string;
  /**
   * Per-table grant overrides, spanning one or more schemas. Within each
   * schema present in this list, tables not included are revoked; tables
   * present get the specified level. Mixing levels across tables (and across
   * schemas) in a single call is supported.
   */
  tables: Array<{ schema: string; name: string; level: AccessLevel }>;
}

export interface PgTriggerInfo {
  schemaName: string;
  tableName: string;
  triggerName: string;
  /** BEFORE / AFTER / INSTEAD OF. */
  timing: string;
  /** Comma-joined event list: INSERT,UPDATE,DELETE,TRUNCATE. */
  events: string;
  /** Function the trigger invokes. */
  functionName: string;
  /** Schema the trigger function lives in. */
  functionSchema: string;
  /** True unless `enabledMode` is "disabled". Kept for the plain on/off toggle. */
  enabled: boolean;
  /**
   * Full `pg_trigger.tgenabled` mode: "origin" (normal), "disabled",
   * "replica" (fires only when `session_replication_role = replica`), or
   * "always" (fires regardless of `session_replication_role`). The toggle
   * UI only offers origin/disabled — replica/always are surfaced read-only.
   */
  enabledMode: "origin" | "disabled" | "replica" | "always";
  /** "ROW" or "STATEMENT". */
  orientation: string;
}

export interface PgTriggerFunction {
  schemaName: string;
  functionName: string;
  source: string | null;
}

export interface CreateTriggerInput {
  connectionId: string;
  databaseName: string;
  schemaName: string;
  tableName: string;
  triggerName: string;
  timing: "BEFORE" | "AFTER" | "INSTEAD OF";
  events: Array<"INSERT" | "UPDATE" | "DELETE" | "TRUNCATE">;
  orientation: "ROW" | "STATEMENT";
  functionSchema: string;
  functionName: string;
  /** Optional argument passed to the trigger function. */
  functionArgs?: string;
}

export interface DropTriggerInput {
  connectionId: string;
  databaseName: string;
  schemaName: string;
  tableName: string;
  triggerName: string;
}

export interface SetTriggerEnabledInput {
  connectionId: string;
  databaseName: string;
  schemaName: string;
  tableName: string;
  triggerName: string;
  enabled: boolean;
}

export interface CreateTriggerFunctionInput {
  connectionId: string;
  databaseName: string;
  schemaName: string;
  functionName: string;
  /** PL/pgSQL source body. */
  source: string;
}

export interface EffectivePermissions {
  user: string;
  databases: Array<{
    name: string;
    level: AccessLevel;
  }>;
  /** Tables the user can read (in the active connection's database). */
  readableTables: Array<{ schemaName: string; tableName: string }>;
  /** Subset of readableTables the user can also write to. */
  writableTables: Array<{ schemaName: string; tableName: string }>;
  /** Resolved inherited role names (parents of the user, transitively). */
  inheritedRoles: string[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  /** Connection id the action ran against. */
  connectionId: string;
  /** Human-friendly connection label, best-effort resolved. */
  connectionLabel: string;
  /** PostgreSQL role that issued the action (`current_user`). */
  actor: string;
  /** Free-form action label (e.g. "create-role", "grant-db-readwrite"). */
  action: string;
  /** Human-readable description of the target. */
  target: string;
  /** True when the action succeeded, false when it failed. */
  success: boolean;
  /** Present and populated only when `success` is false. */
  error: string | null;
}
