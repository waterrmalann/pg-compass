import { useEffect, useRef } from 'react';
import { Compass, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/hooks/use-workspace';
import { SchemaViewer } from '@/components/workspace/schema-viewer';
import { SchemaListViewer } from '@/components/workspace/schema-list-viewer';
import { TableListViewer } from '@/components/workspace/table-list-viewer';
import { TableDetailsViewer } from '@/components/workspace/table-details-viewer';
import { ViewListViewer } from '@/components/workspace/view-list-viewer';
import { ViewDetailsViewer } from '@/components/workspace/view-details-viewer';

export function Workspace() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useWorkspace();

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  // Stable refs to avoid stale closures in IPC callbacks
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // IPC-driven shortcuts: Ctrl+W, Ctrl+Tab, Ctrl+Shift+Tab
  useEffect(() => {
    const removeClose = globalThis.window.workspaceApi.onCloseTab(() => {
      const id = activeTabIdRef.current;
      if (id) closeTab(id);
    });

    const removeNext = globalThis.window.workspaceApi.onNextTab(() => {
      const t = tabsRef.current;
      if (t.length === 0) return;
      const idx = t.findIndex((tab) => tab.id === activeTabIdRef.current);
      if (idx < 0) return;
      const nextTab = t[(idx + 1) % t.length];
      if (nextTab) setActiveTab(nextTab.id);
    });

    const removePrev = globalThis.window.workspaceApi.onPrevTab(() => {
      const t = tabsRef.current;
      if (t.length === 0) return;
      const idx = t.findIndex((tab) => tab.id === activeTabIdRef.current);
      if (idx < 0) return;
      const prevTab = t[(idx - 1 + t.length) % t.length];
      if (prevTab) setActiveTab(prevTab.id);
    });

    return () => {
      removeClose();
      removeNext();
      removePrev();
    };
  }, [closeTab, setActiveTab]);

  // Ctrl+F / Cmd+F: focus the visible query editor (if any)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key !== 'f') return;

      // Don't interfere if already inside a CodeMirror editor (let CM handle its own search)
      if (document.activeElement?.closest('.cm-editor')) return;

      const editor = document.querySelector(
        '[data-query-editor] .cm-content',
      );
      if (editor instanceof HTMLElement) {
        e.preventDefault();
        editor.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <WorkspaceTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTab}
        onCloseTab={closeTab}
      />
      <WorkspaceContent activeTab={activeTab} />
    </main>
  );
}

function WorkspaceTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
}: Readonly<{
  tabs: ReturnType<typeof useWorkspace>['tabs'];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}>) {
  if (tabs.length === 0) {
    return (
      <div className="flex h-10 min-h-10 items-center border-b border-border bg-card px-3">
        <span className="text-xs text-muted-foreground">No tabs open</span>
      </div>
    );
  }

  return (
    <div className="flex h-10 min-h-10 items-end gap-1 overflow-x-auto border-b border-border bg-card px-2 pt-1">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <div
            key={tab.id}
            className={cn(
              'group flex h-8 min-w-0 items-center gap-1 rounded-t-md border border-transparent px-2 text-xs',
              isActive
                ? 'border-border border-b-card bg-background text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
            style={tab.color ? { borderLeftColor: tab.color, borderLeftWidth: 2 } : undefined}
          >
            <button
              type="button"
              className="max-w-48 cursor-pointer truncate text-left"
              onClick={() => onSelectTab(tab.id)}
            >
              {tab.title}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-5 opacity-0 group-hover:opacity-100"
              aria-label={`Close ${tab.title}`}
              onClick={() => onCloseTab(tab.id)}
            >
              <X className="size-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function WorkspaceContent({
  activeTab,
}: Readonly<{
  activeTab: ReturnType<typeof useWorkspace>['tabs'][number] | null;
}>) {
  if (!activeTab) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <div className="rounded-xl bg-muted p-4">
            <Compass className="size-10 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold text-foreground">
              Welcome to PG Compass
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Connect to a PostgreSQL database using the sidebar to start
              exploring your schemas and tables.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab.view.type === 'schema') {
    return <SchemaViewer path={activeTab.view.path} />;
  }

  if (activeTab.view.type === 'schema-list') {
    return <SchemaListViewer path={activeTab.view.path} />;
  }

  if (activeTab.view.type === 'table-list') {
    return <TableListViewer path={activeTab.view.path} />;
  }

  if (activeTab.view.type === 'table-details') {
    return <TableDetailsViewer path={activeTab.view.path} />;
  }

  if (activeTab.view.type === 'view-list') {
    return <ViewListViewer path={activeTab.view.path} />;
  }

  if (activeTab.view.type === 'view-details') {
    return <ViewDetailsViewer path={activeTab.view.path} />;
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-background">
      <span className="text-sm text-muted-foreground">Unsupported viewer type.</span>
    </div>
  );
}
