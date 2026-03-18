import { useState } from 'react';
import {
  ChevronRight,
  Database,
  Edit,
  Folder,
  Loader2,
  Plug,
  PlugZap,
  RefreshCw,
  Star,
  Table2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useConnections } from '@/hooks/use-connections';
import { useWorkspace } from '@/hooks/use-workspace';
import type { ConnectionConfig, DatabaseSchema } from '@/shared/types/connection';

interface ConnectionItemProps {
  connection: ConnectionConfig;
  onEdit: (connection: ConnectionConfig) => void;
}

interface SchemaTreeNodeProps {
  schema: DatabaseSchema;
  schemaExpanded: boolean;
  onToggleSchema: (schemaName: string) => void;
  onOpenSchema: (schemaName: string) => void;
  onOpenTable: (schemaName: string, tableName: string) => void;
}

function SchemaTreeNode({
  schema,
  schemaExpanded,
  onToggleSchema,
  onOpenSchema,
  onOpenTable,
}: Readonly<SchemaTreeNodeProps>) {
  const schemaCountText = String(schema.tables.length);

  return (
    <div className="min-w-0 flex flex-col gap-0.5">
      <button
        type="button"
        className="grid w-full min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_minmax(4ch,auto)] items-center gap-1 rounded-sm px-1 py-0.5 text-left text-xs hover:bg-sidebar-accent"
        onClick={() => {
          onOpenSchema(schema.name);
          onToggleSchema(schema.name);
        }}
        aria-label={schemaExpanded ? `Collapse schema ${schema.name}` : `Expand schema ${schema.name}`}
      >
        <ChevronRight
          className={cn(
            'size-3 text-muted-foreground transition-transform duration-200',
            schemaExpanded && 'rotate-90',
          )}
        />
        <Folder className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate" title={schema.name}>
          {schema.name}
        </span>
        <span
          className="min-w-[4ch] shrink-0 pl-1 pr-1.5 text-right text-[10px] tabular-nums text-muted-foreground"
          title={`${schemaCountText} tables`}
        >
          {schemaCountText}
        </span>
      </button>

      {schemaExpanded && (
        <div className="ml-3 flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
          {schema.tables.map((tableName) => (
            <button
              key={`${schema.name}.${tableName}`}
              type="button"
              className="flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              onClick={() => onOpenTable(schema.name, tableName)}
              aria-label={`Table ${tableName}`}
            >
              <Table2 className="size-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate" title={tableName}>{tableName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConnectionItem({ connection, onEdit }: Readonly<ConnectionItemProps>) {
  const { remove, toggleFavourite, testConnection } = useConnections();
  const {
    schemaCache,
    refreshSchemaTree,
    openTab,
  } = useWorkspace();
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [schemasLoading, setSchemasLoading] = useState(false);
  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({});
  const schemas: DatabaseSchema[] = schemaCache[connection.id] ?? [];

  async function handleConnect(): Promise<boolean> {
    setConnecting(true);
    // Verify we can reach the server before marking this item as connected.
    const result = await testConnection(connection.id);
    setConnecting(false);

    if (result.ok) {
      setConnected(true);
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
        type: 'schema',
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
        type: 'table-details',
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
          No user schemas with tables found.
        </span>
      );
    }

    return schemas.map((schema) => (
      <SchemaTreeNode
        key={schema.name}
        schema={schema}
        schemaExpanded={expandedSchemas[schema.name] ?? false}
        onToggleSchema={toggleSchema}
        onOpenSchema={handleOpenSchemaViewer}
        onOpenTable={handleOpenTableViewer}
      />
    ));
  }

  async function handleDelete() {
    const ok = await remove(connection.id);
    if (ok) {
      toast.success(`Deleted "${connection.label}"`);
    }
  }

  async function handleDatabaseClick() {
    const isConnected = connected || await handleConnect();
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
        type: 'schema-list',
        path: {
          connectionId: connection.id,
          connectionLabel: connection.label,
        },
      },
      connection.color,
    ).catch(() => undefined);
  }

  async function handleRefresh() {
    const isConnected = connected || await handleConnect();
    if (!isConnected) {
      return;
    }

    setSchemasLoading(true);
    await refreshSchemaTree(connection.id, true);
    setSchemasLoading(false);
    setExpanded(true);
    setExpandedSchemas({});
  }

  function handleDisconnect() {
    setConnected(false);
    setExpanded(false);
    setExpandedSchemas({});
    toast.info(`Disconnected from "${connection.label}"`);
  }

  return (
    <div className="group/connection flex flex-col">
      {/* Connection row */}
      <section
        className="relative flex items-center gap-2 rounded-md pl-2 pr-1 py-1.5 hover:bg-sidebar-accent"
      >
        {/* Color indicator */}
        {connection.color && (
          <div
            className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full"
            style={{ backgroundColor: connection.color }}
          />
        )}

        {/* Expand arrow (only when connected) */}
        <button
          type="button"
          className={cn(
            'flex size-4 shrink-0 items-center justify-center',
            connected
              ? 'cursor-pointer text-muted-foreground hover:text-foreground'
              : 'invisible',
          )}
          onClick={(event) => {
            event.stopPropagation();
            handleExpand().catch(() => undefined);
          }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <ChevronRight
            className={cn(
              'size-3 transition-transform duration-200',
              expanded && 'rotate-90',
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
          <Database className="size-4 shrink-0 text-muted-foreground" />
          <span
            className="flex-1 truncate text-sm"
            style={connection.color ? { color: connection.color } : undefined}
          >
            {connection.label}
          </span>
        </button>

        <div className="relative flex h-6 w-14 shrink-0 items-center justify-end gap-0.5">
          {connection.favourite && (
            <Star className="size-3 shrink-0 fill-yellow-500 text-yellow-500 opacity-100 transition-opacity group-hover/connection:opacity-0" />
          )}

          <div className="flex items-center justify-end gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover/connection:opacity-100 group-hover/connection:pointer-events-auto">
            {!connected && !connecting && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
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
                  className="size-6"
                  aria-label="More actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="text-xs leading-none">⋯</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => onEdit(connection)}>
                  <Edit className="mr-2 size-3" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toggleFavourite(connection.id)}>
                  <Star className="mr-2 size-3" />
                  {connection.favourite ? 'Unfavourite' : 'Favourite'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    handleRefresh().catch(() => undefined);
                  }}
                  disabled={connecting || schemasLoading}
                >
                  <RefreshCw className="mr-2 size-3" />
                  Refresh
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
                  onClick={handleDelete}
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
      {connected && expanded && (
        <div className="ml-6 flex min-w-0 flex-col gap-1 py-1 pl-4 pr-2.5">
          {renderSchemaTree()}
        </div>
      )}
    </div>
  );
}
