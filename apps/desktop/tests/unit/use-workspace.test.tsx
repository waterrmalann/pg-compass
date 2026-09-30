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
    expect(new Set(ids).size).toBe(ids.length);
    // schema-list and schema share a prefix but differ by schemaName suffix.
    expect(ids[0]).not.toBe(ids[1]);
    // table-list vs table-details differ only by the type segment.
    expect(ids[2]).not.toBe(ids[3]);
  });

  it("navigateToView replaces the active tab instead of appending when target is new", async () => {
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
      await result.current.openTab({
        type: "schema",
        path: {
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "app",
        },
      });
      await result.current.openTab({
        type: "schema",
        path: {
          connectionId: "conn-1",
          connectionLabel: "Local",
          schemaName: "public",
        },
      });
    });

    const activeId = result.current.activeTabId!;
    act(() => {
      result.current.closeTab(activeId);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe(result.current.tabs[0]!.id);

    act(() => {
      result.current.closeTab(result.current.tabs[0]!.id);
    });
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
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
        dataQuery: { filter: "id > 10", projection: "", sort: "" },
        dataViewMode: "card",
      });
    });
    expect(result.current.relationSessions[tabId]).toMatchObject({
      activeSubTab: "indexes",
      dataPageSize: 100,
      dataQuery: { filter: "id > 10", projection: "", sort: "" },
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
