import { memo, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowUpRight,
  Diamond,
  Fingerprint,
  KeyRound,
  Link2,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  DiagramColumn,
  DiagramForeignKey,
} from "@/shared/types/schema-diagram";
import {
  HEADER_HEIGHT,
  ROW_HEIGHT,
  type DiagramNode,
  type Point,
} from "./diagram-model";
import { shortTypeName } from "./short-type-name";

/** How a card relates to the current selection. */
export type TableNodeEmphasis = "none" | "selected" | "related" | "dimmed";

interface TableNodeProps {
  node: DiagramNode;
  position: Point;
  /** Prefix the name with its schema (when several schemas are shown). */
  showSchema: boolean;
  /** False when zoomed out: only the header is drawn. */
  detailed: boolean;
  emphasis: TableNodeEmphasis;
  foreignKeysByColumn: Map<string, DiagramForeignKey> | undefined;
  onPointerDown: (key: string, event: ReactPointerEvent) => void;
  onOpen: (node: DiagramNode) => void;
}

function describeReference(foreignKey: DiagramForeignKey): string {
  const target = `${foreignKey.targetSchema}.${foreignKey.targetTable}`;
  return `References ${target} (${foreignKey.targetColumns.join(", ")})`;
}

function ColumnIcon({
  column,
  foreignKey,
}: Readonly<{
  column: DiagramColumn;
  foreignKey: DiagramForeignKey | undefined;
}>) {
  if (column.isPrimaryKey) {
    return <KeyRound aria-label="Primary key" className="text-foreground" />;
  }
  if (foreignKey) {
    return <Link2 aria-label="Foreign key" />;
  }
  if (column.isUnique) {
    return <Fingerprint aria-label="Unique" />;
  }
  return null;
}

function ColumnRow({
  column,
  foreignKey,
}: Readonly<{
  column: DiagramColumn;
  foreignKey: DiagramForeignKey | undefined;
}>) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 font-mono"
      style={{ height: ROW_HEIGHT }}
      title={foreignKey ? describeReference(foreignKey) : undefined}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center text-subtle-foreground [&_svg]:size-3">
        <ColumnIcon column={column} foreignKey={foreignKey} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/85">
        {column.name}
      </span>
      <span
        className="max-w-[45%] shrink-0 truncate text-[11px] text-subtle-foreground"
        title={column.dataType}
      >
        {shortTypeName(column.dataType)}
      </span>
      <span className="flex size-3 shrink-0 items-center justify-center text-subtle-foreground [&_svg]:size-2.5">
        {column.isNullable ? <Diamond aria-label="Nullable" /> : null}
      </span>
    </div>
  );
}

/**
 * One table on the diagram. Its size comes from the layout metrics, so
 * relationship lines can be anchored to a column row without measuring.
 */
export const TableNode = memo(function TableNode({
  node,
  position,
  showSchema,
  detailed,
  emphasis,
  foreignKeysByColumn,
  onPointerDown,
  onOpen,
}: Readonly<TableNodeProps>) {
  const { table } = node;
  const qualifiedName = `${table.schema}.${table.name}`;
  const isSelected = emphasis === "selected";

  return (
    <div
      role="group"
      aria-label={`Table ${qualifiedName}`}
      data-diagram-table={qualifiedName}
      data-selected={isSelected || undefined}
      className={cn(
        "group/table absolute top-0 left-0 cursor-grab overflow-hidden rounded-lg border border-border bg-card shadow-xs/5 transition-[opacity,border-color] duration-150 select-none",
        // Zoomed out, a filled block reads better than hairlines and text.
        !detailed && "border-muted-foreground/40 bg-muted-foreground/20",
        isSelected && "border-ring ring-1 ring-ring",
        emphasis === "dimmed" && "opacity-40",
      )}
      style={{
        width: node.width,
        height: node.height,
        transform: `translate(${position.x}px, ${position.y}px)`,
      }}
      onPointerDown={(event) => onPointerDown(node.key, event)}
      onDoubleClick={() => onOpen(node)}
    >
      <div
        className="flex items-center gap-2 border-b border-border/70 pr-1 pl-3"
        style={{ height: HEADER_HEIGHT }}
      >
        <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-medium text-foreground">
          {showSchema ? (
            <span className="text-muted-foreground">{table.schema}.</span>
          ) : null}
          {table.name}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Open table ${qualifiedName}`}
          title="Open table"
          className={cn(
            "opacity-0 group-hover/table:opacity-100 focus-visible:opacity-100",
            isSelected && "opacity-100",
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onOpen(node)}
        >
          <ArrowUpRight />
        </Button>
      </div>
      {detailed ? (
        table.columns.length === 0 ? (
          <div
            className="flex items-center px-3 text-[11px] text-subtle-foreground"
            style={{ height: ROW_HEIGHT }}
          >
            No columns
          </div>
        ) : (
          table.columns.map((column) => (
            <ColumnRow
              key={column.name}
              column={column}
              foreignKey={foreignKeysByColumn?.get(column.name)}
            />
          ))
        )
      ) : null}
    </div>
  );
});
