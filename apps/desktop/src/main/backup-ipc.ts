import {
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import fsp from "node:fs/promises";
import path from "node:path";
import { BackupChannels } from "../shared/constants/ipc-channels";
import type {
  BackupCreateInput,
  BackupEndpoint,
  BackupLogLevel,
  BackupRestoreInput,
  BackupRunResult,
} from "../shared/types/backup";
import type { ConnectionConfig } from "../shared/types/connection";
import { looksLikeProduction } from "../shared/production-guard";
import { getConnectionById } from "./connection-store";
import { withPoolClient } from "./pg-utils";
import { getSettings } from "./settings-store";
import { logAudit } from "./audit-store";
import {
  approveSavePath,
  consumeApprovedSavePath,
  registerIpcHandler,
} from "./ipc-security";
import {
  buildPgDumpArgs,
  buildPgRestoreArgs,
  resolvePgToolTarget,
  runPgTool,
  type ActiveRun,
} from "./backup-process";
import {
  backupsDir,
  createBackupFilePath,
  deleteBackup,
  inspectBackupFile,
  isInsideDir,
  listBackups,
  writeBackupMetadata,
} from "./backup-files";
import {
  validateBackupCancelInput,
  validateBackupCreateInput,
  validateBackupDeleteInput,
  validateBackupInspectInput,
  validateBackupListDatabasesInput,
  validateBackupRestoreInput,
} from "./ipc-validation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireConnection(connectionId: string): ConnectionConfig {
  const connection = getConnectionById(connectionId);
  if (!connection) throw new Error("Connection not found.");
  return connection;
}

