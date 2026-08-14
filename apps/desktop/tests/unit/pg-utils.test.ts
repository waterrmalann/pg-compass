import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConnectionConfig } from "@/shared/types/connection";

// Track Pool instances the code creates so we can assert lifecycle.
interface FakePool {
  config: Record<string, unknown>;
  ended: boolean;
  endImpl: () => Promise<void>;
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}
const poolsCreated: FakePool[] = [];

vi.mock("pg", () => {
  class Pool {
    config: Record<string, unknown>;
    ended = false;
    endImpl: () => Promise<void> = async () => {
      this.ended = true;
    };
    connect = vi.fn(async () => ({
      release: vi.fn(),
    }));
    end = vi.fn(() => this.endImpl());
    constructor(config: Record<string, unknown>) {
      this.config = config;
      poolsCreated.push(this as unknown as FakePool);
    }
  }
  return { Pool };
});

vi.mock("@/main/connection-store", () => ({
  getConnectionById: vi.fn(),
}));

async function loadUtils() {
  vi.resetModules();
  poolsCreated.length = 0;
  return {
    utils: await import("@/main/pg-utils"),
    store: await import("@/main/connection-store"),
  };
}

const fieldsConnection: ConnectionConfig = {
  id: "conn-1",
  label: "Local",
  favourite: false,
  mode: "fields",
  fields: {
    host: "localhost",
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: "secret",
  },
};

function createTempFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-compass-ssl-"));
  const filePath = path.join(dir, "cert.pem");
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

describe("buildPgConfig", () => {
  it("uses connectionString when mode is uri", async () => {
    const { utils } = await loadUtils();
    const config = utils.buildPgConfig({
      id: "c",
      label: "x",
      favourite: false,
      mode: "uri",
      uri: "postgres://u:p@h/db",
    });
    expect(config).toEqual({ connectionString: "postgres://u:p@h/db" });
  });

  it("throws when mode is fields but fields are missing", async () => {
    const { utils } = await loadUtils();
    expect(() =>
      utils.buildPgConfig({
        id: "c",
        label: "x",
        favourite: false,
        mode: "fields",
      } as unknown as ConnectionConfig),
    ).toThrow(/fields/i);
  });

  it("maps field config with SSL options and omits unset SSL fields", async () => {
    const { utils } = await loadUtils();
    const caPath = createTempFile("CA");
    const config = utils.buildPgConfig({
      ...fieldsConnection,
      ssl: { enabled: true, rejectUnauthorized: false, ca: caPath },
    });
    expect(config).toMatchObject({
      host: "localhost",
      port: 5432,
      ssl: { rejectUnauthorized: false, ca: "CA" },
    });
    expect((config as { ssl: Record<string, unknown> }).ssl).not.toHaveProperty(
      "cert",
    );
  });

  it("adds advanced SSL options to URI connections", async () => {
    const { utils } = await loadUtils();
    const caPath = createTempFile("URI CA");
    const config = utils.buildPgConfig({
      id: "c",
      label: "x",
      favourite: false,
      mode: "uri",
      uri: "postgres://u:p@h/db",
      ssl: { enabled: true, ca: caPath },
    });

    expect(config).toEqual({
      connectionString: "postgres://u:p@h/db",
      ssl: { rejectUnauthorized: true, ca: "URI CA" },
    });
  });

  it("uses pasted PEM contents for inline SSL CA", async () => {
    const { utils } = await loadUtils();
    const pem = [
      "-----BEGIN CERTIFICATE-----",
      "MIIB",
      "-----END CERTIFICATE-----",
    ].join("\n");

    const config = utils.buildPgConfig({
      ...fieldsConnection,
      ssl: { enabled: true, caSource: "inline", ca: `\n${pem}\n` },
    });

    expect(config).toMatchObject({
      ssl: { rejectUnauthorized: true, ca: pem },
    });
  });

  it("decodes base64 PEM contents for inline SSL CA", async () => {
    const { utils } = await loadUtils();
    const pem = [
      "-----BEGIN CERTIFICATE-----",
      "MIIB",
      "-----END CERTIFICATE-----",
    ].join("\n");
    const encoded = Buffer.from(pem, "utf8").toString("base64");

    const config = utils.buildPgConfig({
      ...fieldsConnection,
      ssl: { enabled: true, caSource: "inline", ca: encoded },
    });

    expect(config).toMatchObject({
      ssl: { rejectUnauthorized: true, ca: pem },
    });
  });

  it("throws a clear error when inline SSL CA is invalid", async () => {
    const { utils } = await loadUtils();
    expect(() =>
      utils.buildPgConfig({
        ...fieldsConnection,
        ssl: { enabled: true, caSource: "inline", ca: "not a certificate" },
      }),
    ).toThrow(
      /Inline SSL CA must be PEM text or a base64-encoded PEM certificate/,
    );
  });

  it("throws a clear error when an SSL file path cannot be read", async () => {
    const { utils } = await loadUtils();
    expect(() =>
      utils.buildPgConfig({
        ...fieldsConnection,
        ssl: { enabled: true, ca: "C:/missing/ca.pem" },
      }),
    ).toThrow(/Could not read SSL CA certificate file/);
  });

  it("defaults rejectUnauthorized to true when SSL enabled without override", async () => {
    const { utils } = await loadUtils();
    const config = utils.buildPgConfig({
      ...fieldsConnection,
      ssl: { enabled: true },
    });
    expect(
      (config as { ssl: { rejectUnauthorized: boolean } }).ssl
        .rejectUnauthorized,
    ).toBe(true);
  });
});

