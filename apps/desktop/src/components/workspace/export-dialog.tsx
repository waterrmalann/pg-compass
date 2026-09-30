import { useState } from "react";
import type { DataQueryInput } from "@/shared/query-dsl/types";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ExportFormat = "csv" | "json";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  /** For "Export all": schema + table. */
  schema?: string;
  table?: string;
  /** Query-tab "Export selected query": the SQL query text. */
  sql?: string;
  /** Data-tab "Export selected query": the active DSL for schema + table. */
  dataQuery?: DataQueryInput;
}

function describeExport({
  sql,
  dataQuery,
  schema,
  table,
}: Readonly<{
  sql?: string;
  dataQuery?: DataQueryInput;
  schema?: string;
  table?: string;
}>): string {
  if (sql) return "Export the results of your query.";
  if (dataQuery) {
    return `Export every row of ${schema}.${table} that matches the active query.`;
  }
  return `Export all rows from ${schema}.${table}.`;
}

export function ExportDialog({
  open,
  onOpenChange,
  connectionId,
  schema,
  table,
  sql,
  dataQuery,
}: Readonly<ExportDialogProps>) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);

  const isQueryExport = !!sql || !!dataQuery;

  async function handleExport() {
    setExporting(true);
    try {
      // 1. Pick save location first (no toast yet)
      const filterName = format === "csv" ? "CSV Files" : "JSON Files";
      const defaultName = sql ? `query-export.${format}` : `${table}.${format}`;
      const dialogResult = await globalThis.window.tableDataApi.showSaveDialog({
        purpose: "export",
        title: "Export Data",
        defaultPath: defaultName,
        filters: [{ name: filterName, extensions: [format] }],
      });

      if (!dialogResult.success) {
        toast.error("Export failed", { description: dialogResult.error });
        return;
      }
      if (!dialogResult.data) return; // user cancelled

      const filePath = dialogResult.data;

      // 2. File chosen — now show progress toast and start export
      const toastId = toast.loading("Exporting… 0 rows");
      const cleanup = globalThis.window.tableDataApi.onExportProgress(
        (rowCount) => {
          toast.loading(`Exporting… ${rowCount.toLocaleString()} rows`, {
            id: toastId,
          });
        },
      );

      try {
        const result = await globalThis.window.tableDataApi.exportData({
          connectionId,
          format,
          filePath,
          ...(sql ? { sql } : { schema, table }),
          ...(dataQuery && !sql ? { query: dataQuery } : {}),
        });

        if (!result.success || !result.data) {
          toast.error("Export failed", {
            description: result.error ?? "Unknown error",
            id: toastId,
          });
          return;
        }

        toast.success(
          `Exported ${result.data.rowCount.toLocaleString()} row${result.data.rowCount === 1 ? "" : "s"}`,
          { description: result.data.filePath, id: toastId },
        );
        onOpenChange(false);
      } finally {
        cleanup();
      }
    } catch (err) {
      toast.error("Export failed", { description: (err as Error).message });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (exporting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export data</DialogTitle>
          <DialogDescription>
            {describeExport({ sql, dataQuery, schema, table })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium">Format</span>
          <SegmentedControl
            ariaLabel="Export format"
            value={format}
            onValueChange={setFormat}
            options={[
              { value: "csv", label: "CSV" },
              { value: "json", label: "JSON" },
            ]}
          />
        </div>

        {/* Show the query for query-based exports */}
        {isQueryExport && sql && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Query</span>
            <pre className="max-h-32 overflow-auto rounded-lg border border-border bg-code p-3 font-mono text-xs leading-5">
              {sql}
            </pre>
          </div>
        )}

        {dataQuery && !sql && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-border bg-code p-3 text-xs">
            {(
              [
                ["Filter", dataQuery.filter],
                ["Project", dataQuery.projection],
                ["Sort", dataQuery.sort],
              ] as const
            ).map(([label, text]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd
                  className="truncate font-mono"
                  title={text.trim() || undefined}
                >
                  {text.trim() || "—"}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={exporting}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
