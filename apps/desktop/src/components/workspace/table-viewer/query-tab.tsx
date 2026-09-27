import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  LayoutList,
  Play,
  Rows3,
  Square,
  Table2,
} from "lucide-react";
import { toast } from "sonner";
import { Kbd } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  SqlEditor,
  type CompletionSchema,
} from "@/components/sql-editor/sql-editor";
import { DataPagination } from "@/components/workspace/table-viewer/data-pagination";
import { TableDataView } from "@/components/workspace/table-viewer/table-data-view";
import { CardDataView } from "@/components/workspace/table-viewer/card-data-view";
import type { EditContext } from "@/components/workspace/table-viewer/data-tab";
import { ExportDropdown } from "@/components/workspace/export-dropdown";
import { useWorkspace } from "@/hooks/use-workspace";
import { useLatestRequest } from "@/hooks/use-latest-request";
import type { ColumnInfo } from "@/shared/types/table-data";
import { getShortcut, shortcutLabel } from "@/shared/constants/shortcuts";

type ViewMode = "table" | "card";

// Ad-hoc queries cannot be tied back to a single source relation, so cells
// in the query tab are never editable. Phase 2 may lift this for simple
// single-table selects.
const NON_EDITABLE_CONTEXT: EditContext = {
  connectionId: "",
  schema: "",
  table: "",
  readOnly: true,
  primaryKey: null,
  onRowUpdated: () => undefined,
};

function QueryResultView({
  viewMode,
  columns,
  rows,
}: Readonly<{
  viewMode: ViewMode;
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
}>) {
  if (viewMode === "table") {
    return (
      <TableDataView
        columns={columns}
        rows={rows}
        editContext={NON_EDITABLE_CONTEXT}
      />
    );
  }
  return (
    <CardDataView
      columns={columns}
      rows={rows}
      editContext={NON_EDITABLE_CONTEXT}
    />
  );
}

interface QueryTabProps {
  connectionId: string;
  schema: string;
  table: string;
  refreshSignal?: number;
  onRefreshComplete?: (success: boolean) => void;
}

