import {
  ChevronRight,
  Eye,
  ExternalLink,
  Folder,
  FolderOpen,
  Table2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActiveSelection } from "@/components/sidebar/active-selection";
import type { DatabaseSchema } from "@/shared/types/connection";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface SchemaTreeNodeProps {
  schema: DatabaseSchema;
  schemaExpanded: boolean;
  onToggleSchema: (schemaName: string) => void;
  onOpenSchema: (schemaName: string) => void;
  onOpenTable: (schemaName: string, tableName: string) => void;
  onOpenTableInNewTab: (schemaName: string, tableName: string) => void;
  onOpenView: (schemaName: string, viewName: string) => void;
  /** Selection projected onto this connection's tree, or null when inactive. */
  selection?: ActiveSelection | null;
}

const leafRowClassName =
  "relative flex h-7 min-w-0 items-center gap-2 rounded-md pr-1 pl-2 text-left font-mono text-xs transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";

export function SchemaTreeNode({
  schema,
  schemaExpanded,
  onToggleSchema,
  onOpenSchema,
  onOpenTable,
  onOpenTableInNewTab,
  onOpenView,
  selection,
}: Readonly<SchemaTreeNodeProps>) {
  const schemaCountText = String(schema.tables.length + schema.views.length);

  const onPath = selection?.schemaName === schema.name;
  const isSchemaLeaf = onPath && selection?.kind === "schema";
  const isSchemaAncestor =
    onPath && (selection?.kind === "table" || selection?.kind === "view");

  return (
    <div className="min-w-0 flex flex-col gap-px">
      <button
        type="button"
        className={cn(
          "relative grid h-7 w-full min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md pr-1 pl-1.5 text-left text-[12.5px] transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          isSchemaLeaf
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : isSchemaAncestor
              ? "text-sidebar-accent-foreground hover:bg-sidebar-accent"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
        onClick={() => {
          onOpenSchema(schema.name);
          onToggleSchema(schema.name);
        }}
        aria-label={
          schemaExpanded
            ? `Collapse schema ${schema.name}`
            : `Expand schema ${schema.name}`
        }
        aria-current={isSchemaLeaf ? "true" : undefined}
      >
        <ChevronRight
          className={cn(
            "size-3 text-muted-foreground transition-transform duration-150",
            schemaExpanded && "rotate-90",
          )}
        />
        {schemaExpanded ? (
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 truncate" title={schema.name}>
          {schema.name}
        </span>
        <span
          className="shrink-0 px-1 text-right font-mono text-[11px] tabular-nums text-subtle-foreground"
          title={`${schemaCountText} relations`}
        >
          {schemaCountText}
        </span>
      </button>

      {schemaExpanded ? (
        <div className="ml-3 flex flex-col gap-px border-l border-sidebar-border pl-1.5">
          {schema.tables.map((tableName) => {
            const isSelected =
              selection?.kind === "table" &&
              selection.schemaName === schema.name &&
              selection.tableName === tableName;
            return (
              <ContextMenu key={`${schema.name}.${tableName}`}>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      leafRowClassName,
                      isSelected
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                    onClick={() => onOpenTable(schema.name, tableName)}
                    aria-label={`Table ${tableName}`}
                    aria-current={isSelected ? "true" : undefined}
                  >
                    <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate" title={tableName}>
                      {tableName}
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem
                    onClick={() => onOpenTableInNewTab(schema.name, tableName)}
                  >
                    <ExternalLink />
                    Open in new tab
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {schema.views.map((view) => {
            const isSelected =
              selection?.kind === "view" &&
              selection.schemaName === schema.name &&
              selection.viewName === view.name;
            return (
              <button
                key={`${schema.name}.${view.name}`}
                type="button"
                className={cn(
                  leafRowClassName,
                  isSelected
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
                onClick={() => onOpenView(schema.name, view.name)}
                aria-label={`View ${view.name}`}
                aria-current={isSelected ? "true" : undefined}
              >
                <Eye className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" title={view.name}>
                  {view.name}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
