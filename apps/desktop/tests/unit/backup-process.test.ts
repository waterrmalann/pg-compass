import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "@/shared/types/connection";

vi.mock("@/main/connection-store", () => ({
  getConnectionById: vi.fn(),
}));

import {
  buildPgDumpArgs,
  buildPgRestoreArgs,
  buildPgRestoreListArgs,
  quoteConninfoValue,
  resolvePgToolTarget,
} from "@/main/backup-process";

const HOSTILE_DATABASE = "host=evil dbname=x";
const INLINE_CA = "-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----";

const fieldsConnection: ConnectionConfig = {
  id: "conn-1",
  label: "Local",
  favourite: false,
  mode: "fields",
  fields: {
    host: "localhost",
    port: 5432,
    database: "postgres",
    user: "o'brien",
    password: "field-secret",
  },
};

function writeTempFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-compass-test-"));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

describe("conninfo and database name handling", () => {
  it("backslash-escapes quotes and backslashes in conninfo values", () => {
    expect(quoteConninfoValue(String.raw`it's a\b`)).toBe(
      String.raw`'it\'s a\\b'`,
    );
  });

  it("passes a hostile database name as a quoted dbname value (fields)", async () => {
    const target = await resolvePgToolTarget(
      fieldsConnection,
      HOSTILE_DATABASE,
    );

    expect(target.dbname).toBe(
      String.raw`host='localhost' port='5432' user='o\'brien' dbname='host=evil dbname=x'`,
    );
    expect(target.env).toEqual({ PGPASSWORD: "field-secret" });
    await target.cleanup();
  });

  it("percent-encodes the database into URI paths and keeps the password off argv", async () => {
    const target = await resolvePgToolTarget(
      {
        ...fieldsConnection,
        mode: "uri",
        fields: undefined,
        uri: "postgresql://app:p%40ss@db.example.com:5433/orig?dbname=other&application_name=x",
      },
      HOSTILE_DATABASE,
    );

    const url = new URL(target.dbname);
    expect(url.hostname).toBe("db.example.com");
    expect(url.password).toBe("");
    expect(url.searchParams.has("dbname")).toBe(false);
    expect(decodeURIComponent(url.pathname.slice(1))).toBe(HOSTILE_DATABASE);
    expect(target.dbname).not.toContain("=evil");
    expect(target.env).toEqual({ PGPASSWORD: "p@ss" });
  });

  it("moves a password query parameter off argv", async () => {
    const target = await resolvePgToolTarget(
      {
        ...fieldsConnection,
        mode: "uri",
        fields: undefined,
        uri: "postgresql://app:userinfo@db.example.com/orig?password=q%26secret&sslmode=require",
      },
      "shop",
    );

    expect(target.dbname).not.toContain("secret");
    expect(target.dbname).not.toContain("userinfo");
    expect(new URL(target.dbname).searchParams.get("sslmode")).toBe("require");
    expect(target.env).toEqual({ PGPASSWORD: "q&secret" });
  });

  it("refuses SSH-tunnelled connections", async () => {
    await expect(
      resolvePgToolTarget(
        {
          ...fieldsConnection,
          ssh: {
            enabled: true,
            host: "bastion",
            port: 22,
            user: "deploy",
            authMethod: "password",
          },
        },
        "app",
      ),
    ).rejects.toThrow(/SSH tunnel/);
  });

  it("attaches option values and ends options before positional paths", () => {
    const target = { dbname: "-x", env: {}, cleanup: async () => undefined };
    expect(buildPgDumpArgs(target, "/tmp/-a.dump")).toEqual([
      "--no-owner",
      "--no-acl",
      "--format=custom",
      "--file=/tmp/-a.dump",
      "--dbname=-x",
    ]);
    const restoreArgs = buildPgRestoreArgs(target, "-a.dump");
    expect(restoreArgs.slice(-2)).toEqual(["--", "-a.dump"]);
    expect(restoreArgs).toContain("--dbname=-x");
    expect(buildPgRestoreListArgs("-a.dump")).toEqual([
      "--list",
      "--",
      "-a.dump",
    ]);
  });
});

describe("SSL environment mapping", () => {
  it("maps verified SSL to verify-full and writes PEMs to a private directory", async () => {
    const certPath = writeTempFile("client.crt", "CERT");
    const keyPath = writeTempFile("client.key", "KEY");
    const target = await resolvePgToolTarget(
      {
        ...fieldsConnection,
        ssl: {
          enabled: true,
          rejectUnauthorized: true,
          caSource: "inline",
          ca: INLINE_CA,
          cert: certPath,
          key: keyPath,
        },
      },
      "app",
    );

    expect(target.env.PGSSLMODE).toBe("verify-full");
    const pemDir = path.dirname(target.env.PGSSLROOTCERT!);
    expect(path.dirname(target.env.PGSSLCERT!)).toBe(pemDir);
    expect(path.dirname(target.env.PGSSLKEY!)).toBe(pemDir);
    expect(fs.readFileSync(target.env.PGSSLROOTCERT!, "utf8")).toBe(INLINE_CA);
    expect(fs.readFileSync(target.env.PGSSLKEY!, "utf8")).toBe("KEY");
    if (process.platform !== "win32") {
      const keyMode = fs.statSync(target.env.PGSSLKEY!).mode & 0o777;
      expect(keyMode).toBe(0o600);
    }

    await target.cleanup();
    expect(fs.existsSync(pemDir)).toBe(false);
  });

  it("maps unverified SSL to require without trusting a CA file", async () => {
    const target = await resolvePgToolTarget(
      {
        ...fieldsConnection,
        ssl: {
          enabled: true,
          rejectUnauthorized: false,
          caSource: "inline",
          ca: INLINE_CA,
        },
      },
      "app",
    );
    expect(target.env).toEqual({
      PGPASSWORD: "field-secret",
      PGSSLMODE: "require",
    });
  });

  it("applies SSL to URI connections and uses the system trust store without a CA", async () => {
    const target = await resolvePgToolTarget(
      {
        ...fieldsConnection,
        mode: "uri",
        fields: undefined,
        uri: "postgresql://app@db.example.com/orig",
        ssl: { enabled: true },
      },
      "app",
    );
    expect(target.env).toEqual({
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: "system",
    });
  });

  it("leaves SSL variables unset when SSL is disabled", async () => {
    const target = await resolvePgToolTarget(fieldsConnection, "app");
    expect(Object.keys(target.env)).toEqual(["PGPASSWORD"]);
  });
});
