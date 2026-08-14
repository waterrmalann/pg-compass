import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeClient {
  statements: string[];
  query: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  readOnlyMode: false,
  isSuperuser: true,
  failOn: null as RegExp | null,
  unreachableDatabases: new Set<string>(),
  triggerExists: true,
  client: null as FakeClient | null,
  logAudit: vi.fn(),
  handle: vi.fn(),
}));

function createFakeClient(): FakeClient {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    statements.push(sql.trim());
    if (mocks.failOn?.test(sql)) {
      throw new Error("simulated failure");
    }
    if (sql.includes("FROM pg_roles") && sql.includes("current_user")) {
      return {
        rows: [
          {
            rolname: "admin",
            rolsuper: mocks.isSuperuser,
            rolcanlogin: true,
            rolcreaterole: true,
            rolcreatedb: true,
          },
        ],
      };
    }
    if (sql.includes("quote_literal")) {
      const value = String(params[0]).replaceAll("'", "''");
      return { rows: [{ quoted: `'${value}'` }] };
    }
    if (sql.includes("FROM pg_trigger")) {
      return { rows: [{ exists: mocks.triggerExists }] };
    }
    if (sql.includes("has_database_privilege")) {
      return {
        rows: [
          { datname: "app", can_connect: true },
          { datname: "broken", can_connect: true },
        ],
      };
    }
    return { rows: [] };
  });
  return { statements, query };
}

vi.mock("@/main/pg-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main/pg-utils")>()),
  withPoolClient: vi.fn(
    async (_id: string, fn: (client: unknown) => Promise<unknown>) =>
      fn(mocks.client),
  ),
  withDatabaseClient: vi.fn(
    async (
      _id: string,
      database: string,
      fn: (client: unknown) => Promise<unknown>,
    ) => {
      if (mocks.unreachableDatabases.has(database)) {
        throw new Error(`cannot connect to ${database}`);
      }
      return fn(mocks.client);
    },
  ),
}));

vi.mock("@/main/connection-store", () => ({
  getConnectionById: () => ({ label: "Local" }),
}));

vi.mock("@/main/settings-store", () => ({
  getSettings: () => ({ general: { readOnlyMode: mocks.readOnlyMode } }),
}));

vi.mock("@/main/audit-store", () => ({
  logAudit: mocks.logAudit,
  getAuditLog: () => [],
  clearAuditLog: vi.fn(),
}));

vi.mock("electron", () => ({ ipcMain: { handle: mocks.handle } }));

import {
  alterRole,
  alterRolePassword,
  createRole,
  runRoleMutation,
} from "@/main/roles-mutations";
import { setTriggerEnabled } from "@/main/roles-triggers";
import { getEffectivePermissions } from "@/main/roles-queries";
import { registerRolesHandlers } from "@/main/roles-ipc";
import { configureIpcSecurity } from "@/main/ipc-security";
import { RolesChannels } from "@/shared/constants/ipc-channels";

function statementsMatching(pattern: RegExp): string[] {
  return mocks.client!.statements.filter((sql) => pattern.test(sql));
}

