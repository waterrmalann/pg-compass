import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ConnectionConfig } from "@/shared/types/connection";
import {
  buildPsqlArgs,
  buildPsqlEnv,
  commonPsqlDirectories,
  connectionDatabase,
  findExecutable,
  findInDirectories,
  isExecutableFile,
  locatePsql,
  versionedDirectories,
} from "@/main/shell-process";

function buildConnection(
  overrides: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  return {
    id: "local",
    label: "Local",
    favourite: false,
    mode: "fields",
    fields: {
      host: "localhost",
      port: 5432,
      database: "shop",
      user: "postgres",
      password: "secret",
    },
    ...overrides,
  };
}

// The PATH tests touch the real filesystem, so they search it the host's way:
// its PATH delimiter, and an executable marked by a PATHEXT extension on
// Windows or by the mode bit elsewhere.
const hostPlatform = process.platform;
const isWindows = hostPlatform === "win32";
const hostPsqlName = isWindows ? "psql.EXE" : "psql";

const target = {
  dbname: "postgresql://demo@localhost:5432/shop",
  env: { PGPASSWORD: "secret" },
  cleanup: async () => undefined,
};

describe("connectionDatabase", () => {
  it("uses the field database", () => {
    expect(connectionDatabase(buildConnection())).toBe("shop");
  });

  it("decodes the URI path", () => {
    const connection = buildConnection({
      mode: "uri",
      uri: "postgresql://demo:pw@db.example.com/my%20db?sslmode=disable",
    });
    expect(connectionDatabase(connection)).toBe("my db");
  });

  it("falls back to a dbname query parameter, then to libpq's default", () => {
    expect(
      connectionDatabase(
        buildConnection({
          mode: "uri",
          uri: "postgresql://demo@localhost?dbname=app",
        }),
      ),
    ).toBe("app");
    expect(
      connectionDatabase(
        buildConnection({ mode: "uri", uri: "postgresql://demo@localhost" }),
      ),
    ).toBe("");
  });
});

describe("findExecutable", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-compass-path-"));
    tempDirs.push(dir);
    return dir;
  }

  it("returns the first executable match on PATH", () => {
    const empty = makeDir();
    const bin = makeDir();
    const psql = path.join(bin, hostPsqlName);
    fs.writeFileSync(psql, "#!/bin/sh\n", { mode: 0o755 });
    const pathValue = [empty, bin].join(path.delimiter);

    expect(findExecutable("psql", { PATH: pathValue }, hostPlatform)).toBe(
      psql,
    );
  });

  it("skips non-executable files and directories", () => {
    // No mode bit on POSIX, and no PATHEXT extension on Windows.
    const bin = makeDir();
    fs.writeFileSync(path.join(bin, "psql"), "", { mode: 0o644 });
    const other = makeDir();
    fs.mkdirSync(path.join(other, hostPsqlName));
    const pathValue = [bin, other].join(path.delimiter);

    expect(
      findExecutable("psql", { PATH: pathValue }, hostPlatform),
    ).toBeNull();
  });
});

describe("psql invocation", () => {
  it("passes the whole conninfo as --dbname", () => {
    expect(buildPsqlArgs(target)).toEqual([
      "--dbname=postgresql://demo@localhost:5432/shop",
    ]);
  });

  it("sets terminal variables and keeps secrets in the environment", () => {
    const env = buildPsqlEnv(target, false);
    expect(env).toMatchObject({
      PGPASSWORD: "secret",
      TERM: "xterm-256color",
      PGAPPNAME: "PG Compass shell",
    });
    expect(env.PGOPTIONS).toBeUndefined();
  });

  it("starts transactions read-only in Read-only mode", () => {
    expect(buildPsqlEnv(target, true).PGOPTIONS).toBe(
      "-c default_transaction_read_only=on",
    );
  });
});

