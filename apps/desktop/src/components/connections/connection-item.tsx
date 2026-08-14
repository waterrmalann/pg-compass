import { useState } from "react";
import {
  ChevronRight,
  Copy,
  Database,
  Edit,
  Loader2,
  Plug,
  PlugZap,
  RefreshCw,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { deriveActiveSelection } from "@/components/sidebar/active-selection";
import { useConnections } from "@/hooks/use-connections";
import { useWorkspace } from "@/hooks/use-workspace";
import type {
  ConnectionConfig,
  DatabaseSchema,
} from "@/shared/types/connection";
import { buildConnectionString } from "./connection-string";
import { SchemaTreeNode } from "./schema-tree-node";

export { buildConnectionString } from "./connection-string";

interface ConnectionItemProps {
  connection: ConnectionConfig;
  onEdit: (connection: ConnectionConfig) => void;
  connected: boolean;
  onConnectedChange: (connected: boolean) => void;
  searchSchemas?: DatabaseSchema[];
  searchActive?: boolean;
}

export function ConnectionItem({
  connection,
  onEdit,
  connected,
  onConnectedChange,
  searchSchemas,
  searchActive = false,
}: Readonly<ConnectionItemProps>) {
  const { remove, toggleFavourite, testConnection } = useConnections();
  const {
    schemaCache,
    refreshSchemaTree,
    refreshSchemaTreeWithStatus,
    openTab,
    forceOpenTab,
    closeConnectionTabs,
    tabs,
    activeTabId,
  } = useWorkspace();
  const [connecting, setConnecting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [schemasLoading, setSchemasLoading] = useState(false);
  const [expandedSchemas, setExpandedSchemas] = useState<
    Record<string, boolean>
  >({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const schemas: DatabaseSchema[] = searchActive
    ? (searchSchemas ?? [])
    : (schemaCache[connection.id] ?? []);

  const selection = deriveActiveSelection(tabs, activeTabId);
  const isConnectionActive = selection?.connectionId === connection.id;
  const isConnectionLeaf =
    isConnectionActive && selection?.kind === "connection";
  // Only project the selection onto this connection's tree when it owns it.
  const treeSelection = isConnectionActive ? selection : null;

  async function handleConnect(): Promise<boolean> {
    setConnecting(true);
    // Verify we can reach the server before marking this item as connected.
    const result = await testConnection(connection.id);
    setConnecting(false);

    if (result.ok) {
      onConnectedChange(true);
      toast.success(`Connected to "${connection.label}"`);
      return true;
    } else {
      toast.error(`Failed to connect to "${connection.label}"`, {
        description: result.error,
      });
      return false;
    }
  }

  async function handleExpand() {
    if (!connected) return;

    const willExpand = !expanded;
    setExpanded(willExpand);

    if (willExpand && !schemasLoading && schemas.length === 0) {
      setSchemasLoading(true);
      const result = await refreshSchemaTree(connection.id);
      setSchemasLoading(false);

      if (result.length > 0) {
        setExpandedSchemas({});
      }
    }
  }

  function toggleSchema(schemaName: string) {
    setExpandedSchemas((prev) => ({
      ...prev,
      [schemaName]: !prev[schemaName],
    }));
  }

  function getDatabaseName(): string {
    return connection.label;
  }

  function handleOpenSchemaViewer(schemaName: string) {
    const connectionLabel = getDatabaseName();
    openTab(
      {
        type: "schema",
        path: {
          connectionId: connection.id,
          connectionLabel,
          schemaName,
        },
      },
      connection.color,
    ).catch(() => undefined);
  }

  function handleOpenTableViewer(schemaName: string, tableName: string) {
    const connectionLabel = getDatabaseName();
    openTab(
      {
        type: "table-details",
        path: {
          connectionId: connection.id,
          connectionLabel,
          schemaName,
          tableName,
        },
      },
      connection.color,
    ).catch(() => undefined);
  }

  function handleOpenTableInNewTab(schemaName: string, tableName: string) {
    const connectionLabel = getDatabaseName();
    forceOpenTab(
      {
        type: "table-details",
        path: {
          connectionId: connection.id,
          connectionLabel,
          schemaName,
          tableName,
        },
      },
      connection.color,
    ).catch(() => undefined);
  }

  function handleOpenViewViewer(schemaName: string, viewName: string) {
    const connectionLabel = getDatabaseName();
    openTab(
      {
        type: "view-details",
        path: {
          connectionId: connection.id,
          connectionLabel,
          schemaName,
          viewName,
        },
      },
      connection.color,
    ).catch(() => undefined);
  }

  function renderSchemaTree() {
    if (schemasLoading) {
      return (
        <>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-28" />
        </>
      );
    }

    if (schemas.length === 0) {
      return (
        <span className="text-xs text-muted-foreground">
          No user schemas with tables or views found.
        </span>
      );
    }

    return schemas.map((schema) => (
      <SchemaTreeNode
        key={schema.name}
        schema={schema}
        schemaExpanded={searchActive || (expandedSchemas[schema.name] ?? false)}
        onToggleSchema={toggleSchema}
        onOpenSchema={handleOpenSchemaViewer}
        onOpenTable={handleOpenTableViewer}
        onOpenTableInNewTab={handleOpenTableInNewTab}
        onOpenView={handleOpenViewViewer}
        selection={treeSelection}
        accentColor={connection.color}
      />
    ));
  }

  async function handleConfirmDelete() {
    setDeleting(true);
    const ok = await remove(connection.id);
    if (ok) {
      onConnectedChange(false);
      closeConnectionTabs(connection.id);
      toast.success(`Deleted "${connection.label}"`);
      setDeleteOpen(false);
    } else {
      toast.error(`Failed to delete "${connection.label}"`);
    }
    setDeleting(false);
  }

  async function handleCopyConnectionString() {
    // `connection` comes from the (secret-redacted) connection list — fetch
    // the real credentials fresh rather than building from a stripped copy.
    const fresh = await globalThis.window.connectionApi.getById(
      connection.id,
    );
    if (!fresh.success) {
      toast.error(`Failed to load "${connection.label}"`, {
        description: fresh.error,
      });
      return;
    }
    const connectionString = buildConnectionString(fresh.data);
    if (!connectionString) {
      toast.error(`No connection string available for "${connection.label}"`);
      return;
    }

    try {
      const result =
        await globalThis.window.clipboardApi.writeText(connectionString);
      if (!result.success) {
        throw new Error(result.error ?? "Clipboard write failed.");
      }
      toast.success("Connection string copied");
    } catch {
      toast.error("Failed to copy connection string");
    }
  }

  async function handleDatabaseClick() {
    const isConnected = connected || (await handleConnect());
    if (!isConnected) {
      return;
    }

    if (schemas.length === 0) {
      setSchemasLoading(true);
      await refreshSchemaTree(connection.id);
      setSchemasLoading(false);
    }

    if (!expanded) {
      setExpanded(true);
    }

    openTab(
      {
        type: "schema-list",
        path: {
          connectionId: connection.id,
          connectionLabel: connection.label,
        },
      },
      connection.color,
    ).catch(() => undefined);
  }

  async function handleOpenUsers() {
    const isConnected = connected || (await handleConnect());
    if (!isConnected) {
      return;
    }

    openTab(
      {
        type: "users",
        path: {
          connectionId: connection.id,
          connectionLabel: connection.label,
        },
      },
      connection.color,
    ).catch(() => undefined);
  }

  async function handleRefresh() {
    const isConnected = connected || (await handleConnect());
    if (!isConnected) {
      return;
    }

    setSchemasLoading(true);
    const result = await refreshSchemaTreeWithStatus(connection.id, true);
    setSchemasLoading(false);
    if (!result.ok) return;
    setExpanded(true);
    setExpandedSchemas({});
    toast.success(`Refreshed "${connection.label}"`, {
      description: "Schema tree and relation counts updated.",
    });
  }

  function handleDisconnect() {
    onConnectedChange(false);
    setExpanded(false);
    setExpandedSchemas({});
    toast.info(`Disconnected from "${connection.label}"`);
  }

  return (
    <div className="group/connection flex flex-col">
      {/* Connection row */}
      <section
        className={cn(
          "relative flex items-center gap-2 rounded-md pl-2 pr-1 py-1 transition-colors",
          isConnectionLeaf ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
        )}
      >
        {/* Color / selection indicator */}
        {isConnectionActive && (
          <div
            className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-primary"
            style={
              connection.color
                ? { backgroundColor: connection.color }
                : undefined
            }
          />
        )}

        {/* Expand arrow (only when connected) */}
        <button
          type="button"
          className={cn(
            "flex size-4 shrink-0 items-center justify-center",
            connected
              ? "cursor-pointer text-muted-foreground hover:text-foreground"
              : "invisible",
          )}
          onClick={(event) => {
            event.stopPropagation();
            handleExpand().catch(() => undefined);
          }}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <ChevronRight
            className={cn(
              "size-3 transition-transform duration-200",
              expanded && "rotate-90",
            )}
          />
        </button>

        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2 text-left"
          onClick={() => {
            handleDatabaseClick().catch(() => undefined);
          }}
          aria-label={`Open ${connection.label}`}
        >
          <Database
            className={cn(
              "size-4 shrink-0",
              isConnectionActive
                ? "text-sidebar-foreground"
                : "text-muted-foreground",
            )}
          />
          <span
            className={cn(
              "flex-1 truncate text-sm",
              isConnectionActive && "font-medium",
            )}
            style={connection.color ? { color: connection.color } : undefined}
          >
            {connection.label}
          </span>
        </button>

        <div className="relative flex h-7 w-16 shrink-0 items-center justify-end gap-0.5">
          {connection.favourite && (
            <Star className="text-primary fill-primary size-3 shrink-0 opacity-100 transition-opacity group-hover/connection:opacity-0 group-focus-within/connection:opacity-0" />
          )}

          <div className="flex items-center justify-end gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover/connection:opacity-100 group-hover/connection:pointer-events-auto group-focus-within/connection:opacity-100 group-focus-within/connection:pointer-events-auto">
            {!connected && !connecting && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleConnect().catch(() => undefined);
                    }}
                    aria-label="Connect"
                  >
                    <Plug className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Connect</TooltipContent>
              </Tooltip>
            )}
            {connecting && (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="More actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="text-xs leading-none">⋯</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => onEdit(connection)}>
                  <Edit className="mr-2 size-3" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    handleCopyConnectionString().catch(() => undefined);
                  }}
                >
                  <Copy className="mr-2 size-3" />
                  Copy Connection String
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => toggleFavourite(connection.id)}
                >
                  <Star className="mr-2 size-3" />
                  {connection.favourite ? "Unfavourite" : "Favourite"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    handleRefresh().catch(() => undefined);
                  }}
                  disabled={connecting || schemasLoading}
                >
                  <RefreshCw
                    className={`mr-2 size-3 ${schemasLoading ? "animate-spin" : ""}`}
                  />
                  {schemasLoading ? "Refreshing" : "Refresh"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    handleOpenUsers().catch(() => undefined);
                  }}
                >
                  <Users className="mr-2 size-3" />
                  Users
                </DropdownMenuItem>
                {connected && (
                  <DropdownMenuItem onClick={handleDisconnect}>
                    <PlugZap className="mr-2 size-3" />
                    Disconnect
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 size-3" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </section>

      {/* Expandable schema/table tree */}
      {((connected && expanded) || searchActive) && (
        <div className="ml-[18px] flex min-w-0 flex-col gap-px border-l border-sidebar-border py-1 pl-2 pr-1">
          {renderSchemaTree()}
        </div>
      )}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => !deleting && setDeleteOpen(open)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete saved connection?</DialogTitle>
            <DialogDescription>
              Remove &quot;{connection.label}&quot; from PG Compass? This only
              deletes the local saved configuration. It does not delete or
              modify the PostgreSQL database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void handleConfirmDelete()}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete saved connection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
