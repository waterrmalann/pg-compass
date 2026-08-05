import { ChevronRight, Eye, ExternalLink, Folder, FolderOpen, Table2 } from "lucide-react";
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
  /** Connection accent colour, used for the selected-leaf indicator bar. */
  accentColor?: string;
}

/** Left indicator bar rendered on the currently selected leaf row. */
function SelectedBar({ color }: Readonly<{ color?: string }>) {
  return (
    <span
      aria-hidden
      className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-primary"
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

export function SchemaTreeNode({
  schema,
  schemaExpanded,
  onToggleSchema,
  onOpenSchema,
  onOpenTable,
  onOpenTableInNewTab,
  onOpenView,
  selection,
  accentColor,
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
          "relative grid h-7 w-full min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md pl-2 pr-1 text-left text-[13px] transition-colors",
          isSchemaLeaf
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : isSchemaAncestor
              ? "text-sidebar-foreground hover:bg-sidebar-accent/60"
              : "text-sidebar-foreground/90 hover:bg-sidebar-accent/60",
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
        {isSchemaLeaf ? <SelectedBar color={accentColor} /> : null}
        <ChevronRight
          className={cn(
            "size-3.5 text-muted-foreground transition-transform duration-200",
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
          className="shrink-0 pl-1 pr-1 text-right text-[11px] tabular-nums text-muted-foreground"
          title={`${schemaCountText} relations`}
        >
          {schemaCountText}
        </span>
      </button>

      {schemaExpanded ? (
        <div className="ml-[13px] flex flex-col gap-px border-l border-sidebar-border pl-2">
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
                      "relative flex h-7 min-w-0 items-center gap-2 rounded-md pl-2 pr-1 text-left text-[13px] transition-colors",
                      isSelected
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                    onClick={() => onOpenTable(schema.name, tableName)}
                    aria-label={`Table ${tableName}`}
                    aria-current={isSelected ? "true" : undefined}
                  >
                    {isSelected ? <SelectedBar color={accentColor} /> : null}
                    <Table2 className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate" title={tableName}>
                      {tableName}
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem
                    onClick={() => onOpenTableInNewTab(schema.name, tableName)}
                  >
                    <ExternalLink className="size-3.5" />
                    Open in New Tab
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
                  "relative flex h-7 min-w-0 items-center gap-2 rounded-md pl-2 pr-1 text-left text-[13px] transition-colors",
                  isSelected
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
                onClick={() => onOpenView(schema.name, view.name)}
                aria-label={`View ${view.name}`}
                aria-current={isSelected ? "true" : undefined}
              >
                {isSelected ? <SelectedBar color={accentColor} /> : null}
                <Eye className="size-3.5 shrink-0" />
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