function connectionHost(connection: ConnectionConfig): string | undefined {
  if (connection.mode === "uri" && connection.uri) {
    try {
      return new URL(connection.uri).hostname;
    } catch {
      return undefined;
    }
  }
  return connection.fields?.host;
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

async function listDatabases(connectionId: string): Promise<string[]> {
  return withPoolClient(connectionId, async (client) => {
    const result = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database
       WHERE datistemplate = false AND datallowconn = true
       ORDER BY datname`,
    );
    return result.rows.map((row) => row.datname);
  });
}

// ---------------------------------------------------------------------------
// Restore guards
// ---------------------------------------------------------------------------

/**
 * Restores are destructive (`pg_restore --clean`): refused in Read-only mode,
 * and a production-looking target needs explicit confirmation. The renderer
 * asks the user; this is the enforcement boundary.
 */
export function assertRestoreAllowed(input: BackupRestoreInput): void {
  if (getSettings().general.readOnlyMode) {
    throw new Error("Cannot restore database: read-only mode is enabled.");
  }

  const connection = requireConnection(input.target.connectionId);
  const isProduction = looksLikeProduction(
    connection.label,
    connectionHost(connection),
    input.target.database,
  );
  if (isProduction && input.confirmProduction !== true) {
    throw new Error(
      `"${input.target.database}" on "${connection.label}" looks like a production database. Confirm the restore to proceed.`,
    );
  }
}

/**
 * A restore may only read a file from the backups directory or one the user
 * just picked in the restore file dialog (a one-time, per-renderer grant).
 */
export function resolveRestoreSource(
  event: IpcMainInvokeEvent,
  backupPath: string,
): string {
  if (isInsideDir(backupsDir(), backupPath)) {
    return path.resolve(backupPath);
  }
  return consumeApprovedSavePath(event, backupPath, "restore");
}

// ---------------------------------------------------------------------------
// Runs: progress, cancellation, target locking
// ---------------------------------------------------------------------------

const activeRuns = new Map<string, ActiveRun>();

// Locks survive renderer remounts (which forget their runId), so a second
// backup/restore against a database that is already busy is rejected here.
const lockedTargets = new Set<string>();

interface Run {
  active: ActiveRun;
  /** Forgets the run and releases the target lock. */
  finish: () => void;
}

/** Registers a run and locks its target database; throws if either is busy. */
function startRun(runId: string, endpoint: BackupEndpoint): Run {
  if (activeRuns.has(runId)) {
    throw new Error("A run with this identifier is already in progress.");
  }
  const lockKey = `${endpoint.connectionId}:${endpoint.database}`;
  if (lockedTargets.has(lockKey)) {
    throw new Error(
      "Another backup or restore is already running against this database. Wait for it to finish first.",
    );
  }

  const active: ActiveRun = { cancelled: false };
  activeRuns.set(runId, active);
  lockedTargets.add(lockKey);
  return {
    active,
    finish: () => {
      activeRuns.delete(runId);
      lockedTargets.delete(lockKey);
    },
  };
}

function emit(
  sender: WebContents,
  runId: string,
  line: string,
  level: BackupLogLevel = "info",
): void {
  if (sender.isDestroyed()) return;
  sender.send(BackupChannels.PROGRESS, { runId, line, level });
}

function cancelRun(runId: string): void {
  const active = activeRuns.get(runId);
  if (!active) return;
  active.cancelled = true;
  active.child?.kill();
}

function logRun(
  action: string,
  endpoint: BackupEndpoint,
  target: string,
  result: BackupRunResult,
  actor: string,
): void {
  logAudit({
    connectionId: endpoint.connectionId,
    connectionLabel: resolveConnectionLabel(endpoint.connectionId),
    actor,
    action,
    target,
    success: result.status === "ok",
    error: result.status === "error" ? result.message : undefined,
  });
}

function resolveConnectionLabel(connectionId: string): string {
  return getConnectionById(connectionId)?.label ?? connectionId;
}

// ---------------------------------------------------------------------------
// pg_dump / pg_restore
// ---------------------------------------------------------------------------

/** Dumps `endpoint` to a new file in the backups directory. Throws on failure. */
async function dumpDatabase(
  endpoint: BackupEndpoint,
  runId: string,
  sender: WebContents,
  active: ActiveRun,
): Promise<string> {
  const connection = requireConnection(endpoint.connectionId);
  const backupPath = await createBackupFilePath(
    connection.label,
    endpoint.database,
  );
  const target = await resolvePgToolTarget(connection, endpoint.database);
  try {
    emit(
      sender,
      runId,
      `Backing up "${endpoint.database}" to ${backupPath}...`,
    );
    const dumpRun = await runPgTool(
      "pg_dump",
      buildPgDumpArgs(target, backupPath),
      target.env,
      (line) => emit(sender, runId, line),
      active,
    );
    if (active.cancelled) {
      await fsp.unlink(backupPath).catch(() => undefined);
      return backupPath;
    }
    if (dumpRun.code !== 0) {
      throw new Error(
        dumpRun.error ?? `pg_dump exited with code ${dumpRun.code}`,
      );
    }
    await writeBackupMetadata(backupPath, connection.label, endpoint.database);
    emit(sender, runId, `Backup saved to ${backupPath}.`);
    return backupPath;
  } catch (err) {
    await fsp.unlink(backupPath).catch(() => undefined);
    throw new Error(`Backup failed: ${(err as Error).message}`);
  } finally {
    await target.cleanup();
  }
}

const FATAL_RESTORE_PATTERN =
  /FATAL|could not connect|password authentication failed|connection to server/i;

async function restoreFile(
  backupPath: string,
  endpoint: BackupEndpoint,
  runId: string,
  sender: WebContents,
  active: ActiveRun,
): Promise<void> {
  const connection = requireConnection(endpoint.connectionId);
  const target = await resolvePgToolTarget(connection, endpoint.database);
  try {
    emit(
      sender,
      runId,
      `Restoring into "${endpoint.database}" (existing data will be replaced)...`,
    );
    const restoreRun = await runPgTool(
      "pg_restore",
      buildPgRestoreArgs(target, backupPath),
      target.env,
      (line) => emit(sender, runId, line),
      active,
    );
    if (active.cancelled || restoreRun.code === 0) return;

    const isFatal =
      restoreRun.code > 1 || FATAL_RESTORE_PATTERN.test(restoreRun.stderr);
    if (isFatal) {
      throw new Error(
        restoreRun.error ||
          restoreRun.stderr.trim().slice(0, 500) ||
          `pg_restore exited with code ${restoreRun.code}`,
      );
    }
    emit(
      sender,
      runId,
      `pg_restore exited with warnings (code ${restoreRun.code}) — likely harmless "already exists" notices.`,
      "warn",
    );
  } finally {
    await target.cleanup();
  }
}

async function runBackup(
  input: BackupCreateInput,
  sender: WebContents,
): Promise<BackupRunResult> {
  const { active, finish } = startRun(input.runId, input.source);

  let result: BackupRunResult;
  try {
    const backupPath = await dumpDatabase(
      input.source,
      input.runId,
      sender,
      active,
    );
    result = active.cancelled
      ? { status: "cancelled" }
      : { status: "ok", backupPath };
  } catch (err) {
    result = { status: "error", message: (err as Error).message };
  } finally {
    finish();
  }

  const label = resolveConnectionLabel(input.source.connectionId);
  const actor = await resolveActor(input.source.connectionId);
  logRun(
    "backup",
    input.source,
    `${label}:${input.source.database}`,
    result,
    actor,
  );
  return result;
}

/** `input.backupPath` must already be resolved by `resolveRestoreSource`. */
async function restoreDatabase(
  input: BackupRestoreInput,
  sender: WebContents,
): Promise<BackupRunResult> {
  const { active, finish } = startRun(input.runId, input.target);

  let result: BackupRunResult;
  try {
    await fsp.access(input.backupPath).catch(() => {
      throw new Error(`Backup file not found: ${input.backupPath}`);
    });

    let preRestoreBackupPath: string | undefined;
    if (input.backupTarget) {
      preRestoreBackupPath = await dumpDatabase(
        input.target,
        input.runId,
        sender,
        active,
      );
    }
    if (!active.cancelled) {
      await restoreFile(
        input.backupPath,
        input.target,
        input.runId,
        sender,
        active,
      );
    }

    if (active.cancelled) {
      result = { status: "cancelled" };
    } else {
      result = { status: "ok", backupPath: preRestoreBackupPath };
      emit(sender, input.runId, "Restore complete.");
    }
  } catch (err) {
    result = { status: "error", message: (err as Error).message };
  } finally {
    finish();
  }

  const label = resolveConnectionLabel(input.target.connectionId);
  const actor = await resolveActor(input.target.connectionId);
  logRun(
    "restore",
    input.target,
    `${input.backupPath} -> ${label}:${input.target.database}`,
    result,
    actor,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Restore file dialog
// ---------------------------------------------------------------------------

async function showRestoreFileDialog(
  event: IpcMainInvokeEvent,
): Promise<string | null> {
  const testFilePath = process.env.PG_COMPASS_TEST_OPEN_DIALOG_PATH?.trim();
  if (testFilePath) {
    return approveSavePath(event, testFilePath, "restore");
  }

  const options: Electron.OpenDialogOptions = {
    title: "Choose a backup to restore",
    defaultPath: backupsDir(),
    properties: ["openFile"],
    filters: [
      {
        name: "PostgreSQL custom-format dumps",
        extensions: ["dump", "backup"],
      },
      { name: "All files", extensions: ["*"] },
    ],
  };
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  const selectedPath = result.filePaths[0];
  if (result.canceled || !selectedPath) return null;
  return approveSavePath(event, selectedPath, "restore");
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

export function registerBackupHandlers(): void {
  registerIpcHandler(
    BackupChannels.LIST_DATABASES,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateBackupListDatabasesInput(rawInput);
        const data = await listDatabases(input.connectionId);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(BackupChannels.CANCEL, (_event, rawInput: unknown) => {
    try {
      const input = validateBackupCancelInput(rawInput);
      cancelRun(input.runId);
      return { success: true, data: undefined };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  registerIpcHandler(BackupChannels.LIST_BACKUPS, async () => {
    try {
      const data = await listBackups();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  registerIpcHandler(
    BackupChannels.BACKUP,
    async (event, rawInput: unknown) => {
      try {
        const input = validateBackupCreateInput(rawInput);
        const data = await runBackup(input, event.sender);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    BackupChannels.RESTORE,
    async (event, rawInput: unknown) => {
      try {
        const input = validateBackupRestoreInput(rawInput);
        // Guards run before the dialog grant is consumed, so a request that
        // still needs production confirmation can be retried with it.
        assertRestoreAllowed(input);
        const backupPath = resolveRestoreSource(event, input.backupPath);
        const data = await restoreDatabase(
          { ...input, backupPath },
          event.sender,
        );
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(BackupChannels.SHOW_RESTORE_FILE_DIALOG, async (event) => {
    try {
      const data = await showRestoreFileDialog(event);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  registerIpcHandler(
    BackupChannels.DELETE_BACKUP,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateBackupDeleteInput(rawInput);
        await deleteBackup(input.path);
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    BackupChannels.INSPECT_BACKUP,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateBackupInspectInput(rawInput);
        const data = await inspectBackupFile(input.path);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );
}