describe("connection safety checks", () => {
  it("refuses SSH-tunnelled connections instead of connecting directly", async () => {
    const { utils } = await loadUtils();
    expect(() =>
      utils.buildPgConfig({
        ...fieldsConnection,
        ssh: {
          enabled: true,
          host: "bastion",
          port: 22,
          user: "deploy",
          authMethod: "password",
        },
      }),
    ).toThrow(/SSH tunneling is not yet supported/);
  });

  it.each([String.raw`\\evil-host\share\ca.pem`, "//evil-host/share/ca.pem"])(
    "rejects network (UNC) SSL file paths: %s",
    async (uncPath) => {
      const { utils } = await loadUtils();
      expect(() =>
        utils.buildPgConfig({
          ...fieldsConnection,
          ssl: { enabled: true, ca: uncPath },
        }),
      ).toThrow(/not a network \(UNC\) path/);
    },
  );

  it("does not treat local extended-length paths as UNC", async () => {
    const { utils } = await loadUtils();
    expect(() =>
      utils.buildPgConfig({
        ...fieldsConnection,
        ssl: { enabled: true, ca: String.raw`\\?\C:\missing\ca.pem` },
      }),
    ).toThrow(/Could not read SSL CA certificate file/);
  });
});

describe("buildPgConfigForDatabase", () => {
  it("overrides the database for field connections", async () => {
    const { utils } = await loadUtils();
    expect(
      utils.buildPgConfigForDatabase(fieldsConnection, "other db"),
    ).toMatchObject({ host: "localhost", database: "other db" });
  });

  it("encodes the database into URI paths so pg decodes it back exactly", async () => {
    const { utils } = await loadUtils();
    const uriConnection: ConnectionConfig = {
      id: "c",
      label: "x",
      favourite: false,
      mode: "uri",
      uri: "postgres://u:p@h:5432/db?sslmode=disable",
    };
    for (const database of ["my db", "100%", "a/b", "host=evil dbname=x"]) {
      const config = utils.buildPgConfigForDatabase(uriConnection, database);
      const url = new URL(config.connectionString as string);
      // Mirrors pg-connection-string: decodeURI(pathname.slice(1)).
      expect(decodeURI(url.pathname.slice(1))).toBe(database);
      expect(url.hostname).toBe("h");
      expect(url.search).toBe("?sslmode=disable");
    }
  });

  it("refuses URI database names pg could not decode faithfully", async () => {
    const { utils } = await loadUtils();
    expect(() =>
      utils.buildPgConfigForDatabase(
        {
          id: "c",
          label: "x",
          favourite: false,
          mode: "uri",
          uri: "postgres://u:p@h/db",
        },
        "what?#",
      ),
    ).toThrow(/cannot be addressed/);
  });
});

describe("quoteLiteral", () => {
  it("asks the server to quote the value as a bound parameter", async () => {
    const { utils } = await loadUtils();
    const query = vi.fn(async () => ({ rows: [{ quoted: "'it''s'" }] }));
    const quoted = await utils.quoteLiteral({ query } as never, "it's");
    expect(quoted).toBe("'it''s'");
    expect(query).toHaveBeenCalledWith("SELECT quote_literal($1) AS quoted", [
      "it's",
    ]);
  });
});

