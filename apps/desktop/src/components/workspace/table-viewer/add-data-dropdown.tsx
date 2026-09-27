/**
 * "Add data" toolbar affordance for the Data tab. Offers two ways to insert
 * rows into a table:
 *
 *  - **Import JSON or CSV file** — a native open dialog, then a streamed,
 *    single-transaction bulk insert in the main process with a progress toast
 *    (mirrors the export flow).
 *  - **Insert row** — the same `RowEditDialog` used for row edits, in insert
 *    mode, sending a single `INSERT … RETURNING *`.
 *
 * Both entries are gated the same way the write affordances elsewhere are:
 * absent under read-only mode and for non-table relations.
 */

import { useRef, useState } from "react";
import { Plus, FileUp, FilePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RowEditDialog } from "@/components/workspace/table-viewer/row-edit-dialog";
import type { ColumnInfo } from "@/shared/types/table-data";

interface AddDataDropdownProps {
  connectionId: string;
  schema: string;
  table: string;
  columns: ColumnInfo[];
  primaryKey: string[] | null;
  /** Disable while the grid is loading or errored. */
  disabled?: boolean;
  /** Called after a successful import or insert so the grid can refresh. */
  onDataChanged: () => void;
}

export function AddDataDropdown({
  connectionId,
  schema,
  table,
  columns,
  primaryKey,
  disabled,
  onDataChanged,
}: Readonly<AddDataDropdownProps>) {
  const [insertOpen, setInsertOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);

  async function handleImport() {
    if (importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    try {
      const dialogResult = await globalThis.window.tableDataApi.showOpenDialog({
        purpose: "import",
        title: "Import JSON or CSV file",
        filters: [
          { name: "JSON or CSV", extensions: ["json", "csv"] },
          { name: "JSON Files", extensions: ["json"] },
          { name: "CSV Files", extensions: ["csv"] },
        ],
      });

      if (!dialogResult.success) {
        toast.error("Import failed", { description: dialogResult.error });
        return;
      }
      if (!dialogResult.data) return; // user cancelled

      const filePath = dialogResult.data;
      const lower = filePath.toLowerCase();
      const format: "csv" | "json" | null = lower.endsWith(".json")
        ? "json"
        : lower.endsWith(".csv")
          ? "csv"
          : null;
      if (format === null) {
        toast.error("Import failed", {
          description: "Choose a file with a .json or .csv extension.",
        });
        return;
      }
      const toastId = toast.loading("Importing… 0 rows");
      const operationId = globalThis.crypto.randomUUID();
      const cleanup = globalThis.window.tableDataApi.onImportProgress(
        (progress) => {
          if (progress.operationId !== operationId) return;
          toast.loading(
            `Importing… ${progress.insertedCount.toLocaleString()} rows`,
            {
              id: toastId,
            },
          );
        },
      );

      try {
        const result = await globalThis.window.tableDataApi.importData({
          connectionId,
          schema,
          table,
          filePath,
          format,
          operationId,
        });

        if (!result.success || !result.data) {
          toast.error("Import failed", {
            description: result.error ?? "Unknown error",
            id: toastId,
          });
          return;
        }

        const count = result.data.insertedCount;
        toast.success(
          `Imported ${count.toLocaleString()} row${count === 1 ? "" : "s"}`,
          { description: `${schema}.${table}`, id: toastId },
        );
        onDataChanged();
      } finally {
        cleanup();
      }
    } catch (err) {
      toast.error("Import failed", { description: (err as Error).message });
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled || importing}
          >
            <Plus />
            Add data
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem onSelect={() => void handleImport()}>
            <FileUp />
            Import JSON or CSV file
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={columns.length === 0}
            onSelect={() => setInsertOpen(true)}
          >
            <FilePlus />
            Insert row
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {insertOpen ? (
        <RowEditDialog
          mode="insert"
          columns={columns}
          primaryKey={primaryKey ?? []}
          schema={schema}
          table={table}
          connectionId={connectionId}
          onRowUpdated={() => {
            onDataChanged();
          }}
          onClose={() => setInsertOpen(false)}
        />
      ) : null}
    </>
  );
}