export function QueryTab({
  connectionId,
  schema,
  table,
  refreshSignal = 0,
  onRefreshComplete,
}: Readonly<QueryTabProps>) {
  const { schemaCache } = useWorkspace();
  const runLatestRequest = useLatestRequest();
  const [sql, setSql] = useState(
    `SELECT * FROM "${schema}"."${table}" LIMIT 100;`,
  );
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessfulSql, setLastSuccessfulSql] = useState<string | null>(
    null,
  );
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const activeQueryIdRef = useRef<string | null>(null);
  const seenRefreshSignal = useRef(refreshSignal);

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

    // Add columns from query results if available
    if (columns.length > 0) {
      const key = `${schema}.${table}`;
      cols[key] = columns.map((c) => ({ name: c.name, type: c.dataType }));
    }

    return {
      schemas,
      tables,
      columns: cols,
      defaultSchema: schema,
    };
  }, [schemaCache, connectionId, schema, table, columns]);

  const executeQuery = useCallback(
    async (p: number, ps: number, submittedSql = sql) => {
      const queryId = globalThis.crypto.randomUUID();
      activeQueryIdRef.current = queryId;
      setLoading(true);
      setError(null);
      const request = await runLatestRequest(() =>
        globalThis.window.tableDataApi.executeQuery({
          connectionId,
          queryId,
          sql: submittedSql,
          page: p,
          pageSize: ps,
        }),
      );
      if (request.status === "stale") return false;
      if (request.status === "error") {
        const msg = (request.error as Error).message;
        setError(msg);
        toast.error("Query failed", { description: msg });
        if (activeQueryIdRef.current === queryId) {
          activeQueryIdRef.current = null;
          setLoading(false);
        }
        return false;
      }
      const result = request.value;
      if (!result.success || !result.data) {
        const message = result.error ?? "Unknown error";
        setError(message);
        if (message === "Query cancelled.") {
          toast.info("Query cancelled", {
            description: "The last successful result is still available.",
          });
        } else {
          toast.error("Query failed", { description: message });
        }
        if (activeQueryIdRef.current === queryId) {
          activeQueryIdRef.current = null;
          setLoading(false);
        }
        return false;
      }
      setColumns(result.data.columns);
      setRows(result.data.rows);
      setTotalCount(result.data.totalCount);
      setHasRun(true);
      setLastSuccessfulSql(submittedSql);
      setLastRefreshedAt(new Date());
      if (activeQueryIdRef.current === queryId) {
        activeQueryIdRef.current = null;
        setLoading(false);
      }
      return true;
    },
    [connectionId, runLatestRequest, sql],
  );

  useEffect(() => {
    if (seenRefreshSignal.current === refreshSignal) return;
    seenRefreshSignal.current = refreshSignal;
    if (loading) {
      toast.info("A query is already running", {
        description: "Cancel it before refreshing the last result.",
      });
      onRefreshComplete?.(false);
      return;
    }
    if (!lastSuccessfulSql) {
      onRefreshComplete?.(true);
      return;
    }
    void executeQuery(page, pageSize, lastSuccessfulSql).then((success) =>
      onRefreshComplete?.(success),
    );
  }, [
    executeQuery,
    lastSuccessfulSql,
    loading,
    onRefreshComplete,
    page,
    pageSize,
    refreshSignal,
  ]);

  function handleRun() {
    if (loading) return;
    setPage(1);
    executeQuery(1, pageSize);
  }

  function handlePageChange(p: number) {
    if (loading) return;
    setPage(p);
    executeQuery(p, pageSize);
  }

  function handlePageSizeChange(ps: number) {
    if (loading) return;
    setPageSize(ps);
    setPage(1);
    executeQuery(1, ps);
  }

  async function handleCancel() {
    const queryId = activeQueryIdRef.current;
    if (!queryId) return;
    const result = await globalThis.window.tableDataApi.cancelQuery({
      connectionId,
      queryId,
    });
    if (!result.success || !result.data) {
      toast.error("Failed to cancel query", { description: result.error });
      return;
    }
    if (result.data.status === "already-finished") {
      toast.info("Query already finished");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Editor */}
      <Panel className="shrink-0" data-query-editor>
        <SqlEditor
          value={sql}
          onChange={setSql}
          onSubmit={handleRun}
          placeholder="Write a SELECT query…"
          schema={completionSchema}
          minHeight="120px"
        />
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Only SELECT statements are allowed.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Kbd>{shortcutLabel(getShortcut("run-query"))}</Kbd>
            {loading ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCancel()}
              >
                <Square />
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={handleRun}
                disabled={!sql.trim()}
              >
                <Play />
                Run query
              </Button>
            )}
          </div>
        </div>
      </Panel>

      {/* Error display */}
      {error && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
        >
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 font-mono break-words">{error}</span>
        </div>
      )}

      {/* Results */}
      <Panel className="flex-1">
        {hasRun ? (
          <>
            <PanelHeader className="px-3">
              <Rows3 />
              <PanelTitle>Results</PanelTitle>
              <span className="truncate text-xs text-muted-foreground">
                {totalCount.toLocaleString()} row{totalCount === 1 ? "" : "s"}{" "}
                returned
                {lastRefreshedAt
                  ? ` · updated ${lastRefreshedAt.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : ""}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <ExportDropdown
                  connectionId={connectionId}
                  schema={schema}
                  table={table}
                  sql={lastSuccessfulSql ?? sql}
                  hasQueryResults={hasRun && rows.length > 0}
                />
                <SegmentedControl
                  ariaLabel="Result view mode"
                  value={viewMode}
                  onValueChange={setViewMode}
                  options={[
                    {
                      value: "table",
                      icon: <Table2 />,
                      ariaLabel: "Table view",
                    },
                    {
                      value: "card",
                      icon: <LayoutList />,
                      ariaLabel: "Card view",
                    },
                  ]}
                />
              </div>
            </PanelHeader>

            <div className="min-h-0 flex-1">
              <QueryResultView
                viewMode={viewMode}
                columns={columns}
                rows={rows}
              />
            </div>

            <DataPagination
              page={page}
              pageSize={pageSize}
              totalCount={totalCount}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              disabled={loading}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center px-4 text-xs text-muted-foreground">
            {loading
              ? "Running query…"
              : "Write a query and press Run query to see results."}
          </div>
        )}
      </Panel>
    </div>
  );
}
