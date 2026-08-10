/**
 * Shared types for the Database Sync feature: mirror one saved connection's
 * database into another, or reconcile them row-by-row.
 */

/**
 * "full-override" wipes the target and replaces it with an exact copy of
 * source (schema + data) via pg_dump/pg_restore --clean.
 *
 * "row-sync" makes no DDL changes. For every table that exists (with a
 * primary key) on both sides, it inserts rows missing on target, updates
 * rows that changed, and deletes target rows whose PK no longer exists on
 * source. Tables missing on either side, or without a primary key, are
 * skipped with a warning rather than aborting the run.
 */
export type DbSyncMode = "full-override" | "row-sync";

export interface DbSyncEndpoint {
  connectionId: string;
  database: string;
}

export interface DbSyncListDatabasesInput {
  connectionId: string;
}

export interface DbSyncRunInput {
  /** Client-generated identifier correlating progress events and cancellation. */
  runId: string;
  source: DbSyncEndpoint;
  target: DbSyncEndpoint;
  mode: DbSyncMode;
  /** Dump the target to a local file before running. Aborts the run if the backup fails. */
  backupTarget?: boolean;
}

export interface DbSyncCancelInput {
  runId: string;
}

export type DbSyncLogLevel = "info" | "warn" | "error";

export interface DbSyncProgressEvent {
  runId: string;
  line: string;
  level: DbSyncLogLevel;
}

export type DbSyncStatus = "ok" | "cancelled" | "error";

export interface DbSyncResult {
  status: DbSyncStatus;
  message?: string;
  /** Path the pre-sync backup was written to, when `backupTarget` was set. */
  backupPath?: string;
}

/**
 * Whether the "show production databases as a Database Sync target" guard
 * is currently open. Lives in main-process memory only (never persisted) so
 * it always starts disabled on launch and self-expires after its TTL.
 */
export interface DbSyncProdGuardState {
  enabled: boolean;
  /** Epoch ms the guard will auto-disable at, or null when disabled. */
  enabledUntil: number | null;
}

export interface DbSyncSetProdGuardInput {
  enabled: boolean;
}

export interface DbSyncBackupInput {
  runId: string;
  source: DbSyncEndpoint;
}

export interface DbSyncRestoreInput {
  runId: string;
  target: DbSyncEndpoint;
  /** Absolute path to a pg_dump custom-format file (from listBackups or a file picker). */
  backupPath: string;
  /** Dump the target to a local file before restoring over it. */
  backupTarget?: boolean;
}

export interface BackupFileInfo {
  path: string;
  fileName: string;
  sizeBytes: number;
  mtimeMs: number;
  /** "<connection label>:<database>" the backup was taken from, when known. */
  target: string | null;
  /** ISO timestamp of the backup run, when known (older backups fall back to file mtime). */
  createdAt: string | null;
}

export interface DbSyncDeleteBackupInput {
  path: string;
}

export interface DbSyncInspectBackupInput {
  path: string;
}

/** Object counts read from a backup file's own table of contents (`pg_restore --list`). */
export interface BackupInspection {
  schemas: number;
  tables: number;
  views: number;
  sequences: number;
  functions: number;
}
