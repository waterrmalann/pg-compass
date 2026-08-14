import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
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

type ExportFormat = "csv" | "json";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  /** For "Export all": schema + table. */
  schema?: string;
  table?: string;
  /** For "Export selected query": the SQL query text. */
  sql?: string;
}

export function ExportDialog({
  open,
  onOpenChange,
  connectionId,
  schema,
  table,
  sql,
}: Readonly<ExportDialogProps>) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);

  const isQueryExport = !!sql;

  async function handleExport() {
    setExporting(true);
    try {
      // 1. Pick save location first (no toast yet)
      const filterName = format === "csv" ? "CSV Files" : "JSON Files";
      const defaultName = isQueryExport
        ? `query-export.${format}`
        : `${table}.${format}`;
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
          ...(isQueryExport ? { sql } : { schema, table }),
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
          <DialogTitle>Export Data</DialogTitle>
          <DialogDescription>
            {isQueryExport
              ? "Export the results of your query."
              : `Export all rows from ${schema}.${table}.`}
          </DialogDescription>
        </DialogHeader>

        {/* Format selector */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Format
          </span>
          <div className="flex items-center gap-0.5 self-start rounded-md border border-border p-0.5">
            <Button
              type="button"
              variant={format === "csv" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-4 text-xs"
              onClick={() => setFormat("csv")}
            >
              CSV
            </Button>
            <Button
              type="button"
              variant={format === "json" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-4 text-xs"
              onClick={() => setFormat("json")}
            >
              JSON
            </Button>
          </div>
        </div>

        {/* Show the query for query-based exports */}
        {isQueryExport && sql && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Query
            </span>
            <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
              {sql}
            </pre>
          </div>
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
          <Button
            size="sm"
            className="gap-1.5"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