describe("quoteIdent", () => {
  it("wraps in double quotes and escapes embedded double quotes", async () => {
    const { utils } = await loadUtils();
    expect(utils.quoteIdent("users")).toBe('"users"');
    expect(utils.quoteIdent('we"ird')).toBe('"we""ird"');
    expect(utils.quoteIdent("")).toBe('""');
  });
});

describe("pool lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates one pool per connectionId and reuses it across calls", async () => {
    const { utils, store } = await loadUtils();
    (store.getConnectionById as ReturnType<typeof vi.fn>).mockReturnValue(
      fieldsConnection,
    );

    await utils.withPoolClient("conn-1", async () => "ok");
    await utils.withPoolClient("conn-1", async () => "ok");

    expect(poolsCreated).toHaveLength(1);
    expect(poolsCreated[0]!.connect).toHaveBeenCalledTimes(2);
  });

  it("creates distinct pools for distinct connectionIds", async () => {
    const { utils, store } = await loadUtils();
    (store.getConnectionById as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string) => ({ ...fieldsConnection, id }),
    );

    await utils.withPoolClient("conn-1", async () => "ok");
    await utils.withPoolClient("conn-2", async () => "ok");

    expect(poolsCreated).toHaveLength(2);
  });

  it("throws a clear error if the connection cannot be resolved", async () => {
    const { utils, store } = await loadUtils();
    (store.getConnectionById as ReturnType<typeof vi.fn>).mockReturnValue(
      undefined,
    );

    await expect(
      utils.withPoolClient("missing", async () => "ok"),
    ).rejects.toThrow(/not found/i);
  });

  it("releases the client even when the callback throws", async () => {
    const { utils, store } = await loadUtils();
    (store.getConnectionById as ReturnType<typeof vi.fn>).mockReturnValue(
      fieldsConnection,
    );

    const release = vi.fn();
    await expect(
      utils.withPoolClient("conn-1", async () => {
        // Overwrite the client's release with our spy by running once first
        // would be indirect; instead, assert via the pool's connect mock return.
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const connectMock = poolsCreated[0]!.connect;
    const client = await connectMock.mock.results[0]!.value;
    expect(client.release).toHaveBeenCalledTimes(1);
    void release;
  });

  it("destroyPool ends the underlying pool and drops it from the map", async () => {
    const { utils, store } = await loadUtils();
    (store.getConnectionById as ReturnType<typeof vi.fn>).mockReturnValue(
      fieldsConnection,
    );

    await utils.withPoolClient("conn-1", async () => "ok");
    await utils.destroyPool("conn-1");

    expect(poolsCreated[0]!.end).toHaveBeenCalledTimes(1);

    // Next call should create a NEW pool (old one was dropped).
    await utils.withPoolClient("conn-1", async () => "ok");
    expect(poolsCreated).toHaveLength(2);
  });

  it("destroyPool is a no-op when no pool exists for the id", async () => {
    const { utils } = await loadUtils();
    await expect(utils.destroyPool("nope")).resolves.toBeUndefined();
  });

  it("destroyAllPools ends every known pool and clears the map", async () => {
    const { utils, store } = await loadUtils();
    (store.getConnectionById as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string) => ({ ...fieldsConnection, id }),
    );

    await utils.withPoolClient("a", async () => "ok");
    await utils.withPoolClient("b", async () => "ok");
    await utils.destroyAllPools();

    for (const p of poolsCreated) expect(p.end).toHaveBeenCalled();

    // Subsequent withPoolClient should create fresh pools.
    await utils.withPoolClient("a", async () => "ok");
    expect(poolsCreated.length).toBeGreaterThanOrEqual(3);
  });

  it("destroyAllPools awaits even when pool.end rejects", async () => {
    const { utils, store } = await loadUtils();
    (store.getConnectionById as ReturnType<typeof vi.fn>).mockReturnValue(
      fieldsConnection,
    );

    await utils.withPoolClient("conn-1", async () => "ok");
    poolsCreated[0]!.endImpl = async () => {
      throw new Error("network");
    };

    await expect(utils.destroyAllPools()).resolves.toBeUndefined();
  });

  it("handles concurrent first-calls for the same connection without creating extra pools", async () => {
    const { utils, store } = await loadUtils();
    (store.getConnectionById as ReturnType<typeof vi.fn>).mockReturnValue(
      fieldsConnection,
    );

    await Promise.all([
      utils.withPoolClient("conn-1", async () => "ok"),
      utils.withPoolClient("conn-1", async () => "ok"),
      utils.withPoolClient("conn-1", async () => "ok"),
    ]);

    expect(poolsCreated).toHaveLength(1);
  });
});