describe("roles mutations", () => {
  beforeEach(() => {
    mocks.readOnlyMode = false;
    mocks.isSuperuser = true;
    mocks.failOn = null;
    mocks.unreachableDatabases.clear();
    mocks.triggerExists = true;
    mocks.client = createFakeClient();
    mocks.logAudit.mockReset();
  });

  it("refuses every mutation in read-only mode before touching the server", async () => {
    mocks.readOnlyMode = true;
    const mutate = vi.fn(async () => undefined);

    await expect(
      runRoleMutation("c1", "drop-role", 'role "x"', mutate),
    ).rejects.toThrow("Cannot drop-role: read-only mode is enabled.");
    expect(mutate).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("audits failures and reports them as IPC errors", async () => {
    const result = await runRoleMutation("c1", "create-role", "x", async () => {
      throw new Error("boom");
    });
    expect(result).toEqual({ success: false, error: "boom" });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create-role", success: false }),
    );
  });

  it("creates the role with a SCRAM password in one transaction", async () => {
    await createRole({
      connectionId: "c1",
      name: 'new "role"',
      login: true,
      password: "plain-secret",
      membershipRoles: ["readers"],
    });

    const statements = mocks.client!.statements;
    const createIndex = statements.findIndex((sql) =>
      sql.startsWith("CREATE ROLE"),
    );
    expect(statements[createIndex - 1]).toBe("BEGIN");
    expect(statements[createIndex]).toMatch(
      /^CREATE ROLE "new ""role""" WITH LOGIN PASSWORD 'SCRAM-SHA-256\$4096:/,
    );
    expect(statements[createIndex + 1]).toBe(
      'GRANT "readers" TO "new ""role"""',
    );
    expect(statements[createIndex + 2]).toBe("COMMIT");
    expect(statementsMatching(/^ALTER ROLE/)).toEqual([]);
    expect(statements.join("\n")).not.toContain("plain-secret");
  });

  it("rolls back the created role when a membership grant fails", async () => {
    mocks.failOn = /^GRANT/;
    await expect(
      createRole({
        connectionId: "c1",
        name: "new_role",
        login: true,
        membershipRoles: ["missing"],
      }),
    ).rejects.toThrow("simulated failure");
    expect(mocks.client!.statements.at(-1)).toBe("ROLLBACK");
    expect(statementsMatching(/^COMMIT/)).toEqual([]);
  });

  it("alters attributes and password in a single transactional statement", async () => {
    await alterRole({
      connectionId: "c1",
      name: "reader",
      login: false,
      password: null,
      validUntil: "",
    });
    expect(statementsMatching(/^(BEGIN|ALTER ROLE|COMMIT)/)).toEqual([
      "BEGIN",
      `ALTER ROLE "reader" WITH NOLOGIN VALID UNTIL 'infinity' PASSWORD NULL`,
      "COMMIT",
    ]);
  });

  it("never sends a plaintext password when resetting it", async () => {
    await alterRolePassword({
      connectionId: "c1",
      name: "reader",
      password: "o'hara",
    });
    const [alter] = statementsMatching(/^ALTER ROLE/);
    expect(alter).toMatch(/^ALTER ROLE "reader" PASSWORD 'SCRAM-SHA-256\$/);
    expect(mocks.client!.statements.join("\n")).not.toContain("o'hara");
  });

  it("requires a superuser for admin mutations", async () => {
    mocks.isSuperuser = false;
    await expect(
      createRole({ connectionId: "c1", name: "x", login: true }),
    ).rejects.toThrow(/superuser/);
    expect(statementsMatching(/^CREATE ROLE/)).toEqual([]);
  });
});

describe("roles triggers", () => {
  beforeEach(() => {
    mocks.isSuperuser = true;
    mocks.failOn = null;
    mocks.client = createFakeClient();
  });

  it("toggles an existing trigger with quoted identifiers", async () => {
    await setTriggerEnabled({
      connectionId: "c1",
      databaseName: "app",
      schemaName: "Sales",
      tableName: 'order"s',
      triggerName: "audit trigger",
      enabled: false,
    });
    expect(statementsMatching(/^ALTER TABLE/)).toEqual([
      `ALTER TABLE "Sales"."order""s" DISABLE TRIGGER "audit trigger"`,
    ]);
  });

  it("refuses to toggle a trigger that does not exist", async () => {
    mocks.triggerExists = false;
    await expect(
      setTriggerEnabled({
        connectionId: "c1",
        databaseName: "app",
        schemaName: "public",
        tableName: "orders",
        triggerName: "missing",
        enabled: true,
      }),
    ).rejects.toThrow("Trigger not found on the selected table.");
    expect(statementsMatching(/^ALTER TABLE/)).toEqual([]);
  });
});

describe("effective permissions", () => {
  beforeEach(() => {
    mocks.isSuperuser = true;
    mocks.failOn = null;
    mocks.client = createFakeClient();
  });

  it("reports an unreachable database as no access instead of failing", async () => {
    mocks.unreachableDatabases.add("broken");
    const permissions = await getEffectivePermissions("c1", "reader");
    expect(permissions.databases).toEqual([
      { name: "app", level: "none" },
      { name: "broken", level: "none" },
    ]);
  });
});

describe("roles IPC handlers", () => {
  const rendererUrl = "file:///app/index.html";
  const mainFrame = { url: rendererUrl };
  const event = { senderFrame: mainFrame, sender: { id: 1, mainFrame } };

  function getHandler(channel: string) {
    const call = mocks.handle.mock.calls.find(([name]) => name === channel);
    return call![1] as (event: unknown, input: unknown) => Promise<unknown>;
  }

  beforeEach(() => {
    mocks.readOnlyMode = false;
    mocks.isSuperuser = true;
    mocks.failOn = null;
    mocks.client = createFakeClient();
    mocks.handle.mockReset();
    configureIpcSecurity(rendererUrl);
    registerRolesHandlers();
  });

  it("returns the read-only refusal as an IPC error without running SQL", async () => {
    mocks.readOnlyMode = true;
    const result = await getHandler(RolesChannels.CREATE_ROLE)(event, {
      connectionId: "c1",
      name: "reader",
      login: true,
    });
    expect(result).toEqual({
      success: false,
      error: "Cannot create-role: read-only mode is enabled.",
    });
    expect(mocks.client!.statements).toEqual([]);
  });

  it("rejects invalid input before running the mutation", async () => {
    const result = await getHandler(RolesChannels.DROP_ROLE)(event, {
      connectionId: "c1",
      name: "",
    });
    expect(result).toMatchObject({ success: false });
    expect(mocks.client!.statements).toEqual([]);
  });

  it("does not register the removed grant and trigger-authoring channels", () => {
    const channels = mocks.handle.mock.calls.map(([name]) => name as string);
    expect([...channels].sort()).toEqual(Object.values(RolesChannels).sort());
    expect(
      channels.some((name) =>
        /db-connect|readonly|create-trigger|drop-trigger|trigger-function/.test(
          name,
        ),
      ),
    ).toBe(false);
  });
});
