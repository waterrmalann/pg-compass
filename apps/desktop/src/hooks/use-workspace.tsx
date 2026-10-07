import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useConnections } from "@/hooks/use-connections";
import { useSettings } from "@/hooks/use-settings";
import type { DatabaseSchema } from "@/shared/types/connection";
import type {
  RelationSessionState,
  WorkspaceTab,
  WorkspaceTabView,
} from "@/shared/types/workspace";
import { DEFAULT_RELATION_SESSION } from "@/shared/types/workspace";

interface WorkspaceContextValue {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  schemaCache: Record<string, DatabaseSchema[]>;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeConnectionTabs: (connectionId: string) => void;
  closeAllTabs: () => void;
  /** Move a tab to `toIndex` in the tab strip (drag, or Move left/right). */
  moveTab: (id: string, toIndex: number) => void;
  openTab: (view: WorkspaceTabView, color?: string) => Promise<void>;
  forceOpenTab: (view: WorkspaceTabView, color?: string) => Promise<void>;
  navigateToView: (view: WorkspaceTabView) => Promise<void>;
  refreshSchemaTree: (
    connectionId: string,
    force?: boolean,
  ) => Promise<DatabaseSchema[]>;
  refreshSchemaTreeWithStatus: (
    connectionId: string,
    force?: boolean,
  ) => Promise<{ ok: boolean; data: DatabaseSchema[] }>;
  /** Patch path fields on all open tabs belonging to a connection. */
  refreshTabs: (
    connectionId: string,
    patch: { connectionLabel?: string },
  ) => void;
  relationSessions: Record<string, RelationSessionState>;
  updateRelationSession: (
    tabId: string,
    patch: Partial<RelationSessionState>,
  ) => void;
  /**
   * Bumped after any RBAC mutation so role summaries outside the Users view
   * (the sidebar footer) know to refetch.
   */
  rolesRevision: number;
  notifyRolesChanged: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function buildTabId(view: WorkspaceTabView): string {
  if (view.type === "database-manager") return "database-manager";

  const base = `${view.path.connectionId}:${view.type}`;

  if (view.type === "schema-list") return base;
  if (view.type === "schema") return `${base}:${view.path.schemaName}`;
  if (view.type === "table-list" || view.type === "table-details")
    return `${base}:${view.path.schemaName}:${view.path.tableName}`;
  // Deliberately excludes `selectedRole`: one Users tab per connection, its
  // selection updated in place (see `openTab`) rather than a new tab per
  // clicked role.
  if (view.type === "users") return base;
  // Shell tabs are opened with `forceOpenTab`, which appends a unique suffix.
  if (view.type === "shell") return base;

  // view-list or view-details
  return `${base}:${view.path.schemaName}:${view.path.viewName}`;
}

function buildTabTitle(view: WorkspaceTabView): string {
  if (view.type === "database-manager") return "Database manager";
  if (view.type === "schema-list") return view.path.connectionLabel;
  if (view.type === "schema") return view.path.schemaName;
  if (view.type === "table-list" || view.type === "table-details")
    return view.path.tableName;
  if (view.type === "users") return `${view.path.connectionLabel} · Users`;
  if (view.type === "shell") return `${view.path.connectionLabel} · Shell`;

  // view-list or view-details
  return view.path.viewName;
}

function buildWorkspaceTab(
  view: WorkspaceTabView,
  color?: string,
): WorkspaceTab {
  return {
    id: buildTabId(view),
    title: buildTabTitle(view),
    color,
    view,
  };
}

export function WorkspaceProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { getSchemaTree } = useConnections();
  const { settings } = useSettings();
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [schemaCache, setSchemaCache] = useState<
    Record<string, DatabaseSchema[]>
  >({});
  const [relationSessions, setRelationSessions] = useState<
    Record<string, RelationSessionState>
  >({});
  const [rolesRevision, setRolesRevision] = useState(0);

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const schemaCacheRef = useRef(schemaCache);
  schemaCacheRef.current = schemaCache;

  // openTab/forceOpenTab/navigateToView all `await refreshSchemaTree(...)`
  // before touching tabs/schemaCache. If the connection is removed (via
  // closeConnectionTabs) while that await is still pending, the stale
  // continuation must not resurrect a tab or schema-cache entry for a
  // connection the user just explicitly closed.
  const closedConnectionIdsRef = useRef<Set<string>>(new Set());

