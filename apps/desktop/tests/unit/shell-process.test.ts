import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ConnectionConfig } from "@/shared/types/connection";
import {
  buildPsqlArgs,
  buildPsqlEnv,
  connectionDatabase,
  findExecutable,
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
    const psql = path.join(bin, "psql");
    fs.writeFileSync(psql, "#!/bin/sh\n", { mode: 0o755 });

    expect(findExecutable("psql", { PATH: `${empty}:${bin}` }, "linux")).toBe(
      psql,
    );
  });

  it("skips non-executable files and directories", () => {
    const bin = makeDir();
    fs.writeFileSync(path.join(bin, "psql"), "", { mode: 0o644 });
    const other = makeDir();
    fs.mkdirSync(path.join(other, "psql"));

    expect(
      findExecutable("psql", { PATH: `${bin}:${other}` }, "linux"),
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
