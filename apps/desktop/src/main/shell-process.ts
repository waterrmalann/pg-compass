import fs from "node:fs";
import path from "node:path";
import type { ConnectionConfig } from "../shared/types/connection";
import type { PgToolTarget } from "./backup-process";

/** The database a connection opens, as the rest of the app connects to it. */
export function connectionDatabase(connection: ConnectionConfig): string {
  if (connection.mode === "uri" && connection.uri) {
    const url = new URL(connection.uri);
    const fromPath = decodeURIComponent(url.pathname.slice(1));
    if (fromPath) return fromPath;
    return url.searchParams.get("dbname") ?? "";
  }
  return connection.fields?.database ?? "";
}

/**
 * Finds `command` on `PATH` (honouring `PATHEXT` on Windows) so a missing
 * client gets a clear message instead of a failed exec inside the terminal.
 */
export function findExecutable(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const isWindows = platform === "win32";
  const pathValue = env.PATH ?? env.Path ?? "";
  const directories = pathValue.split(isWindows ? ";" : ":").filter(Boolean);
  const extensions = isWindows
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
    : [""];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
}

/** `--dbname` takes the whole conninfo, so nothing else reaches libpq. */
export function buildPsqlArgs(target: PgToolTarget): string[] {
  return [`--dbname=${target.dbname}`];
}

/**
 * Environment for psql on top of the app's own. Read-only mode starts every
 * transaction read-only. It is a session default, so a user can still
 * `SET default_transaction_read_only = off`; the UI says so.
 */
export function buildPsqlEnv(
  target: PgToolTarget,
  readOnly: boolean,
): Record<string, string> {
  const env: Record<string, string> = {
    ...target.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    PGAPPNAME: "PG Compass shell",
  };
  if (readOnly) {
    env.PGOPTIONS = "-c default_transaction_read_only=on";
  }
  return env;
}
