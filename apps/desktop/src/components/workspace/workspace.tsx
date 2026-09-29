import {
  useEffect,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useConnections } from "@/hooks/use-connections";
import { useWorkspace } from "@/hooks/use-workspace";
import { useDensity } from "@/hooks/use-density";
import { useWorkspaceShortcuts } from "@/hooks/use-workspace-shortcuts";
import { SchemaViewer } from "@/components/workspace/schema-viewer";
import { SchemaListViewer } from "@/components/workspace/schema-list-viewer";
import { TableListViewer } from "@/components/workspace/table-list-viewer";
import { TableDetailsViewer } from "@/components/workspace/table-details-viewer";
import { ViewListViewer } from "@/components/workspace/view-list-viewer";
import { ViewDetailsViewer } from "@/components/workspace/view-details-viewer";
import { UsersViewer } from "@/components/workspace/users-viewer";
import { DatabaseManagerViewer } from "@/components/workspace/database-manager-viewer";
import { ShellViewer } from "@/components/workspace/shell-viewer";
import type { WorkspaceTab, WorkspaceTabView } from "@/shared/types/workspace";
import { WelcomeScreen } from "./welcome-screen";
import { ApplicationTitle } from "../topbar/application-title";
import { buildWindowTitle } from "./utils/build-window-title";
import { matchesShortcut } from "@/shared/constants/shortcuts";

