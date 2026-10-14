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

type ExposedApi = Record<string, (...args: unknown[]) => unknown>;
/** [method, arguments, expected ipcRenderer.invoke arguments] */
type InvokeCase = [string, unknown[], unknown[]];

async function loadExposedApis(): Promise<Record<string, ExposedApi>> {
  await import("@/preload");
  return Object.fromEntries(
    exposeInMainWorld.mock.calls.map(([key, value]) => [key, value]),
  ) as Record<string, ExposedApi>;
}

async function expectInvokes(api: ExposedApi, cases: InvokeCase[]) {
  for (const [method, args, invokeArgs] of cases) {
    invoke.mockClear();
    await api[method]!(...args);
    expect(invoke).toHaveBeenCalledWith(...invokeArgs);
  }
}

/**
 * Fires the registered listener with an IpcRendererEvent and checks that the
 * renderer callback receives only the payload, then that unsubscribing
 * removes that same listener.
 */
function expectSubscription(
  api: ExposedApi,
  method: string,
  channel: string,
  payloadArgs: unknown[],
) {
  on.mockClear();
  removeListener.mockClear();
  const callback = vi.fn();
  const unsubscribe = api[method]!(callback) as () => void;

  expect(on).toHaveBeenCalledOnce();
  const [registeredChannel, listener] = on.mock.calls[0] as [
    string,
    (...args: unknown[]) => void,
  ];
  expect(registeredChannel).toBe(channel);
  listener({ sender: "ipc-renderer-event" }, ...payloadArgs);
  expect(callback).toHaveBeenCalledWith(...payloadArgs);

  unsubscribe();
  expect(removeListener).toHaveBeenCalledWith(channel, listener);
}

