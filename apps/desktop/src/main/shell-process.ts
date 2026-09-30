import fs from "node:fs";
import path from "node:path";
import type { ConnectionConfig } from "../shared/types/connection";
import type { PsqlLocation } from "../shared/types/shell";
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

export function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** First `command` (with a `PATHEXT` extension on Windows) in `directories`. */
export function findInDirectories(
  command: string,
  directories: string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const extensions =
    platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
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
  const pathValue = env.PATH ?? env.Path ?? "";
  const separator = platform === "win32" ? ";" : ":";
  const directories = pathValue.split(separator).filter(Boolean);
  return findInDirectories(command, directories, env, platform);
}

/**
 * `<parent>/<entry>/<suffix>` for each entry of `parent` whose name matches
 * `pattern` (first capture group = major version), newest version first.
 */
export function versionedDirectories(
  parent: string,
  pattern: RegExp,
  suffix: string,
): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(parent);
  } catch {
    return [];
  }

  const versioned: Array<{ directory: string; version: number }> = [];
  for (const entry of entries) {
    const match = pattern.exec(entry);
    if (!match) continue;
    versioned.push({
      directory: path.join(parent, entry, suffix),
      version: Number.parseFloat(match[1] ?? "0"),
    });
  }
  versioned.sort((left, right) => right.version - left.version);
  return versioned.map((item) => item.directory);
}

/**
 * Where the PostgreSQL client tools usually live when they are not on the
 * app's PATH. macOS apps started from Finder get a minimal PATH, Homebrew's
 * libpq is keg-only, and the Windows installer does not touch PATH.
 */
export function commonPsqlDirectories(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === "darwin") {
    return [
      "/opt/homebrew/bin",
      "/opt/homebrew/opt/libpq/bin",
      ...versionedDirectories("/opt/homebrew/opt", /^postgresql@(\d+)$/, "bin"),
      "/usr/local/bin",
      "/usr/local/opt/libpq/bin",
      ...versionedDirectories("/usr/local/opt", /^postgresql@(\d+)$/, "bin"),
      "/Applications/Postgres.app/Contents/Versions/latest/bin",
      "/opt/local/bin",
    ];
  }

  if (platform === "win32") {
    const programFolders = [
      env.ProgramFiles ?? "C:\\Program Files",
      env["ProgramFiles(x86)"],
    ].filter((folder): folder is string => Boolean(folder));
    return programFolders.flatMap((folder) =>
      versionedDirectories(
        path.join(folder, "PostgreSQL"),
        /^(\d+(?:\.\d+)?)$/,
        "bin",
      ),
    );
  }

  return [
    "/usr/local/bin",
    "/usr/bin",
    ...versionedDirectories("/usr/lib/postgresql", /^(\d+)$/, "bin"),
    ...versionedDirectories("/usr", /^pgsql-(\d+)$/, "bin"),
    "/usr/local/pgsql/bin",
  ];
}

export interface LocatePsqlOptions {
  /** The Settings → General psql path; blank means search. */
  configuredPath: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  commonDirectories?: string[];
}

/**
 * A configured path wins and is never silently replaced by another psql.
 * Otherwise PATH is searched first, then the common install folders.
 */
export function locatePsql(options: LocatePsqlOptions): PsqlLocation {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const configuredPath = options.configuredPath.trim();

  if (configuredPath) {
    if (isExecutableFile(configuredPath)) {
      return { path: configuredPath, source: "setting", platform };
    }
    return {
      path: null,
      source: null,
      platform,
      problem: `No executable psql at ${configuredPath}.`,
    };
  }

  const onPath = findExecutable("psql", env, platform);
  if (onPath) return { path: onPath, source: "path", platform };

  const commonDirectories =
    options.commonDirectories ?? commonPsqlDirectories(platform, env);
  const inCommonFolder = findInDirectories(
    "psql",
    commonDirectories,
    env,
    platform,
  );
  if (inCommonFolder) {
    return { path: inCommonFolder, source: "common", platform };
  }

  return {
    path: null,
    source: null,
    platform,
    problem: "psql was not found on your PATH or in the usual install folders.",
  };
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
