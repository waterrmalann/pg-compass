import { Rows3 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EditableCell } from "@/components/workspace/table-viewer/editable-cell";
import { RowEditButton } from "@/components/workspace/table-viewer/row-edit-button";
import type { ColumnInfo } from "@/shared/types/table-data";
import type { EditContext } from "@/components/workspace/table-viewer/data-tab";
import {
  DataCopyButton,
  serializeCellValue,
  serializeRow,
} from "@/components/workspace/table-viewer/data-copy";

interface TableDataViewProps {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  editContext: EditContext;
}

function pkValuesFor(
  row: Record<string, unknown>,
  primaryKey: string[] | null,
): unknown[] {
  if (!primaryKey) return [];
  return primaryKey.map((col) => row[col]);
}

export function TableDataView({
  columns,
  rows,
  editContext,
}: Readonly<TableDataViewProps>) {
  if (rows.length === 0) {
    return <EmptyState icon={<Rows3 />} title="No rows to display." />;
  }

  // Row-edit affordance gating: when off, the gutter column is not rendered
  // at all — no header, no per-row cell. This is the same DOM contract as
  // EditableCell's read-only gate.
  const showRowEdit =
    !editContext.readOnly &&
    editContext.primaryKey !== null &&
    editContext.primaryKey.length > 0;

  return (
    <div className="h-full overflow-auto" data-testid="table-data-scroll">
      <Table scrollable={false}>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="sticky left-0 z-20 w-8 bg-card px-0" />
            {columns.map((col) => (
              <TableHead key={col.name} className="h-12 whitespace-nowrap">
                <div className="group/header flex items-center gap-1">
                  <div className="flex flex-col">
                    <span className="font-mono text-[12.5px] text-foreground">
                      {col.name}
                    </span>
                    <span className="font-mono text-[11px] font-normal text-subtle-foreground">
                      {col.dataType}
                    </span>
                  </div>
                  <DataCopyButton
                    label={`Copy column name ${col.name}`}
                    text={col.name}
                    successMessage="Column name copied"
                    className="opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100"
                  />
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => {
            const rowKey = `row-${String(rowIndex)}`;
            const pkValues = pkValuesFor(row, editContext.primaryKey);
            return (
              <TableRow key={rowKey} className="group">
                {/* Sticky, so it needs an opaque card fill. --muted is
                    translucent, so the row's hover tint is layered on top
                    as a flat gradient instead of replacing the fill. The
                    fill is clipped to the padding box so the row's border
                    still shows. */}
                <TableCell className="sticky left-0 z-1 w-8 bg-card bg-clip-padding p-0 align-middle group-hover:bg-linear-to-r group-hover:from-muted/40 group-hover:to-muted/40">
                  <div className="flex h-full items-center justify-center gap-0.5 px-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                    <DataCopyButton
                      label={`Copy row ${String(rowIndex + 1)}`}
                      text={serializeRow(columns, row)}
                      successMessage="Row copied as JSON"
                    />
                    {showRowEdit ? (
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
                    ) : null}
                  </div>
                </TableCell>
                {columns.map((col) => (
                  <TableCell
                    key={col.name}
                    className="max-w-75 truncate pr-2 font-mono text-[12.5px]"
                  >
                    <div className="group/cell flex min-w-0 items-center gap-1">
                      <div className="min-w-0 flex-1 truncate">
                        <EditableCell
                          col={col}
                          value={row[col.name]}
                          readOnly={editContext.readOnly}
                          primaryKey={editContext.primaryKey}
                          pkValues={pkValues}
                          schema={editContext.schema}
                          table={editContext.table}
                          connectionId={editContext.connectionId}
                          variant="cell"
                          onRowUpdated={(updated) =>
                            editContext.onRowUpdated(rowIndex, updated)
                          }
                        />
                      </div>
                      <DataCopyButton
                        label={`Copy ${col.name} value`}
                        text={serializeCellValue(row[col.name])}
                        successMessage="Cell value copied"
                        className="shrink-0 opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100"
                      />
                    </div>
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