describe("locating psql", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-compass-psql-"));
    tempDirs.push(dir);
    return dir;
  }

  function makeExecutable(directory: string, name = "psql"): string {
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, name);
    fs.writeFileSync(filePath, "#!/bin/sh\n", { mode: 0o755 });
    return filePath;
  }

  it("recognises files, not folders or missing paths", () => {
    const dir = makeDir();
    const executable = makeExecutable(dir);

    expect(isExecutableFile(executable)).toBe(true);
    expect(isExecutableFile(dir)).toBe(false);
    expect(isExecutableFile(path.join(dir, "missing"))).toBe(false);
  });

  // Windows has no executable bit: Node treats X_OK as F_OK there.
  it.skipIf(isWindows)("needs the executable bit on POSIX", () => {
    const plain = path.join(makeDir(), "notes.txt");
    fs.writeFileSync(plain, "", { mode: 0o644 });

    expect(isExecutableFile(plain)).toBe(false);
  });

  it("tries PATHEXT extensions on Windows", () => {
    const dir = makeDir();
    const psqlExe = makeExecutable(dir, "psql.EXE");

    expect(
      findInDirectories("psql", [dir], { PATHEXT: ".COM;.EXE" }, "win32"),
    ).toBe(psqlExe);
    expect(findInDirectories("psql", [dir], {}, "linux")).toBeNull();
  });

  it("lists versioned install folders newest first", () => {
    const parent = makeDir();
    for (const entry of ["9.6", "16", "13", "notes"]) {
      fs.mkdirSync(path.join(parent, entry));
    }

    expect(versionedDirectories(parent, /^(\d+(?:\.\d+)?)$/, "bin")).toEqual([
      path.join(parent, "16", "bin"),
      path.join(parent, "13", "bin"),
      path.join(parent, "9.6", "bin"),
    ]);
    expect(
      versionedDirectories(path.join(parent, "missing"), /^(\d+)$/, "bin"),
    ).toEqual([]);
  });

  it("knows the usual install folders per platform", () => {
    const programFiles = makeDir();
    fs.mkdirSync(path.join(programFiles, "PostgreSQL", "15"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(programFiles, "PostgreSQL", "17"), {
      recursive: true,
    });

    expect(
      commonPsqlDirectories("win32", { ProgramFiles: programFiles }),
    ).toEqual([
      path.join(programFiles, "PostgreSQL", "17", "bin"),
      path.join(programFiles, "PostgreSQL", "15", "bin"),
    ]);
    expect(commonPsqlDirectories("darwin", {})).toEqual(
      expect.arrayContaining([
        "/opt/homebrew/bin",
        "/opt/homebrew/opt/libpq/bin",
        "/usr/local/opt/libpq/bin",
        "/Applications/Postgres.app/Contents/Versions/latest/bin",
      ]),
    );
    expect(commonPsqlDirectories("linux", {})).toEqual(
      expect.arrayContaining(["/usr/bin", "/usr/local/pgsql/bin"]),
    );
  });

  it("uses a configured path as is", () => {
    const psql = makeExecutable(makeDir());

    expect(
      locatePsql({ configuredPath: `  ${psql} `, env: {}, platform: "linux" }),
    ).toEqual({ path: psql, source: "setting", platform: "linux" });
  });

  it("does not fall back to another psql when the configured one is bad", () => {
    const onPath = makeDir();
    makeExecutable(onPath);

    const location = locatePsql({
      configuredPath: "/nowhere/psql",
      env: { PATH: onPath },
      platform: "linux",
    });
    expect(location.path).toBeNull();
    expect(location.problem).toMatch(/No executable psql at \/nowhere\/psql/);
  });

  it("prefers PATH, then the common folders", () => {
    const onPath = makeDir();
    const common = makeDir();
    const commonPsql = makeExecutable(common, hostPsqlName);

    expect(
      locatePsql({
        configuredPath: "",
        env: { PATH: onPath },
        platform: hostPlatform,
        commonDirectories: [common],
      }),
    ).toEqual({ path: commonPsql, source: "common", platform: hostPlatform });

    const pathPsql = makeExecutable(onPath, hostPsqlName);
    expect(
      locatePsql({
        configuredPath: "",
        env: { PATH: onPath },
        platform: hostPlatform,
        commonDirectories: [common],
      }),
    ).toEqual({ path: pathPsql, source: "path", platform: hostPlatform });
  });

  it("explains when psql is nowhere", () => {
    const location = locatePsql({
      configuredPath: "",
      env: { PATH: makeDir() },
      platform: "darwin",
      commonDirectories: [makeDir()],
    });
    expect(location).toMatchObject({
      path: null,
      source: null,
      platform: "darwin",
      problem: expect.stringMatching(/not found/),
    });
  });
});