  const refreshSchemaTreeWithStatus = useCallback(
    async (
      connectionId: string,
      force = false,
    ): Promise<{ ok: boolean; data: DatabaseSchema[] }> => {
      if (!force && schemaCacheRef.current[connectionId]) {
        return { ok: true, data: schemaCacheRef.current[connectionId] };
      }

      let result;
      try {
        result = await getSchemaTree(connectionId, {
          includeInternalSchemas: !settings.general.hideInternalSchemas,
        });
      } catch (error) {
        toast.error("Failed to load schema tree", {
          description: (error as Error).message,
        });
        return { ok: false, data: [] };
      }

      if (!result.ok || !result.data) {
        toast.error("Failed to load schema tree", {
          description: result.error,
        });
        return { ok: false, data: [] };
      }

      if (closedConnectionIdsRef.current.has(connectionId)) {
        return { ok: false, data: [] };
      }

      setSchemaCache((prev) => ({
        ...prev,
        [connectionId]: result.data ?? [],
      }));
      return { ok: true, data: result.data };
    },
    [getSchemaTree, settings.general.hideInternalSchemas],
  );

  const refreshSchemaTree = useCallback(
    async (connectionId: string, force = false): Promise<DatabaseSchema[]> =>
      (await refreshSchemaTreeWithStatus(connectionId, force)).data,
    [refreshSchemaTreeWithStatus],
  );

  const refreshTabs = useCallback(
    (connectionId: string, patch: { connectionLabel?: string }) => {
      setTabs((prevTabs) =>
        prevTabs.map((tab) => {
          if (tab.view.type === "database-manager") return tab;
          if (tab.view.path.connectionId !== connectionId) return tab;
          const updatedView = {
            ...tab.view,
            path: { ...tab.view.path, ...patch },
          } as WorkspaceTabView;
          // Titles are derived from the view, so a renamed connection
          // retitles every tab that shows its label (database, Users, Shell).
          return {
            ...tab,
            title: buildTabTitle(updatedView),
            view: updatedView,
          };
        }),
      );
    },
    [],
  );

