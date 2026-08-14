import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();
const exposeInMainWorld = vi.fn();

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: {
    invoke,
    on,
    removeListener,
  },
}));

describe("preload API contract", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    on.mockReset();
    removeListener.mockReset();
    exposeInMainWorld.mockReset();
  });

  it("exposes the expected APIs and forwards invoke/on calls", async () => {
    await import("@/preload");

    const exposed = Object.fromEntries(
      exposeInMainWorld.mock.calls.map(([key, value]) => [key, value]),
    ) as {
      connectionApi: {
        getAll: () => Promise<unknown>;
        showOpenFileDialog: (options: unknown) => Promise<unknown>;
      };
      tableDataApi: {
        onExportProgress: (callback: () => void) => () => void;
        onImportProgress: (callback: () => void) => () => void;
        getTriggers: (params: unknown) => Promise<unknown>;
        getTypes: (params: unknown) => Promise<unknown>;
        toggleTrigger: (params: unknown) => Promise<unknown>;
        showOpenDialog: (options: unknown) => Promise<unknown>;
        importData: (params: unknown) => Promise<unknown>;
        insertRow: (params: unknown) => Promise<unknown>;
        updateCell: (params: unknown) => Promise<unknown>;
        updateRow: (params: unknown) => Promise<unknown>;
        deleteRows: (params: unknown) => Promise<unknown>;
        searchForeignKey: (params: unknown) => Promise<unknown>;
      };
    };

    await exposed.connectionApi.getAll();
    expect(invoke).toHaveBeenCalledWith("connections:get-all");

    await exposed.connectionApi.showOpenFileDialog({ title: "Select file" });
    expect(invoke).toHaveBeenCalledWith("connections:show-open-file-dialog", {
      title: "Select file",
    });

    const triggerMetaParams = {
      connectionId: "c1",
      schema: "app",
      table: "users",
    };
    await exposed.tableDataApi.getTriggers(triggerMetaParams);
    expect(invoke).toHaveBeenCalledWith(
      "table-data:get-triggers",
      triggerMetaParams,
    );

    await exposed.tableDataApi.getTypes(triggerMetaParams);
    expect(invoke).toHaveBeenCalledWith(
      "table-data:get-types",
      triggerMetaParams,
    );

    const toggleTriggerParams = {
      ...triggerMetaParams,
      trigger: "users_audit_trigger",
      enabled: false,
    };
    await exposed.tableDataApi.toggleTrigger(toggleTriggerParams);
    expect(invoke).toHaveBeenCalledWith(
      "table-data:toggle-trigger",
      toggleTriggerParams,
    );

    const cleanup = exposed.tableDataApi.onExportProgress(vi.fn());
    expect(on).toHaveBeenCalledWith(
      "table-data:export-progress",
      expect.any(Function),
    );

    cleanup();
    expect(removeListener).toHaveBeenCalledWith(
      "table-data:export-progress",
      expect.any(Function),
    );

    // Write path: updateCell forwards to the UPDATE_CELL channel.
    const updateParams = {
      connectionId: "c1",
      schema: "app",
      table: "users",
      pkColumns: ["id"],
      pkValues: [1],
      column: "display_name",
      pgCast: "text",
      newValue: "new",
      setNull: false,
    };
    await exposed.tableDataApi.updateCell(updateParams);
    expect(invoke).toHaveBeenCalledWith("table-data:update-cell", updateParams);

    // Atomic multi-field row update: forwards to UPDATE_ROW.
    const rowParams = {
      connectionId: "c1",
      schema: "app",
      table: "users",
      pkColumns: ["id"],
      pkValues: [1],
      changes: [
        {
          column: "display_name",
          pgCast: "text",
          newValue: "x",
          setNull: false,
        },
        { column: "login_count", pgCast: "int4", newValue: 5, setNull: false },
      ],
    };
    await exposed.tableDataApi.updateRow(rowParams);
    expect(invoke).toHaveBeenCalledWith("table-data:update-row", rowParams);

    const deleteParams = {
      connectionId: "c1",
      schema: "app",
      table: "users",
      whereClause: "id <= 5",
    };
    await exposed.tableDataApi.deleteRows(deleteParams);
    expect(invoke).toHaveBeenCalledWith("table-data:delete-rows", deleteParams);

    // Insert flows: open dialog, file import, single-row insert.
    const openDialogOptions = { purpose: "import", title: "Import" };
    await exposed.tableDataApi.showOpenDialog(openDialogOptions);
    expect(invoke).toHaveBeenCalledWith(
      "table-data:show-open-dialog",
      openDialogOptions,
    );

    const importParams = {
      connectionId: "c1",
      schema: "app",
      table: "users",
      filePath: "/tmp/data.csv",
      format: "csv",
      operationId: "import-1",
    };
    await exposed.tableDataApi.importData(importParams);
    expect(invoke).toHaveBeenCalledWith("table-data:import-data", importParams);

    const insertParams = {
      connectionId: "c1",
      schema: "app",
      table: "users",
      changes: [
        { column: "email", pgCast: "text", newValue: "a@b.co", setNull: false },
      ],
    };
    await exposed.tableDataApi.insertRow(insertParams);
    expect(invoke).toHaveBeenCalledWith("table-data:insert-row", insertParams);

    const importCleanup = exposed.tableDataApi.onImportProgress(vi.fn());
    expect(on).toHaveBeenCalledWith(
      "table-data:import-progress",
      expect.any(Function),
    );
    importCleanup();
    expect(removeListener).toHaveBeenCalledWith(
      "table-data:import-progress",
      expect.any(Function),
    );

    // FK search: forwards to SEARCH_FK channel.
    const fkParams = {
      connectionId: "c1",
      schema: "app",
      table: "users",
      valueColumn: "id",
      labelColumn: "display_name",
      query: "ali",
      limit: 50,
    };
    await exposed.tableDataApi.searchForeignKey(fkParams);
    expect(invoke).toHaveBeenCalledWith("table-data:search-fk", fkParams);
  });

  it("forwards rolesApi calls to the roles channels", async () => {
    await import("@/preload");
    const rolesApi = exposeInMainWorld.mock.calls.find(
      ([key]) => key === "rolesApi",
    )?.[1] as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const membership = {
      connectionId: "c1",
      memberName: "reader",
      parentRoleName: "readers",
    };
    const accessLevel = {
      connectionId: "c1",
      userName: "reader",
      databaseName: "app",
      level: "readonly",
      applyToFutureTables: true,
    };
    const restrictions = {
      connectionId: "c1",
      userName: "reader",
      databaseName: "app",
      tables: [{ schema: "public", name: "orders", level: "readonly" }],
    };
    const trigger = {
      connectionId: "c1",
      databaseName: "app",
      schemaName: "public",
      tableName: "orders",
      triggerName: "audit",
      enabled: false,
    };
    const calls: Array<[string, unknown[], string, unknown]> = [
      [
        "getSnapshot",
        ["c1", "reader"],
        "roles:get-snapshot",
        { connectionId: "c1", targetUser: "reader" },
      ],
      [
        "getSidebarSummary",
        ["c1"],
        "roles:get-sidebar-summary",
        { connectionId: "c1" },
      ],
      [
        "createRole",
        [{ connectionId: "c1", name: "r", login: true }],
        "roles:create-role",
        { connectionId: "c1", name: "r", login: true },
      ],
      [
        "alterRole",
        [{ connectionId: "c1", name: "r", login: false }],
        "roles:alter-role",
        { connectionId: "c1", name: "r", login: false },
      ],
      [
        "dropRole",
        ["c1", "r"],
        "roles:drop-role",
        { connectionId: "c1", name: "r" },
      ],
      ["grantMembership", [membership], "roles:grant-membership", membership],
      ["revokeMembership", [membership], "roles:revoke-membership", membership],
      [
        "alterRolePassword",
        ["c1", "r", "pw"],
        "roles:alter-role-password",
        { connectionId: "c1", name: "r", password: "pw" },
      ],
      [
        "alterRoleComment",
        ["c1", "r", null],
        "roles:alter-role-comment",
        { connectionId: "c1", name: "r", comment: null },
      ],
      [
        "setDbAccessLevel",
        [accessLevel],
        "roles:set-db-access-level",
        accessLevel,
      ],
      [
        "setTableRestrictions",
        [restrictions],
        "roles:set-table-restrictions",
        restrictions,
      ],
      [
        "cloneRole",
        [{ connectionId: "c1", sourceName: "a", newName: "b" }],
        "roles:clone-role",
        { connectionId: "c1", sourceName: "a", newName: "b" },
      ],
      [
        "renameRole",
        [{ connectionId: "c1", oldName: "a", newName: "b" }],
        "roles:rename-role",
        { connectionId: "c1", oldName: "a", newName: "b" },
      ],
      [
        "listTriggers",
        ["c1", "app"],
        "roles:list-triggers",
        { connectionId: "c1", databaseName: "app" },
      ],
      ["setTriggerEnabled", [trigger], "roles:set-trigger-enabled", trigger],
      [
        "getEffectivePermissions",
        ["c1", "reader"],
        "roles:get-effective-permissions",
        { connectionId: "c1", user: "reader" },
      ],
      ["getAuditLog", ["c1"], "roles:get-audit-log", { connectionId: "c1" }],
      [
        "clearAuditLog",
        ["c1"],
        "roles:clear-audit-log",
        { connectionId: "c1" },
      ],
    ];

    expect(Object.keys(rolesApi).sort()).toEqual(
      calls.map(([method]) => method).sort(),
    );
    for (const [method, args, channel, payload] of calls) {
      invoke.mockClear();
      await rolesApi[method]!(...args);
      expect(invoke).toHaveBeenCalledWith(channel, payload);
    }
  });

  it("exposes backupApi (not dbSyncApi) and forwards its calls", async () => {
    await import("@/preload");
    const exposedKeys = exposeInMainWorld.mock.calls.map(([key]) => key);
    expect(exposedKeys).toContain("backupApi");
    expect(exposedKeys).not.toContain("dbSyncApi");
    const backupApi = exposeInMainWorld.mock.calls.find(
      ([key]) => key === "backupApi",
    )?.[1] as Record<string, (...args: unknown[]) => unknown>;

    const createInput = {
      runId: "run-12345678",
      source: { connectionId: "c1", database: "app" },
    };
    const restoreInput = {
      runId: "run-12345678",
      target: { connectionId: "c1", database: "app" },
      backupPath: "/tmp/app.dump",
      confirmProduction: true,
    };
    const calls: Array<[string, unknown[], unknown[]]> = [
      [
        "listDatabases",
        [{ connectionId: "c1" }],
        ["backup:list-databases", { connectionId: "c1" }],
      ],
      [
        "cancel",
        [{ runId: "run-12345678" }],
        ["backup:cancel", { runId: "run-12345678" }],
      ],
      ["listBackups", [], ["backup:list-backups"]],
      ["backup", [createInput], ["backup:create", createInput]],
      ["restore", [restoreInput], ["backup:restore", restoreInput]],
      ["showRestoreFileDialog", [], ["backup:show-restore-file-dialog"]],
      [
        "deleteBackup",
        ["/tmp/app.dump"],
        ["backup:delete", { path: "/tmp/app.dump" }],
      ],
      [
        "inspectBackup",
        ["/tmp/app.dump"],
        ["backup:inspect", { path: "/tmp/app.dump" }],
      ],
    ];

    expect(Object.keys(backupApi).sort()).toEqual(
      [...calls.map(([method]) => method), "onProgress"].sort(),
    );
    for (const [method, args, invokeArgs] of calls) {
      invoke.mockClear();
      await backupApi[method]!(...args);
      expect(invoke).toHaveBeenCalledWith(...invokeArgs);
    }

    const callback = vi.fn();
    const unsubscribe = backupApi.onProgress!(callback) as () => void;
    expect(on).toHaveBeenCalledWith("backup:progress", expect.any(Function));
    const listener = on.mock.calls.find(
      ([channel]) => channel === "backup:progress",
    )?.[1] as (event: unknown, progress: unknown) => void;
    const progress = { runId: "run-12345678", line: "done", level: "info" };
    listener({}, progress);
    expect(callback).toHaveBeenCalledWith(progress);
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith("backup:progress", listener);
  });
});
