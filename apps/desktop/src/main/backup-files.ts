import { app } from "electron";
import fsp from "node:fs/promises";
import path from "node:path";
import type { BackupFileInfo, BackupInspection } from "../shared/types/backup";
import { buildPgRestoreListArgs, runPgTool } from "./backup-process";

interface BackupMetadata {
  connectionLabel: string;
  database: string;
  createdAt: string;
}

export function backupsDir(): string {
  return path.join(app.getPath("userData"), "backups");
}

/** True when `candidate` resolves to a path strictly inside `dir`. */
export function isInsideDir(dir: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(dir), path.resolve(candidate));
  if (relative === "" || path.isAbsolute(relative)) return false;
  const escapesDir = relative === ".." || relative.startsWith(`..${path.sep}`);
  return !escapesDir;
}

/** Resolves `filePath`; throws unless it is inside the backups directory. */
export function resolveBackupPath(filePath: string): string {
  if (!isInsideDir(backupsDir(), filePath)) {
    throw new Error("Invalid backup path.");
  }
  return path.resolve(filePath);
}

function toFileNamePart(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

/** A new timestamped `.dump` path inside the backups directory. */
export async function createBackupFilePath(
  connectionLabel: string,
  database: string,
): Promise<string> {
  const dir = backupsDir();
  await fsp.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const fileName = `${toFileNamePart(connectionLabel)}-${toFileNamePart(database)}-${stamp}.dump`;
  return resolveBackupPath(path.join(dir, fileName));
}

function metadataPath(backupPath: string): string {
  return `${backupPath}.json`;
}

export async function writeBackupMetadata(
  backupPath: string,
  connectionLabel: string,
  database: string,
): Promise<void> {
  const metadata: BackupMetadata = {
    connectionLabel,
    database,
    createdAt: new Date().toISOString(),
  };
  await fsp
    .writeFile(metadataPath(backupPath), JSON.stringify(metadata), "utf8")
    .catch(() => undefined);
}

async function readBackupMetadata(
  backupPath: string,
): Promise<BackupMetadata | null> {
  try {
    const raw = await fsp.readFile(metadataPath(backupPath), "utf8");
    return JSON.parse(raw) as BackupMetadata;
  } catch {
    return null;
  }
}

export async function listBackups(): Promise<BackupFileInfo[]> {
  const dir = backupsDir();
  await fsp.mkdir(dir, { recursive: true });
  const fileNames = (await fsp.readdir(dir)).filter((name) =>
    name.endsWith(".dump"),
  );
  const infos = await Promise.all(
    fileNames.map(async (fileName): Promise<BackupFileInfo> => {
      const filePath = path.join(dir, fileName);
      const stat = await fsp.stat(filePath);
      const metadata = await readBackupMetadata(filePath);
      return {
        path: filePath,
        fileName,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        target: metadata
          ? `${metadata.connectionLabel}:${metadata.database}`
          : null,
        createdAt: metadata?.createdAt ?? null,
      };
    }),
  );
  return infos.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function deleteBackup(filePath: string): Promise<void> {
  const resolved = resolveBackupPath(filePath);
  await fsp.unlink(resolved);
  await fsp.unlink(metadataPath(resolved)).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Inspection (pg_restore --list)
// ---------------------------------------------------------------------------

/**
 * TOC "description" tokens printed by `pg_restore --list`, most specific
 * first so "TABLE DATA" is not mistaken for "TABLE".
 */
const TOC_TYPE_TOKENS = [
  "MATERIALIZED VIEW",
  "TABLE DATA",
  "FK CONSTRAINT",
  "DEFAULT ACL",
  "SEQUENCE OWNED BY",
  "SEQUENCE SET",
  "TABLE",
  "SCHEMA",
  "VIEW",
  "SEQUENCE",
  "FUNCTION",
  "INDEX",
  "CONSTRAINT",
  "TRIGGER",
  "COMMENT",
  "ACL",
];

const TOC_LINE_PATTERN = /^\d+;\s+\d+\s+\d+\s+(.+)$/;

function parseTocType(remainder: string): string | null {
  for (const token of TOC_TYPE_TOKENS) {
    if (remainder === token || remainder.startsWith(`${token} `)) return token;
  }
  return null;
}

/** Count objects in `pg_restore --list` output. */
export function countTocEntries(listing: string): BackupInspection {
  const counts: BackupInspection = {
    schemas: 0,
    tables: 0,
    views: 0,
    sequences: 0,
    functions: 0,
  };
  for (const line of listing.split("\n")) {
    const match = TOC_LINE_PATTERN.exec(line.trimEnd());
    if (!match?.[1]) continue;
    switch (parseTocType(match[1])) {
      case "SCHEMA":
        counts.schemas++;
        break;
      case "TABLE":
        counts.tables++;
        break;
      case "VIEW":
      case "MATERIALIZED VIEW":
        counts.views++;
        break;
      case "SEQUENCE":
        counts.sequences++;
        break;
      case "FUNCTION":
        counts.functions++;
        break;
      default:
        break;
    }
  }
  return counts;
}

/** Reads object counts from a backup inside the backups directory. */
export async function inspectBackupFile(
  filePath: string,
): Promise<BackupInspection> {
  const resolved = resolveBackupPath(filePath);
  const result = await runPgTool(
    "pg_restore",
    buildPgRestoreListArgs(resolved),
    {},
    () => undefined,
    { cancelled: false },
  );
  if (result.code !== 0) {
    throw new Error(
      result.error ||
        result.stderr.trim().slice(0, 300) ||
        "pg_restore --list failed.",
    );
  }
  return countTocEntries(result.stdout);
}
