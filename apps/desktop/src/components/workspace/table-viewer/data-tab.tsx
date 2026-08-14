import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  LayoutList,
  Table2,
  Search,
  CircleAlert,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  SqlEditor,
  type CompletionSchema,
} from "@/components/sql-editor/sql-editor";
import { DataPagination } from "@/components/workspace/table-viewer/data-pagination";
import { TableDataView } from "@/components/workspace/table-viewer/table-data-view";
import { CardDataView } from "@/components/workspace/table-viewer/card-data-view";
import { DeleteDataDialog } from "@/components/workspace/table-viewer/delete-data-dialog";
import { AddDataDropdown } from "@/components/workspace/table-viewer/add-data-dropdown";
import { ExportDropdown } from "@/components/workspace/export-dropdown";
import { useWorkspace } from "@/hooks/use-workspace";
import { useSettings } from "@/hooks/use-settings";
import { useLatestRequest } from "@/hooks/use-latest-request";
import type { ColumnInfo } from "@/shared/types/table-data";
import type { RelationSessionState } from "@/shared/types/workspace";

type ViewMode = "table" | "card";

export interface EditContext {
  connectionId: string;
  schema: string;
  table: string;
  readOnly: boolean;
  primaryKey: string[] | null;
  onRowUpdated: (rowIndex: number, row: Record<string, unknown>) => void;
}

function DataViewContent({
  viewMode,
  columns,
  rows,
  editContext,
}: Readonly<{
  viewMode: ViewMode;
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  editContext: EditContext;
}>) {
  if (viewMode === "table") {
    return (
      <TableDataView columns={columns} rows={rows} editContext={editContext} />
    );
  }
  return (
    <CardDataView columns={columns} rows={rows} editContext={editContext} />
  );
}

function DataContent({
  viewMode,
  columns,
  rows,
  error,
  editContext,
}: Readonly<{
  viewMode: ViewMode;
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  error: string | null;
  editContext: EditContext;
}>) {
  if (error && rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <CircleAlert className="size-5 text-destructive" />
        <p className="text-sm text-muted-foreground">No rows to display.</p>
        <p className="max-w-lg text-xs text-destructive">{error}</p>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          Refresh failed: {error}. Showing the last successful result.
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <DataViewContent
          viewMode={viewMode}
          columns={columns}
          rows={rows}
          editContext={editContext}
        />
      </div>
    </div>
  );
}

interface DataTabProps {
  connectionId: string;
  schema: string;
  table: string;
  relationType: "table" | "view";
  session?: RelationSessionState;
  onSessionChange?: (patch: Partial<RelationSessionState>) => void;
  refreshSignal?: number;
  onRefreshComplete?: (success: boolean) => void;
}

