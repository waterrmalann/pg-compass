import { useState } from "react";
import { Download, FileDown, FileSpreadsheet, Database } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExportDialog } from "@/components/workspace/export-dialog";

interface ExportDropdownProps {
  connectionId: string;
  schema: string;
  table: string;
  /** Current SQL from the query tab (if applicable). */
  sql?: string;
  /** Active WHERE clause filter from the data tab. */
  whereClause?: string;
  /** Whether query-based export is available (query tab has results). */
  hasQueryResults?: boolean;
  /** Keep the compact 32px toolbar height. */
  thin?: boolean;
}

export function ExportDropdown({
  connectionId,
  schema,
  table,
  sql,
  whereClause,
  hasQueryResults,
}: Readonly<ExportDropdownProps>) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"all" | "query">("all");
  const [sqlDumping, setSqlDumping] = useState(false);
  // Every export path shares one `onExportProgress` IPC channel with no job
  // id, so two exports in flight at once make each other's progress toasts
  // flicker with the wrong row count. Block starting a second one while
  // either the dialog-based export or a SQL dump is already running.
  const exportBusy = dialogOpen || sqlDumping;

  // Build the effective SQL for a query/filter export
  const effectiveSql =
    sql ??
    (whereClause
      ? `SELECT * FROM "${schema}"."${table}" WHERE ${whereClause}`
      : undefined);
  const canExportQuery = hasQueryResults ?? !!whereClause;

  function handleExportAll() {
    if (exportBusy) return;
    setExportMode("all");
    setDialogOpen(true);
  }

  function handleExportQuery() {
    if (exportBusy) return;
    setExportMode("query");
    setDialogOpen(true);
  }

  async function handleSqlDump() {
    if (exportBusy) return;
    setSqlDumping(true);
    try {
      // 1. Pick save location first
      const dialogResult = await globalThis.window.tableDataApi.showSaveDialog({
        purpose: "sql-dump",
        title: "SQL Dump",
        defaultPath: `${table}.sql`,
        filters: [{ name: "SQL Files", extensions: ["sql"] }],
      });

      if (!dialogResult.success) {
        toast.error("SQL dump failed", { description: dialogResult.error });
        return;
      }
      if (!dialogResult.data) return; // user cancelled

      const filePath = dialogResult.data;

      // 2. File chosen — now show progress toast and start dump
      const toastId = toast.loading("SQL dump… 0 rows");
      const cleanup = globalThis.window.tableDataApi.onExportProgress(
        (rowCount) => {
          toast.loading(`SQL dump… ${rowCount.toLocaleString()} rows`, {
            id: toastId,
          });
        },
      );

      try {
        const result = await globalThis.window.tableDataApi.sqlDump({
          connectionId,
          schema,
          table,
          filePath,
        });

        if (!result.success || !result.data) {
          toast.error("SQL dump failed", {
            description: result.error ?? "Unknown error",
            id: toastId,
          });
          return;
        }

        toast.success(
          `Dumped ${result.data.rowCount.toLocaleString()} row${result.data.rowCount === 1 ? "" : "s"}`,
          { description: result.data.filePath, id: toastId },
        );
      } finally {
        cleanup();
      }
    } catch (err) {
      toast.error("SQL dump failed", { description: (err as Error).message });
    } finally {
      setSqlDumping(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
          >
            <Download className="size-3.5" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onClick={handleExportAll}
            disabled={exportBusy}
            className="gap-2"
          >
            <FileSpreadsheet className="size-4" />
            Export all
          </DropdownMenuItem>
          {canExportQuery && effectiveSql && (
            <DropdownMenuItem
              onClick={handleExportQuery}
              disabled={exportBusy}
              className="gap-2"
            >
              <FileDown className="size-4" />
              Export selected query
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleSqlDump}
            disabled={exportBusy}
            className="gap-2"
          >
            <Database className="size-4" />
            SQL Dump
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ExportDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connectionId={connectionId}
        schema={exportMode === "all" ? schema : undefined}
        table={exportMode === "all" ? table : undefined}
        sql={exportMode === "query" ? effectiveSql : undefined}
      />
    </>
  );
}
