import { useEffect, useMemo, useState } from "react";
import {
  Braces,
  CircleAlert,
  Loader2,
  Table2,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ColumnInfo } from "@/shared/types/table-data";

type PreviewMode = "table" | "json";

interface DeleteDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  schema: string;
  table: string;
  whereClause: string;
  totalCount: number;
  initialPreviewMode: PreviewMode;
  onDeleted: () => void;
}

export function DeleteDataDialog({
  open,
  onOpenChange,
  connectionId,
  schema,
  table,
  whereClause,
  totalCount,
  initialPreviewMode,
  onDeleted,
}: Readonly<DeleteDataDialogProps>) {
  const [previewMode, setPreviewMode] =
    useState<PreviewMode>(initialPreviewMode);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setPreviewMode(initialPreviewMode);
    setColumns([]);
    setRows([]);
    setPreviewError(null);
    setPreviewLoading(true);

    globalThis.window.tableDataApi
      .getRows({
        connectionId,
        schema,
        table,
        page: 1,
        pageSize: 5,
        whereClause: whereClause || undefined,
      })
      .then((result) => {
        if (cancelled) return;
        if (!result.success || !result.data) {
          setPreviewError(result.error ?? "Unknown error");
          return;
        }
        setColumns(result.data.columns);
        setRows(result.data.rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreviewError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connectionId, schema, table, whereClause, open, initialPreviewMode]);

  const filterText = whereClause.trim() || "No filter (all documents)";
  const documentLabel = totalCount === 1 ? "document" : "documents";
  const canDelete =
    rows.length > 0 && !previewLoading && !previewError && !deleting;

  const previewJson = useMemo(() => safeJsonStringify(rows), [rows]);

  async function handleDelete() {
    if (!canDelete) return;

    setDeleting(true);
    try {
      const response = await globalThis.window.tableDataApi.deleteRows({
        connectionId,
        schema,
        table,
        whereClause: whereClause || undefined,
      });

      if (!response.success || !response.data) {
        toast.error("Delete failed", {
          description: response.error ?? "Unknown error",
        });
        return;
      }

      const deletedCount = response.data.deletedCount;
      toast.success(
        `Deleted ${deletedCount.toLocaleString()} ${
          deletedCount === 1 ? "document" : "documents"
        }`,
      );
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      toast.error("Delete failed", { description: (err as Error).message });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="delete-data-dialog"
        className="grid max-h-[calc(100vh-2rem)] w-[min(calc(100vw-2rem),64rem)] max-w-[calc(100vw-2rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-none"
      >
        <DialogHeader>
          <DialogTitle>
            Delete {totalCount.toLocaleString()} {documentLabel}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {schema}.{table}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-1">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Current filter
            </span>
            <Input
              value={filterText}
              readOnly
              className="min-w-0 font-mono text-xs"
              aria-label="Current delete filter"
            />
          </div>

          <div
            role="note"
            className="flex min-w-0 gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs leading-5 text-warning-foreground"
          >
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <p className="min-w-0">
              Unintended documents may be deleted if new documents are added or
              existing documents are changed while this dialog is open. Review
              the current filter before confirming.
            </p>
          </div>

          <div className="flex min-w-0 items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Preview sample
            </span>
            <SegmentedControl
              ariaLabel="Preview mode"
              value={previewMode}
              onValueChange={setPreviewMode}
              options={[
                {
                  value: "table",
                  icon: <Table2 />,
                  ariaLabel: "Table preview",
                },
                { value: "json", icon: <Braces />, ariaLabel: "JSON preview" },
              ]}
            />
          </div>

          <DeletePreview
            columns={columns}
            rows={rows}
            mode={previewMode}
            loading={previewLoading}
            error={previewError}
            previewJson={previewJson}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={deleting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!canDelete}
            onClick={() => {
              void handleDelete();
            }}
          >
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeletePreview({
  columns,
  rows,
  mode,
  loading,
  error,
  previewJson,
}: Readonly<{
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  mode: PreviewMode;
  loading: boolean;
  error: string | null;
  previewJson: string;
}>) {
  if (loading) {
    return (
      <div className="h-52 rounded-lg border border-border">
        <LoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-52 rounded-lg border border-border">
        <EmptyState
          icon={<CircleAlert className="text-destructive-foreground" />}
          title="Preview failed."
          description={
            <span className="font-mono text-destructive-foreground">
              {error}
            </span>
          }
        />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="h-52 rounded-lg border border-border">
        <EmptyState title="No documents match the current filter." />
      </div>
    );
  }

  if (mode === "json") {
    return (
      <ScrollArea
        className="h-52 min-w-0 rounded-lg border border-border bg-code"
        data-testid="delete-preview-json-scroll"
      >
        <pre className="max-w-full overflow-x-auto p-3 font-mono text-xs">
          {previewJson}
        </pre>
      </ScrollArea>
    );
  }

  return (
    <div
      className="h-52 min-w-0 max-w-full overflow-auto rounded-lg border border-border"
      data-testid="delete-preview-table-scroll"
    >
      <Table className="w-max min-w-full table-fixed">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.name}
                className="h-12 w-36 max-w-36 px-3 whitespace-nowrap"
              >
                <div className="flex flex-col">
                  <span className="truncate font-mono text-[12.5px] text-foreground">
                    {column.name}
                  </span>
                  <span className="font-mono text-[11px] font-normal text-subtle-foreground">
                    {column.dataType}
                  </span>
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={`delete-preview-${String(rowIndex)}`}>
              {columns.map((column) => (
                <TableCell
                  key={column.name}
                  className="w-36 max-w-36 truncate px-3 font-mono text-xs whitespace-nowrap"
                >
                  {formatCellValue(row[column.name])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return safeJsonStringify(value);
  return String(value);
}

function safeJsonStringify(value: unknown): string {
  try {
    return (
      JSON.stringify(
        value,
        (_key, nestedValue: unknown) => {
          if (typeof nestedValue === "bigint") return nestedValue.toString();
          return nestedValue;
        },
        2,
      ) ?? String(value)
    );
  } catch {
    return String(value);
  }
}
