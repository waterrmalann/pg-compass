import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider, useWorkspace } from "@/hooks/use-workspace";
import { ConnectionProvider } from "@/hooks/use-connections";
import { SettingsProvider } from "@/hooks/use-settings";
import { DEFAULT_APP_SETTINGS } from "@/shared/types/settings";

function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SettingsProvider>
      <ConnectionProvider>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </ConnectionProvider>
    </SettingsProvider>
  );
}

describe("useWorkspace", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    Object.assign(window, {
      settingsApi: {
        get: vi.fn().mockResolvedValue({
          success: true,
          data: DEFAULT_APP_SETTINGS,
        }),
        update: vi.fn(),
      },
      connectionApi: {
        getAll: vi.fn().mockResolvedValue({ success: true, data: [] }),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        toggleFavourite: vi.fn(),
        test: vi.fn(),
        getSchemaTree: vi.fn().mockResolvedValue({
          success: true,
          data: [{ name: "app", tables: ["users"], views: [] }],
        }),
      },
    });
  });

  it("opens tabs, caches schemas, and reuses existing tabs", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.tabs).toHaveLength(0));

    await act(async () => {
      await result.current.openTab({
        type: "schema",
        path: {
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
        },
      });
    });
    // A separate act lets the first open's cache write land before the second.
    await act(async () => {
      await result.current.openTab({
        type: "schema",
        path: {
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
        },
      });
    });

    await waitFor(() => expect(result.current.tabs).toHaveLength(1));
    expect(result.current.schemaCache["conn-1"]).toHaveLength(1);
    // The second open is served from the schema cache.
    expect(window.connectionApi.getSchemaTree).toHaveBeenCalledTimes(1);
  });

  it("retitles every tab that shows a renamed connection's label", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.tabs).toHaveLength(0));
    const path = { connectionId: "conn-1", connectionLabel: "Old" };

    await act(async () => {
      await result.current.openTab({ type: "schema-list", path });
      await result.current.openTab({ type: "users", path });
      await result.current.forceOpenTab({ type: "shell", path });
      await result.current.openTab({
        type: "schema",
        path: { ...path, schemaName: "app" },
      });
    });
    act(() => result.current.refreshTabs("conn-1", { connectionLabel: "New" }));

    expect(result.current.tabs.map((tab) => tab.title)).toEqual([
      "New",
      "New · Users",
      "New · Shell",
      "app",
    ]);
    const shellTab = result.current.tabs[2]!;
    expect(shellTab.view).toMatchObject({
      type: "shell",
      path: { connectionLabel: "New" },
    });
  });

  it("produces distinct tab IDs across view types and paths", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.tabs).toHaveLength(0));

    await act(async () => {
      await result.current.openTab({
        type: "schema-list",
        path: { connectionId: "conn-1", connectionLabel: "Local" },
      });
      await result.current.openTab({
        type: "schema",
        path: {
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
        },
      });
      await result.current.openTab({
        type: "table-list",
        path: {
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
          tableName: "users",
        },
      });
      await result.current.openTab({
        type: "table-details",
        path: {
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
          tableName: "users",
        },
      });
      await result.current.openTab({
        type: "view-list",
        path: {
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
          viewName: "users_v",
        },
      });
    });

    const ids = result.current.tabs.map((t) => t.id);
    // Five views opened as five tabs: none was merged into another.
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    // schema-list and schema share a prefix but differ by schemaName suffix.
    expect(ids[0]).not.toBe(ids[1]);
    // table-list vs table-details differ only by the type segment.
    expect(ids[2]).not.toBe(ids[3]);
  });

  it("navigateToView replaces the active tab and drops its relation session when target is new", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.tabs).toHaveLength(0));

    await act(async () => {
      await result.current.openTab(
        {
          type: "table-list",
          path: {
            connectionId: "conn-1",
            connectionLabel: "Local",
            schemaName: "app",
            tableName: "users",
          },
        },
        "#ff0000",
      );
    });
    expect(result.current.tabs).toHaveLength(1);
    const originalId = result.current.tabs[0]!.id;
    act(() => {
      result.current.updateRelationSession(originalId, { dataPageSize: 100 });
    });

    await act(async () => {
      await result.current.navigateToView({
        type: "table-list",
        path: {
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
          tableName: "orders",
        },
      });
    });

    // Replaced in place — still one tab, but different id, color inherited.
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0]!.id).not.toBe(originalId);
    expect(result.current.tabs[0]!.color).toBe("#ff0000");
    expect(result.current.activeTabId).toBe(result.current.tabs[0]!.id);
    // The replaced tab no longer exists, so its relation session goes too.
    expect(result.current.relationSessions[originalId]).toBeUndefined();
  });

  it("navigateToView focuses an existing matching tab without creating a duplicate", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.tabs).toHaveLength(0));

    const tableView = {
      type: "table-list" as const,
      path: {
        connectionId: "conn-1",
        connectionLabel: "Local",
        schemaName: "app",
        tableName: "users",
      },
    };
    const schemaView = {
      type: "schema" as const,
      path: {
        connectionId: "conn-1",
        connectionLabel: "Local",
        schemaName: "app",
      },
    };

    await act(async () => {
      await result.current.openTab(tableView);
      await result.current.openTab(schemaView);
    });
    expect(result.current.tabs).toHaveLength(2);
    const tableTabId = result.current.tabs[0]!.id;

    await act(async () => {
      await result.current.navigateToView(tableView);
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTabId).toBe(tableTabId);
  });

  it("closeTab falls back to the last remaining tab when the active one closes", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.tabs).toHaveLength(0));

    await act(async () => {
      for (const schemaName of ["app", "public", "audit"]) {
        await result.current.openTab({
          type: "schema",
          path: {
            connectionId: "conn-1",
            connectionLabel: "Local",
            schemaName,
          },
        });
      }
    });
    const [firstId, middleId, lastId] = result.current.tabs.map((t) => t.id);

    act(() => result.current.setActiveTab(middleId!));
    act(() => result.current.closeTab(middleId!));
    expect(result.current.tabs.map((t) => t.id)).toEqual([firstId, lastId]);
    expect(result.current.activeTabId).toBe(lastId);

    act(() => {
      result.current.closeTab(firstId!);
      result.current.closeTab(lastId!);
    });
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
  });

  it("closeTab keeps the active tab when another tab closes", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.tabs).toHaveLength(0));

    await act(async () => {
      for (const schemaName of ["app", "public", "audit"]) {
        await result.current.openTab({
          type: "schema",
          path: {
            connectionId: "conn-1",
            connectionLabel: "Local",
            schemaName,
          },
        });
      }
    });
    const [activeId, middleId, lastId] = result.current.tabs.map((t) => t.id);
    act(() => result.current.setActiveTab(activeId!));

    act(() => result.current.closeTab(middleId!));

    expect(result.current.tabs.map((t) => t.id)).toEqual([activeId, lastId]);
    expect(result.current.activeTabId).toBe(activeId);
  });

  it("closeConnectionTabs closes that connection's tabs and schema cache only", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.tabs).toHaveLength(0));

    await act(async () => {
      await result.current.openTab({
        type: "schema-list",
        path: { connectionId: "conn-1", connectionLabel: "Local" },
      });
      await result.current.openTab({ type: "database-manager" });
      await result.current.openTab({
        type: "schema-list",
        path: { connectionId: "conn-2", connectionLabel: "Staging" },
      });
    });
    const stagingTabId = result.current.tabs[2]!.id;
    act(() => {
      result.current.updateRelationSession(stagingTabId, { dataPageSize: 100 });
    });

    act(() => result.current.closeConnectionTabs("conn-1"));

    expect(result.current.tabs.map((tab) => tab.title)).toEqual([
      "Database manager",
      "Staging",
    ]);
    expect(result.current.schemaCache["conn-1"]).toBeUndefined();
    expect(result.current.schemaCache["conn-2"]).toBeDefined();
    expect(result.current.relationSessions[stagingTabId]).toMatchObject({
      dataPageSize: 100,
    });
  });

  it("does not reopen tabs or cache for a connection closed while its schema was loading", async () => {
    type SchemaTreeResult = Awaited<
      ReturnType<typeof window.connectionApi.getSchemaTree>
    >;
    let resolveSchemaTree: (value: SchemaTreeResult) => void = () => undefined;
    vi.mocked(window.connectionApi.getSchemaTree).mockReturnValue(
      new Promise((resolve) => {
        resolveSchemaTree = resolve;
      }),
    );
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.tabs).toHaveLength(0));
    const path = { connectionId: "conn-1", connectionLabel: "Local" };

    let pendingOpens: Promise<unknown>[] = [];
    act(() => {
      pendingOpens = [
        result.current.openTab({ type: "schema-list", path }),
        result.current.forceOpenTab({ type: "users", path }),
        result.current.navigateToView({
          type: "schema",
          path: { ...path, schemaName: "app" },
        }),
      ];
    });
    act(() => result.current.closeConnectionTabs("conn-1"));

    await act(async () => {
      resolveSchemaTree({
        success: true,
        data: [{ name: "app", tables: ["users"], views: [] }],
      });
      await Promise.all(pendingOpens);
    });

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.schemaCache["conn-1"]).toBeUndefined();
  });

  it("scopes relation session state to a tab and clears it when the connection closes", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.tabs).toHaveLength(0));

    await act(async () => {
      await result.current.openTab({
        type: "table-details",
        path: {
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
          tableName: "users",
        },
      });
    });
    const tabId = result.current.tabs[0]!.id;

    act(() => {
      result.current.updateRelationSession(tabId, {
        activeSubTab: "indexes",
        dataPageSize: 100,
        dataQuery: {
          filter: "id > 10",
          projection: "",
          sort: "",
          skip: "",
          limit: "",
        },
        dataViewMode: "card",
      });
    });
    expect(result.current.relationSessions[tabId]).toMatchObject({
      activeSubTab: "indexes",
      dataPageSize: 100,
      dataQuery: {
        filter: "id > 10",
        projection: "",
        sort: "",
        skip: "",
        limit: "",
      },
      dataViewMode: "card",
    });

    act(() => result.current.closeConnectionTabs("conn-1"));
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.relationSessions[tabId]).toBeUndefined();
  });

  it("reports schema refresh failures without treating an empty result as success", async () => {
    vi.mocked(window.connectionApi.getSchemaTree).mockResolvedValueOnce({
      success: false,
      error: "network unavailable",
    });
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.refreshSchemaTreeWithStatus("conn-failed", true),
      ).resolves.toEqual({ ok: false, data: [] });
    });
    expect(result.current.schemaCache["conn-failed"]).toBeUndefined();
  });

  it("closeAllTabs closes every tab, clears the active tab and relation sessions", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.tabs).toHaveLength(0));

    await act(async () => {
      await result.current.openTab({
        type: "table-details",
        path: {
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
          tableName: "users",
        },
      });
      await result.current.openTab({ type: "database-manager" });
    });
    const tableTabId = result.current.tabs[0]!.id;
    act(() => {
      result.current.updateRelationSession(tableTabId, { dataPageSize: 100 });
    });
    expect(result.current.tabs).toHaveLength(2);

    act(() => result.current.closeAllTabs());

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.relationSessions).toEqual({});

    // The workspace stays usable after closing everything.
    await act(async () => {
      await result.current.openTab({ type: "database-manager" });
    });
    expect(result.current.tabs.map((tab) => tab.title)).toEqual([
      "Database manager",
    ]);
    expect(result.current.activeTabId).toBe("database-manager");
  });

  it("bumps the roles revision when RBAC data changes", async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.tabs).toHaveLength(0));
    const before = result.current.rolesRevision;

    act(() => result.current.notifyRolesChanged());

    expect(result.current.rolesRevision).toBe(before + 1);
  });
});
