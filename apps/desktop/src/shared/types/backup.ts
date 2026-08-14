/**
 * Shared types for database backup and restore (pg_dump / pg_restore).
 */

export interface BackupEndpoint {
  connectionId: string;
  database: string;
}

export interface BackupListDatabasesInput {
  connectionId: string;
}

export interface BackupCancelInput {
  runId: string;
}

export type BackupLogLevel = "info" | "warn" | "error";

export interface BackupProgressEvent {
  runId: string;
  line: string;
  level: BackupLogLevel;
}

export type BackupStatus = "ok" | "cancelled" | "error";

export interface BackupRunResult {
  status: BackupStatus;
  message?: string;
  /** Path the backup was written to (backup runs, or restores with `backupTarget`). */
  backupPath?: string;
}

export interface BackupCreateInput {
  /** Client-generated identifier correlating progress events and cancellation. */
  runId: string;
  source: BackupEndpoint;
}

export interface BackupRestoreInput {
  runId: string;
  target: BackupEndpoint;
  /**
   * pg_dump custom-format file. Must live in the backups directory or have
   * been chosen through `showRestoreFileDialog`.
   */
  backupPath: string;
  /** Dump the target to a local file before restoring over it. */
  backupTarget?: boolean;
  /** Required when the target looks like a production database. */
  confirmProduction?: boolean;
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

export interface BackupDeleteInput {
  path: string;
}

export interface BackupInspectInput {
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
