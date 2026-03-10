import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Database, Plus, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useConnections } from '@/hooks/use-connections';
import { useSettings } from '@/hooks/use-settings';
import { ConnectionItem } from '@/components/connections/ConnectionItem';
import { ConnectionFormDialog } from '@/components/connections/ConnectionFormDialog';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import type { ConnectionConfig } from '@/shared/types/connection';

const SIDEBAR_DEFAULT_WIDTH = 256;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_VIEWPORT_RATIO = 0.45;

export function Sidebar() {
  const { settings, loading, updateSettings } = useSettings();
  const [formOpen, setFormOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const [editingConnection, setEditingConnection] = useState<
    ConnectionConfig | undefined
  >(undefined);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  function getMaxSidebarWidth() {
    return Math.max(
      SIDEBAR_MIN_WIDTH,
      Math.floor(globalThis.innerWidth * SIDEBAR_MAX_VIEWPORT_RATIO),
    );
  }

  function clampSidebarWidth(width: number) {
    return Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), getMaxSidebarWidth());
  }

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const nextWidth = clampSidebarWidth(event.clientX - sidebarLeft);

      setSidebarWidth(nextWidth);
    }

    function handlePointerUp() {
      setIsResizing(false);
      const nextWidth = Math.round(sidebarWidthRef.current);
      if (nextWidth !== settings.appearance.sidebarWidth) {
        updateSettings({ appearance: { sidebarWidth: nextWidth } }).catch(
          () => undefined,
        );
      }
    }

    const previousCursor = globalThis.document.body.style.cursor;
    const previousUserSelect = globalThis.document.body.style.userSelect;
    globalThis.document.body.style.cursor = 'col-resize';
    globalThis.document.body.style.userSelect = 'none';

    globalThis.addEventListener('pointermove', handlePointerMove);
    globalThis.addEventListener('pointerup', handlePointerUp);

    return () => {
      globalThis.removeEventListener('pointermove', handlePointerMove);
      globalThis.removeEventListener('pointerup', handlePointerUp);
      globalThis.document.body.style.cursor = previousCursor;
      globalThis.document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing, settings.appearance.sidebarWidth, updateSettings]);

  useEffect(() => {
    function handleWindowResize() {
      setSidebarWidth((current) => clampSidebarWidth(current));
    }

    globalThis.addEventListener('resize', handleWindowResize);

    return () => {
      globalThis.removeEventListener('resize', handleWindowResize);
    };
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }

    const persistedWidth = settings.appearance.sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH;
    setSidebarWidth(clampSidebarWidth(persistedWidth));
  }, [loading, settings.appearance.sidebarWidth]);

  function handleResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsResizing(true);
  }

  const maxSidebarWidth = getMaxSidebarWidth();

  function handleOpenCreate() {
    setEditingConnection(undefined);
    setFormOpen(true);
  }

  function handleEdit(connection: ConnectionConfig) {
    setEditingConnection(connection);
    setFormOpen(true);
  }

  return (
    <>
      <aside
        ref={sidebarRef}
        className="relative flex h-full min-h-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        style={{
          width: `${sidebarWidth}px`,
          minWidth: `${SIDEBAR_MIN_WIDTH}px`,
          maxWidth: `${maxSidebarWidth}px`,
        }}
      >
        <SidebarHeader onOpenSettings={() => setSettingsOpen(true)} />
        <Separator className="bg-sidebar-border" />
        <SidebarContent onEdit={handleEdit} />
        <Separator className="bg-sidebar-border" />
        <SidebarFooter onNewConnection={handleOpenCreate} />
        <button
          type="button"
          aria-label="Resize sidebar"
          className="absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-sidebar-primary/40"
          onPointerDown={handleResizeStart}
        />
      </aside>

      <ConnectionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editConnection={editingConnection}
      />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

function SidebarHeader({
  onOpenSettings,
}: Readonly<{
  onOpenSettings: () => void;
}>) {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <Database className="size-4 text-sidebar-primary" />
      <h1 className="flex-1 text-sm font-semibold tracking-tight">PG Compass</h1>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Open settings"
            onClick={onOpenSettings}
          >
            <Settings className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>Settings</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function SidebarContent({ onEdit }: Readonly<{ onEdit: (c: ConnectionConfig) => void }>) {
  const { connections, loading } = useConnections();

  // Separate favourites from the rest
  const favourites = connections.filter((c) => c.favourite);
  const others = connections.filter((c) => !c.favourite);

  if (loading) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 px-3 py-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={`skeleton-${String(i)}`} className="flex items-center gap-2 px-2 py-1.5">
              <div className="size-4 rounded bg-sidebar-accent" />
              <div className="h-3 flex-1 rounded bg-sidebar-accent" />
            </div>
          ))}
        </div>
      </ScrollArea>
    );
  }

  if (connections.length === 0) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <div className="rounded-lg bg-sidebar-accent p-3">
            <Database className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No connections yet</p>
          <p className="text-xs text-muted-foreground/60">
            Add a PostgreSQL connection to start exploring your databases.
          </p>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-0.5 px-2 py-2">
        {favourites.length > 0 && (
          <>
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
              Favourites
            </p>
            {favourites.map((c) => (
              <ConnectionItem key={c.id} connection={c} onEdit={onEdit} />
            ))}
            {others.length > 0 && (
              <Separator className="my-1.5 bg-sidebar-border" />
            )}
          </>
        )}
        {others.length > 0 && (
          <>
            {favourites.length > 0 && (
              <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                Connections
              </p>
            )}
            {others.map((c) => (
              <ConnectionItem key={c.id} connection={c} onEdit={onEdit} />
            ))}
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function SidebarFooter({
  onNewConnection,
}: Readonly<{
  onNewConnection: () => void;
}>) {
  return (
    <div className="mt-auto p-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={onNewConnection}
          >
            <Plus className="size-4" />
            <span>New Connection</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>Add a new PostgreSQL connection</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
