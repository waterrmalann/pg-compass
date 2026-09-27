import { LayoutList } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { typeRegistry } from "@/components/workspace/renderers/type-registry";
import { JsonTree } from "@/components/workspace/table-viewer/json-tree";
import { EditableCell } from "@/components/workspace/table-viewer/editable-cell";
import { RowEditButton } from "@/components/workspace/table-viewer/row-edit-button";
import { useDensity } from "@/hooks/use-density";
import { cn } from "@/lib/utils";
import type { ColumnInfo } from "@/shared/types/table-data";
import type { EditContext } from "@/components/workspace/table-viewer/data-tab";
import {
  DataCopyButton,
  serializeCellValue,
  serializeRow,
} from "@/components/workspace/table-viewer/data-copy";

interface CardDataViewProps {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  editContext: EditContext;
}

function isStructuredValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return typeof value === "object";
}

function renderCardDisplay(col: ColumnInfo, value: unknown) {
  const isNull = value === null || value === undefined;
  if (isNull) {
    return typeRegistry.get("__null__").renderCard(value);
  }
  const isJson = col.dataType === "json" || col.dataType === "jsonb";
  const isStructured = isJson || isStructuredValue(value);
  if (isStructured) {
    return <JsonTree value={value} />;
  }
  return typeRegistry.get(col.dataType).renderCard(value);
}

function pkValuesFor(
  row: Record<string, unknown>,
  primaryKey: string[] | null,
): unknown[] {
  if (!primaryKey) return [];
  return primaryKey.map((col) => row[col]);
}

export function CardDataView({
  columns,
  rows,
  editContext,
}: Readonly<CardDataViewProps>) {
  const compact = useDensity() === "compact";

  if (rows.length === 0) {
    return <EmptyState icon={<LayoutList />} title="No rows to display." />;
  }

  return (
    <ScrollArea className="h-full">
      <div className={cn("flex flex-col p-3", compact ? "gap-2" : "gap-3")}>
        {rows.map((row, rowIndex) => {
          const rowKey = `card-${String(rowIndex)}`;
          const pkValues = pkValuesFor(row, editContext.primaryKey);
          return (
            <div
              key={rowKey}
              className="group rounded-lg border border-border bg-background shadow-xs/5 transition-colors duration-150"
            >
              <div
                className={cn(
                  "flex items-center justify-between border-b border-border/70 pr-1.5 pl-3",
                  compact ? "h-8" : "h-9",
                )}
              >
                <span className="font-mono text-[11px] text-subtle-foreground">
                  Document {rowIndex + 1}
                </span>
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                  <DataCopyButton
                    label={`Copy document ${String(rowIndex + 1)}`}
                    text={serializeRow(columns, row)}
                    successMessage="Row copied as JSON"
                  />
                  <RowEditButton
                    columns={columns}
                    row={row}
                    readOnly={editContext.readOnly}
                    primaryKey={editContext.primaryKey}
                    schema={editContext.schema}
                    table={editContext.table}
                    connectionId={editContext.connectionId}
                    onRowUpdated={(updated) =>
                      editContext.onRowUpdated(rowIndex, updated)
                    }
                  />
                </div>
              </div>
              <div className={cn("px-3", compact ? "py-1" : "py-2")}>
                {columns.map((col) => (
                  <div
                    key={col.name}
                    className={cn(
                      "flex gap-2",
                      compact
                        ? "items-baseline py-0.5"
                        : "border-b border-border/70 py-1.5 last:border-b-0",
                    )}
                  >
                    <div
                      className={cn(
                        "group/label flex shrink-0 items-start gap-1",
                        compact ? "w-44" : "w-36",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span
                          className="truncate font-mono text-xs text-muted-foreground"
                          title={compact ? col.dataType : undefined}
                        >
                          {col.name}
                        </span>
                        {compact ? null : (
                          <span className="font-mono text-[11px] text-subtle-foreground">
                            {col.dataType}
                          </span>
                        )}
                      </div>
                      <DataCopyButton
                        label={`Copy column name ${col.name}`}
                        text={col.name}
                        successMessage="Column name copied"
                        className="shrink-0 opacity-0 group-hover/label:opacity-100 focus-visible:opacity-100"
                      />
                    </div>
                    <div className="group/value flex min-w-0 flex-1 items-start gap-1 font-mono text-[12.5px]">
                      <div className="min-w-0 flex-1">
                        <EditableCell
                          col={col}
                          value={row[col.name]}
                          readOnly={editContext.readOnly}
                          primaryKey={editContext.primaryKey}
                          pkValues={pkValues}
                          schema={editContext.schema}
                          table={editContext.table}
                          connectionId={editContext.connectionId}
                          variant="card"
                          displayOverride={renderCardDisplay(
                            col,
                            row[col.name],
                          )}
                          onRowUpdated={(updated) =>
                            editContext.onRowUpdated(rowIndex, updated)
                          }
                        />
                      </div>
                      <DataCopyButton
                        label={`Copy ${col.name} value`}
                        text={serializeCellValue(row[col.name])}
                        successMessage="Cell value copied"
                        className="shrink-0 opacity-0 group-hover/value:opacity-100 focus-visible:opacity-100"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