  const setActiveTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prevTabs) => {
      const nextTabs = prevTabs.filter((tab) => tab.id !== id);
      if (activeTabIdRef.current === id) {
        const fallback = nextTabs.at(-1);
        setActiveTabId(fallback?.id ?? null);
      }
      return nextTabs;
    });
    setRelationSessions((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const closeConnectionTabs = useCallback((connectionId: string) => {
    closedConnectionIdsRef.current.add(connectionId);
    setTabs((prevTabs) => {
      const removedIds = new Set(
        prevTabs
          .filter(
            (tab) =>
              tab.view.type !== "database-manager" &&
              tab.view.path.connectionId === connectionId,
          )
          .map((tab) => tab.id),
      );
      const nextTabs = prevTabs.filter(
        (tab) =>
          tab.view.type === "database-manager" ||
          tab.view.path.connectionId !== connectionId,
      );
      if (activeTabIdRef.current && removedIds.has(activeTabIdRef.current)) {
        setActiveTabId(nextTabs.at(-1)?.id ?? null);
      }
      setRelationSessions((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([tabId]) => !removedIds.has(tabId)),
        ),
      );
      return nextTabs;
    });
    setSchemaCache((prev) => {
      if (!(connectionId in prev)) return prev;
      const next = { ...prev };
      delete next[connectionId];
      return next;
    });
  }, []);

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
    setRelationSessions({});
  }, []);

  const moveTab = useCallback((id: string, toIndex: number) => {
    setTabs((prevTabs) => {
      const fromIndex = prevTabs.findIndex((tab) => tab.id === id);
      const movedTab = prevTabs[fromIndex];
      const lastIndex = prevTabs.length - 1;
      const targetIndex = Math.min(Math.max(toIndex, 0), lastIndex);
      if (!movedTab || fromIndex === targetIndex) return prevTabs;

      const nextTabs = prevTabs.filter((tab) => tab.id !== id);
      nextTabs.splice(targetIndex, 0, movedTab);
      return nextTabs;
    });
  }, []);

  const notifyRolesChanged = useCallback(() => {
    setRolesRevision((revision) => revision + 1);
  }, []);

  const updateRelationSession = useCallback(
    (tabId: string, patch: Partial<RelationSessionState>) => {
      setRelationSessions((prev) => ({
        ...prev,
        [tabId]: {
          ...(prev[tabId] ?? DEFAULT_RELATION_SESSION),
          ...patch,
        },
      }));
    },
    [],
  );

  const openTab = useCallback(
    async (view: WorkspaceTabView, color?: string) => {
      if (view.type !== "database-manager") {
        await refreshSchemaTree(view.path.connectionId);
        if (closedConnectionIdsRef.current.has(view.path.connectionId)) return;
      }

      const nextTab = buildWorkspaceTab(view, color);
      setTabs((prev) => {
        const existingIndex = prev.findIndex((tab) => tab.id === nextTab.id);
        if (existingIndex === -1) return [...prev, nextTab];
        // Refresh the existing tab's view/title (e.g. a new `selectedRole`
        // for the same Users tab) rather than leaving it stale — a no-op
        // for view types whose path is otherwise identical when the id
        // matches, so this doesn't affect other tab types.
        return prev.map((tab, index) =>
          index === existingIndex
            ? { ...tab, title: nextTab.title, view: nextTab.view }
            : tab,
        );
      });
      setActiveTabId(nextTab.id);
    },
    [refreshSchemaTree],
  );

  const forceOpenTab = useCallback(
    async (view: WorkspaceTabView, color?: string) => {
      if (view.type !== "database-manager") {
        await refreshSchemaTree(view.path.connectionId);
        if (closedConnectionIdsRef.current.has(view.path.connectionId)) return;
      }

      const nextTab = buildWorkspaceTab(view, color);
      const uniqueId = `${nextTab.id}:${globalThis.crypto.randomUUID()}`;
      setTabs((prev) => [...prev, { ...nextTab, id: uniqueId }]);
      setActiveTabId(uniqueId);
    },
    [refreshSchemaTree],
  );

  const navigateToView = useCallback(
    async (view: WorkspaceTabView) => {
      if (view.type !== "database-manager") {
        await refreshSchemaTree(view.path.connectionId);
        if (closedConnectionIdsRef.current.has(view.path.connectionId)) return;
      }

      const targetTabId = buildTabId(view);
      setTabs((prevTabs) => {
        const existingTargetTab = prevTabs.find(
          (tab) => tab.id === targetTabId,
        );
        if (existingTargetTab) {
          return prevTabs;
        }

        const currentActiveId = activeTabIdRef.current;
        const activeIndex = currentActiveId
          ? prevTabs.findIndex((tab) => tab.id === currentActiveId)
          : -1;
        const fallbackColor =
          activeIndex >= 0 ? prevTabs[activeIndex]?.color : undefined;
        const nextTab = buildWorkspaceTab(view, fallbackColor);

        if (activeIndex < 0) {
          return [...prevTabs, nextTab];
        }

        if (currentActiveId && currentActiveId !== targetTabId) {
          setRelationSessions((prev) => {
            if (!(currentActiveId in prev)) return prev;
            const next = { ...prev };
            delete next[currentActiveId];
            return next;
          });
        }
        return prevTabs.map((tab, index) =>
          index === activeIndex ? nextTab : tab,
        );
      });

      setActiveTabId(targetTabId);
    },
    [refreshSchemaTree],
  );

  const value = useMemo(
    () => ({
      tabs,
      activeTabId,
      schemaCache,
      setActiveTab,
      closeTab,
      closeConnectionTabs,
      closeAllTabs,
      moveTab,
      openTab,
      forceOpenTab,
      navigateToView,
      refreshSchemaTree,
      refreshSchemaTreeWithStatus,
      refreshTabs,
      relationSessions,
      updateRelationSession,
      rolesRevision,
      notifyRolesChanged,
    }),
    [
      tabs,
      activeTabId,
      schemaCache,
      setActiveTab,
      closeTab,
      closeConnectionTabs,
      closeAllTabs,
      moveTab,
      openTab,
      forceOpenTab,
      navigateToView,
      refreshSchemaTree,
      refreshSchemaTreeWithStatus,
      refreshTabs,
      relationSessions,
      updateRelationSession,
      rolesRevision,
      notifyRolesChanged,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