export function Workspace() {
  const { tabs, activeTabId, setActiveTab, closeTab, closeAllTabs } =
    useWorkspace();
  const density = useDensity();
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  useWorkspaceShortcuts(tabs, activeTabId, closeTab, setActiveTab);

  useEffect(function setupGlobalSearchShortcut() {
    function handleKeyDown(event: KeyboardEvent) {
      if (!matchesShortcut("editor-find", event)) return;
      if (document.activeElement?.closest(".cm-editor")) return;
      // The shell has its own find bar.
      if (document.activeElement?.closest("[data-terminal]")) return;

      const editor = document.querySelector("[data-query-editor] .cm-content");
      if (editor instanceof HTMLElement) {
        event.preventDefault();
        editor.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(function setupRefreshShortcut() {
    function handleKeyDown(event: KeyboardEvent) {
      if (!matchesShortcut("refresh", event)) return;
      if (document.activeElement?.closest(".cm-editor")) return;
      // Ctrl+R is psql's reverse history search.
      if (document.activeElement?.closest("[data-terminal]")) return;
      const button = document.querySelector(
        '[aria-hidden="false"] [data-view-refresh]',
      );
      if (button instanceof HTMLButtonElement && !button.disabled) {
        event.preventDefault();
        button.click();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <main
      className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background"
      data-density={density}
    >
      <ApplicationTitle>{buildWindowTitle(activeTab?.view)}</ApplicationTitle>
      <WorkspaceTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTab}
        onCloseTab={closeTab}
        onCloseAllTabs={closeAllTabs}
      />
      {tabs.length === 0 ? (
        <WelcomeScreen />
      ) : (
        <WorkspaceTabPanels tabs={tabs} activeTabId={activeTabId} />
      )}
    </main>
  );
}

function WorkspaceTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseAllTabs,
}: Readonly<{
  tabs: ReturnType<typeof useWorkspace>["tabs"];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAllTabs: () => void;
}>) {
  const { connections } = useConnections();

  // Resolve colours from the live connection list so every tab of a
  // connection is tinted (not only ones opened from the sidebar) and colour
  // edits apply immediately. The colour stored on the tab is a fallback.
  function colorFor(tab: WorkspaceTab): string | undefined {
    const { view } = tab;
    if (view.type === "database-manager") return undefined;
    const connection = connections.find(
      (item) => item.id === view.path.connectionId,
    );
    return connection ? connection.color : tab.color;
  }

  if (tabs.length === 0) {
    return (
      <div className="flex h-10 min-h-10 items-center border-b border-border bg-sidebar px-4">
        <span className="text-xs text-muted-foreground">No tabs open</span>
      </div>
    );
  }

  return (
    <div className="workspace-tab-scrollbar flex h-10 min-h-10 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border bg-sidebar px-1.5">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const color = colorFor(tab);

        function handleTabAuxClick(event: ReactMouseEvent<HTMLButtonElement>) {
          if (event.button !== 1) return;
          event.preventDefault();
          onCloseTab(tab.id);
        }

        function handleTabMouseDown(event: ReactMouseEvent<HTMLButtonElement>) {
          if (event.button === 1) {
            event.preventDefault();
          }
        }

        return (
          <ContextMenu key={tab.id}>
            <ContextMenuTrigger asChild>
              <div
                title={tab.title}
                data-active={isActive}
                className={cn(
                  "group flex h-7 w-44 min-w-32 max-w-44 shrink-0 items-center gap-1.5 rounded-md border pr-0.5 pl-2.5 text-xs transition-colors duration-150",
                  isActive
                    ? "border-border bg-background font-medium text-foreground shadow-xs/5 dark:shadow-edge"
                    : "border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                  color && connectionTintClassName(isActive),
                )}
                style={
                  color ? ({ "--tab-tint": color } as CSSProperties) : undefined
                }
              >
                {color ? (
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                ) : null}
                <button
                  type="button"
                  className="h-full min-w-0 flex-1 cursor-pointer truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onMouseDown={handleTabMouseDown}
                  onAuxClick={handleTabAuxClick}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectTab(tab.id);
                  }}
                >
                  {tab.title}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    "size-5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [&_svg]:size-3",
                    isActive && "opacity-100",
                  )}
                  aria-label={`Close ${tab.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  <X />
                </Button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-40">
              <ContextMenuItem onClick={() => onCloseTab(tab.id)}>
                Close
              </ContextMenuItem>
              <ContextMenuItem onClick={onCloseAllTabs}>
                Close all tabs
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}

/**
 * Tabs from a coloured connection carry a light tint of that colour so tabs
 * from different databases are easy to tell apart (docs/DESIGN.md §15). The
 * colour is user data, so it is applied through the `--tab-tint` variable.
 */
function connectionTintClassName(isActive: boolean): string {
  if (isActive) {
    return "border-[color:color-mix(in_oklab,var(--tab-tint)_45%,var(--border))] bg-[color:color-mix(in_oklab,var(--tab-tint)_16%,var(--background))]";
  }
  return "border-[color:color-mix(in_oklab,var(--tab-tint)_22%,transparent)] bg-[color:color-mix(in_oklab,var(--tab-tint)_9%,transparent)] hover:bg-[color:color-mix(in_oklab,var(--tab-tint)_15%,transparent)]";
}

function WorkspaceTabPanels({
  tabs,
  activeTabId,
}: Readonly<{
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}>) {
  return (
    <div className="relative flex-1 overflow-hidden">
      {tabs.map((tab) => (
        <TabPanel key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
      ))}
    </div>
  );
}

function TabPanel({
  tab,
  isActive,
}: Readonly<{
  tab: WorkspaceTab;
  isActive: boolean;
}>) {
  return (
    <div
      className={cn(
        "absolute inset-0",
        isActive ? "z-10 visible" : "z-0 invisible",
      )}
      aria-hidden={!isActive}
    >
      <TabViewRenderer tab={tab} />
    </div>
  );
}

function TabViewRenderer({ tab }: Readonly<{ tab: WorkspaceTab }>) {
  const view: WorkspaceTabView = tab.view;
  if (view.type === "schema") {
    return <SchemaViewer path={view.path} />;
  }
  if (view.type === "schema-list") {
    return <SchemaListViewer path={view.path} />;
  }
  if (view.type === "table-list") {
    return <TableListViewer path={view.path} />;
  }
  if (view.type === "table-details") {
    return <TableDetailsViewer tabId={tab.id} path={view.path} />;
  }
  if (view.type === "view-list") {
    return <ViewListViewer path={view.path} />;
  }
  if (view.type === "view-details") {
    return <ViewDetailsViewer tabId={tab.id} path={view.path} />;
  }
  if (view.type === "users") {
    return <UsersViewer path={view.path} />;
  }
  if (view.type === "shell") {
    return <ShellViewer path={view.path} />;
  }
  if (view.type === "database-manager") {
    return <DatabaseManagerViewer />;
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <span className="text-xs text-muted-foreground">
        Unsupported viewer type.
      </span>
    </div>
  );
}