export function DataTab({
  connectionId,
  schema,
  table,
  relationType,
  session,
  onSessionChange,
  refreshSignal = 0,
  onRefreshComplete,
}: Readonly<DataTabProps>) {
  const { schemaCache } = useWorkspace();
  const { settings } = useSettings();
  const runLatestRequest = useLatestRequest();
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [primaryKey, setPrimaryKey] = useState<string[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(session?.dataPageSize ?? 50);
  const [whereClause, setWhereClauseState] = useState(
    session?.dataWhereClause ?? "",
  );
  const [pendingWhere, setPendingWhere] = useState(
    session?.dataWhereClause ?? "",
  );
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewModeState] = useState<ViewMode>(
    session?.dataViewMode ?? "table",
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const seenRefreshSignal = useRef(refreshSignal);
  const isTable = relationType === "table";

  const completionSchema = useMemo<CompletionSchema>(() => {
    const schemas: string[] = [];
    const tables: Record<string, string[]> = {};
    const cols: Record<string, { name: string; type?: string }[]> = {};

    for (const [connId, dbSchemas] of Object.entries(schemaCache)) {
      if (connId !== connectionId) continue;
      for (const s of dbSchemas) {
        schemas.push(s.name);
        tables[s.name] = [...s.tables, ...s.views.map((view) => view.name)];
      }
    }

    if (columns.length > 0) {
      const key = `${schema}.${table}`;
      cols[key] = columns.map((c) => ({ name: c.name, type: c.dataType }));
    }

    return {
      schemas,
      tables,
      columns: cols,
      defaultTable: table,
      defaultSchema: schema,
    };
  }, [schemaCache, connectionId, schema, table, columns]);

  const fetchRows = useCallback(
    async (p: number, ps: number, where: string, background = false) => {
      if (!background) setLoading(true);
      setError(null);
      const request = await runLatestRequest(() =>
        globalThis.window.tableDataApi.getRows({
          connectionId,
          schema,
          table,
          page: p,
          pageSize: ps,
          whereClause: where || undefined,
        }),
      );
      // A stale result means a newer call (background or foreground)
      // already superseded this one — that newer call is responsible for
      // the final loading state when IT resolves, so this one touches
      // nothing further (in particular, it must NOT clear `loading`, since
      // the newer call may still be pending).
      if (request.status === "stale") return false;
      if (request.status === "error") {
        const msg = (request.error as Error).message;
        setError(msg);
        if (!background) {
          setRows([]);
          setTotalCount(0);
        }
        setLoading(false);
        toast.error("Failed to load rows", { description: msg });
        return false;
      }
      const result = request.value;
      if (!result.success || !result.data) {
        const msg = result.error ?? "Unknown error";
        setError(msg);
        if (!background) {
          setRows([]);
          setTotalCount(0);
        }
        setLoading(false);
        toast.error("Failed to load rows", { description: msg });
        return false;
      }
      setColumns(result.data.columns);
      setRows(result.data.rows);
      setPrimaryKey(result.data.primaryKey);
      setTotalCount(result.data.totalCount);
      setLastRefreshedAt(new Date());
      // Unconditional (not just `if (!background)`): being the "current"
      // (non-stale) result means no newer request is pending, regardless of
      // whether THIS call itself was the one that had set loading=true — a
      // background call can be the one that resolves last after an earlier
      // foreground call went stale, and must still clear the spinner it
      // never set. Calling this when it's already false is a harmless no-op.
      setLoading(false);
      return true;
    },
    [connectionId, runLatestRequest, schema, table],
  );

  useEffect(() => {
    if (seenRefreshSignal.current === refreshSignal) return;
    seenRefreshSignal.current = refreshSignal;
    void fetchRows(page, pageSize, whereClause, true).then((success) =>
      onRefreshComplete?.(success),
    );
  }, [
    fetchRows,
    onRefreshComplete,
    page,
    pageSize,
    refreshSignal,
    whereClause,
  ]);

  function setPageSize(next: number) {
    setPageSizeState(next);
    setPage(1);
    onSessionChange?.({ dataPageSize: next });
  }

  function setWhereClause(next: string) {
    setWhereClauseState(next);
    onSessionChange?.({ dataWhereClause: next });
  }

  function setViewMode(next: ViewMode) {
    setViewModeState(next);
    onSessionChange?.({ dataViewMode: next });
  }

  useEffect(
    function fetchTableData() {
      fetchRows(page, pageSize, whereClause);
    },
    [fetchRows, page, pageSize, whereClause],
  );

  function handleWhereSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setWhereClause(pendingWhere);
  }

  function handleClearFilter() {
    setPendingWhere("");
    setWhereClause("");
    setPage(1);
  }

  const handleRowUpdated = useCallback(
    (rowIndex: number, row: Record<string, unknown>) => {
      setRows((prev) => {
        if (rowIndex < 0 || rowIndex >= prev.length) return prev;
        const next = prev.slice();
        next[rowIndex] = row;
        return next;
      });
    },
    [],
  );

  const editContext = useMemo<EditContext>(
    () => ({
      connectionId,
      schema,
      table,
      readOnly: settings.general.readOnlyMode || !isTable,
      primaryKey,
      onRowUpdated: handleRowUpdated,
    }),
    [
      connectionId,
      schema,
      table,
      settings.general.readOnlyMode,
      isTable,
      primaryKey,
      handleRowUpdated,
    ],
  );

  const handleRowsDeleted = useCallback(() => {
    setPage(1);
    void fetchRows(1, pageSize, whereClause);
  }, [fetchRows, pageSize, whereClause]);

  const handleDataChanged = useCallback(() => {
    void fetchRows(page, pageSize, whereClause, true);
  }, [fetchRows, page, pageSize, whereClause]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex flex-col border-b border-border px-3 py-2 gap-1.5">
        {/* Row 1: Search + view toggle */}
        <div className="flex items-center gap-2">
          <form
            onSubmit={handleWhereSubmit}
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
              <SqlEditor
                value={pendingWhere}
                onChange={setPendingWhere}
                onSubmit={() => {
                  setPage(1);
                  setWhereClause(pendingWhere);
                }}
                placeholder="WHERE clause — e.g. id > 10 AND status = 'active'"
                schema={completionSchema}
                singleLine
                minHeight="32px"
                className="h-8 pl-5"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
            >
              Filter
            </Button>
            {whereClause && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={handleClearFilter}
              >
                Clear
              </Button>
            )}
          </form>

          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            <Button
              type="button"
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="icon-sm"
              className="size-8"
              onClick={() => setViewMode("table")}
              aria-label="Table view"
            >
              <Table2 className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant={viewMode === "card" ? "secondary" : "ghost"}
              size="icon-sm"
              className="size-8"
              onClick={() => setViewMode("card")}
              aria-label="Card view"
            >
              <LayoutList className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Row 2: Action buttons */}
        <div className="flex items-center gap-1.5">
          <span
            className="mr-auto text-[11px] text-muted-foreground"
            title={lastRefreshedAt?.toLocaleString()}
          >
            {lastRefreshedAt
              ? `Updated ${lastRefreshedAt.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </span>
          {isTable && !settings.general.readOnlyMode && (
            <AddDataDropdown
              connectionId={connectionId}
              schema={schema}
              table={table}
              columns={columns}
              primaryKey={primaryKey}
              disabled={loading}
              onDataChanged={handleDataChanged}
            />
          )}
          {isTable && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled
              >
                <Pencil className="size-3.5" />
                Update
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={loading || settings.general.readOnlyMode || !!error}
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </>
          )}

          <ExportDropdown
            connectionId={connectionId}
            schema={schema}
            table={table}
            whereClause={whereClause || undefined}
            thin
          />
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <DataContent
            viewMode={viewMode}
            columns={columns}
            rows={rows}
            error={error}
            editContext={editContext}
          />
        )}
      </div>

      {/* Pagination */}
      <DataPagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        disabled={loading}
      />

      {isTable && (
        <DeleteDataDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          connectionId={connectionId}
          schema={schema}
          table={table}
          whereClause={whereClause}
          totalCount={totalCount}
          initialPreviewMode={viewMode === "table" ? "table" : "json"}
          onDeleted={handleRowsDeleted}
        />
      )}
    </div>
  );
}
