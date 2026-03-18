import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { useConnections } from '@/hooks/use-connections';
import { useSettings } from '@/hooks/use-settings';
import type { DatabaseSchema } from '@/shared/types/connection';
import type {
  WorkspaceTab,
  WorkspaceTabView,
} from '@/shared/types/workspace';

interface WorkspaceContextValue {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  schemaCache: Record<string, DatabaseSchema[]>;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  openTab: (view: WorkspaceTabView, color?: string) => Promise<void>;
  navigateToView: (view: WorkspaceTabView) => Promise<void>;
  refreshSchemaTree: (connectionId: string, force?: boolean) => Promise<DatabaseSchema[]>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function buildTabId(view: WorkspaceTabView): string {
  const base = `${view.path.connectionId}:${view.type}`;

  if (view.type === 'schema-list') return base;
  if (view.type === 'schema') return `${base}:${view.path.schemaName}`;
  if (view.type === 'table-list' || view.type === 'table-details')
    return `${base}:${view.path.schemaName}:${view.path.tableName}`;

  // view-list or view-details
  return `${base}:${view.path.schemaName}:${view.path.viewName}`;
}

function buildTabTitle(view: WorkspaceTabView): string {
  if (view.type === 'schema-list') return view.path.connectionLabel;
  if (view.type === 'schema') return view.path.schemaName;
  if (view.type === 'table-list' || view.type === 'table-details') return view.path.tableName;

  // view-list or view-details
  return view.path.viewName;
}

function buildWorkspaceTab(view: WorkspaceTabView, color?: string): WorkspaceTab {
  return {
    id: buildTabId(view),
    title: buildTabTitle(view),
    color,
    view,
  };
}

export function WorkspaceProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { getSchemaTree } = useConnections();
  const { settings } = useSettings();
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [schemaCache, setSchemaCache] = useState<Record<string, DatabaseSchema[]>>({});

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const schemaCacheRef = useRef(schemaCache);
  schemaCacheRef.current = schemaCache;

  const refreshSchemaTree = useCallback(
    async (connectionId: string, force = false): Promise<DatabaseSchema[]> => {
      if (!force && schemaCacheRef.current[connectionId]) {
        return schemaCacheRef.current[connectionId];
      }

      const result = await getSchemaTree(connectionId, {
        includeInternalSchemas: !settings.general.hideInternalSchemas,
      });

      if (!result.ok || !result.data) {
        toast.error('Failed to load schema tree', {
          description: result.error,
        });
        return [];
      }

      setSchemaCache((prev) => ({
        ...prev,
        [connectionId]: result.data ?? [],
      }));
      return result.data;
    },
    [getSchemaTree, settings.general.hideInternalSchemas],
  );

  const setActiveTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prevTabs) => {
        const nextTabs = prevTabs.filter((tab) => tab.id !== id);
        if (activeTabIdRef.current === id) {
          const fallback = nextTabs.at(-1);
          setActiveTabId(fallback?.id ?? null);
        }
        return nextTabs;
      });
    },
    [],
  );

  const openTab = useCallback(
    async (view: WorkspaceTabView, color?: string) => {
      await refreshSchemaTree(view.path.connectionId);

      const nextTab = buildWorkspaceTab(view, color);
      setTabs((prev) => {
        const existing = prev.find((tab) => tab.id === nextTab.id);
        if (existing) return prev;
        return [...prev, nextTab];
      });
      setActiveTabId(nextTab.id);
    },
    [refreshSchemaTree],
  );

  const navigateToView = useCallback(
    async (view: WorkspaceTabView) => {
      await refreshSchemaTree(view.path.connectionId);

      const targetTabId = buildTabId(view);
      setTabs((prevTabs) => {
        const existingTargetTab = prevTabs.find((tab) => tab.id === targetTabId);
        if (existingTargetTab) {
          return prevTabs;
        }

        const currentActiveId = activeTabIdRef.current;
        const activeIndex = currentActiveId
          ? prevTabs.findIndex((tab) => tab.id === currentActiveId)
          : -1;
        const fallbackColor = activeIndex >= 0 ? prevTabs[activeIndex]?.color : undefined;
        const nextTab = buildWorkspaceTab(view, fallbackColor);

        if (activeIndex < 0) {
          return [...prevTabs, nextTab];
        }

        return prevTabs.map((tab, index) => (index === activeIndex ? nextTab : tab));
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
      openTab,
      navigateToView,
      refreshSchemaTree,
    }),
    [
      tabs,
      activeTabId,
      schemaCache,
      setActiveTab,
      closeTab,
      openTab,
      navigateToView,
      refreshSchemaTree,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return ctx;
}