describe("preload API contract", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    on.mockReset();
    removeListener.mockReset();
    exposeInMainWorld.mockReset();
  });

  it("exposes exactly the renderer APIs", async () => {
    const apis = await loadExposedApis();
    expect(Object.keys(apis).sort()).toEqual(
      [
        "backupApi",
        "clipboardApi",
        "connectionApi",
        "helpApi",
        "rolesApi",
        "settingsApi",
        "shellApi",
        "tableDataApi",
        "updateApi",
        "workspaceApi",
      ].sort(),
    );
  });

  it("forwards connectionApi calls with their positional arguments", async () => {
    const { connectionApi } = await loadExposedApis();
    const input = { label: "Local", mode: "uri", uri: "postgresql://x" };
    const cases: InvokeCase[] = [
      ["getAll", [], ["connections:get-all"]],
      ["getById", ["c1"], ["connections:get-by-id", "c1"]],
      ["create", [input], ["connections:create", input]],
      ["update", ["c1", input], ["connections:update", "c1", input]],
      ["delete", ["c1"], ["connections:delete", "c1"]],
      ["toggleFavourite", ["c1"], ["connections:toggle-favourite", "c1"]],
      ["test", ["c1"], ["connections:test", "c1"]],
      [
        "getSchemaTree",
        ["c1", { hideInternalSchemas: true }],
        ["connections:get-schema-tree", "c1", { hideInternalSchemas: true }],
      ],
      [
        "getSchemaDiagram",
        [{ connectionId: "c1", schemas: ["public"] }],
        [
          "connections:get-schema-diagram",
          { connectionId: "c1", schemas: ["public"] },
        ],
      ],
      [
        "showOpenFileDialog",
        [{ title: "Select file" }],
        ["connections:show-open-file-dialog", { title: "Select file" }],
      ],
    ];

    expect(Object.keys(connectionApi!).sort()).toEqual(
      cases.map(([method]) => method).sort(),
    );
    await expectInvokes(connectionApi!, cases);
  });

  it("forwards settingsApi and clipboardApi calls", async () => {
    const { settingsApi, clipboardApi } = await loadExposedApis();
    const patch = { general: { readOnlyMode: true } };

    expect(Object.keys(settingsApi!).sort()).toEqual(["get", "update"]);
    expect(Object.keys(clipboardApi!)).toEqual(["writeText"]);
    await expectInvokes(settingsApi!, [
      ["get", [], ["settings:get"]],
      ["update", [patch], ["settings:update", patch]],
    ]);
    await expectInvokes(clipboardApi!, [
      ["writeText", ["copied"], ["clipboard:write-text", "copied"]],
    ]);
  });

  it("forwards tableDataApi calls and progress events", async () => {
    const { tableDataApi } = await loadExposedApis();
    // Every request method passes its single params object through as-is.
    const params = { connectionId: "c1", schema: "app", table: "users" };
    const channels: Array<[string, string]> = [
      ["getRows", "table-data:get-rows"],
      ["getStructure", "table-data:get-structure"],
      ["getQueryColumns", "table-data:get-query-columns"],
      ["getJsonKeys", "table-data:get-json-keys"],
      ["getIndexes", "table-data:get-indexes"],
      ["getConstraints", "table-data:get-constraints"],
      ["getTriggers", "table-data:get-triggers"],
      ["getTypes", "table-data:get-types"],
      ["toggleTrigger", "table-data:toggle-trigger"],
      ["executeQuery", "table-data:execute-query"],
      ["cancelQuery", "table-data:cancel-query"],
      ["showSaveDialog", "table-data:show-save-dialog"],
      ["showOpenDialog", "table-data:show-open-dialog"],
      ["previewQuerySql", "table-data:preview-query-sql"],
      ["exportData", "table-data:export-data"],
      ["sqlDump", "table-data:sql-dump"],
      ["importData", "table-data:import-data"],
      ["insertRow", "table-data:insert-row"],
      ["updateCell", "table-data:update-cell"],
      ["updateRow", "table-data:update-row"],
      ["deleteRows", "table-data:delete-rows"],
      ["searchForeignKey", "table-data:search-fk"],
    ];
    const cases: InvokeCase[] = channels.map(([method, channel]) => [
      method,
      [params],
      [channel, params],
    ]);

    expect(Object.keys(tableDataApi!).sort()).toEqual(
      [
        ...channels.map(([method]) => method),
        "onExportProgress",
        "onImportProgress",
      ].sort(),
    );
    await expectInvokes(tableDataApi!, cases);
    expectSubscription(
      tableDataApi!,
      "onExportProgress",
      "table-data:export-progress",
      [1_200],
    );
    expectSubscription(
      tableDataApi!,
      "onImportProgress",
      "table-data:import-progress",
      [{ operationId: "import-1", insertedCount: 500 }],
    );
  });

  it("subscribes helpApi and workspaceApi menu events without leaking the event", async () => {
    const { helpApi, workspaceApi } = await loadExposedApis();

    expect(Object.keys(helpApi!).sort()).toEqual(
      ["onShowAbout", "onShowLicense", "onShowShortcuts"].sort(),
    );
    expect(Object.keys(workspaceApi!).sort()).toEqual(
      ["onCloseTab", "onNextTab", "onPrevTab"].sort(),
    );
    expectSubscription(helpApi!, "onShowLicense", "help:show-license", []);
    expectSubscription(helpApi!, "onShowAbout", "help:show-about", []);
    expectSubscription(helpApi!, "onShowShortcuts", "help:show-shortcuts", []);
    expectSubscription(workspaceApi!, "onCloseTab", "workspace:close-tab", []);
    expectSubscription(workspaceApi!, "onNextTab", "workspace:next-tab", []);
    expectSubscription(workspaceApi!, "onPrevTab", "workspace:prev-tab", []);
  });

  it("forwards updateApi calls to the update channels", async () => {
    const { updateApi } = await loadExposedApis();

    expect(Object.keys(updateApi!).sort()).toEqual(
      ["getStatus", "install", "onStatusChanged"].sort(),
    );
    await expectInvokes(updateApi!, [
      ["getStatus", [], ["updates:get-status"]],
      ["install", [], ["updates:install"]],
    ]);
    expectSubscription(
      updateApi!,
      "onStatusChanged",
      "updates:status-changed",
      [{ state: "ready", version: "1.2.3" }],
    );
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

  it("forwards shellApi calls to the shell channels", async () => {
    await import("@/preload");
    const shellApi = exposeInMainWorld.mock.calls.find(
      ([key]) => key === "shellApi",
    )?.[1] as Record<string, (...args: unknown[]) => unknown>;

    const session = { sessionId: "session-12345678" };
    const calls: Array<[string, unknown[], unknown[]]> = [
      ["locatePsql", [], ["shell:locate-psql"]],
      [
        "start",
        [{ ...session, connectionId: "c1", cols: 80, rows: 24 }],
        ["shell:start", { ...session, connectionId: "c1", cols: 80, rows: 24 }],
      ],
      [
        "write",
        [{ ...session, data: "\\q\r" }],
        ["shell:write", { ...session, data: "\\q\r" }],
      ],
      [
        "resize",
        [{ ...session, cols: 100, rows: 30 }],
        ["shell:resize", { ...session, cols: 100, rows: 30 }],
      ],
      ["kill", [session], ["shell:kill", session]],
    ];

    expect(Object.keys(shellApi).sort()).toEqual(
      [...calls.map(([method]) => method), "onData", "onExit"].sort(),
    );
    for (const [method, args, invokeArgs] of calls) {
      invoke.mockClear();
      await shellApi[method]!(...args);
      expect(invoke).toHaveBeenCalledWith(...invokeArgs);
    }

    for (const [method, channel] of [
      ["onData", "shell:data"],
      ["onExit", "shell:exit"],
    ] as const) {
      const callback = vi.fn();
      const unsubscribe = shellApi[method]!(callback) as () => void;
      const listener = on.mock.calls.find(
        ([name]) => name === channel,
      )?.[1] as (event: unknown, payload: unknown) => void;
      listener({}, { ...session, data: "x" });
      expect(callback).toHaveBeenCalledWith({ ...session, data: "x" });
      unsubscribe();
      expect(removeListener).toHaveBeenCalledWith(channel, listener);
    }
  });
});
