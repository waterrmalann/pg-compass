import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  LayoutList,
  Lock,
  Table2,
  CircleAlert,
  Pencil,
  Rows3,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelCount,
  PanelHeader,
  PanelTitle,
} from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DataPagination } from "@/components/workspace/table-viewer/data-pagination";
import { TableDataView } from "@/components/workspace/table-viewer/table-data-view";
import { CardDataView } from "@/components/workspace/table-viewer/card-data-view";
import { DeleteDataDialog } from "@/components/workspace/table-viewer/delete-data-dialog";
import { AddDataDropdown } from "@/components/workspace/table-viewer/add-data-dropdown";
import { DataQueryToolbar } from "@/components/workspace/table-viewer/data-query-toolbar";
import { ExportDropdown } from "@/components/workspace/export-dropdown";
import { useSettings } from "@/hooks/use-settings";
import { useLatestRequest } from "@/hooks/use-latest-request";
import { prepareDataQuery } from "@/shared/query-dsl/bind";
import {
  dataQueryEquals,
  EMPTY_DATA_QUERY,
  isEmptyDataQuery,
  parseDataQuery,
} from "@/shared/query-dsl/parser";
import type {
  BoundPathSegment,
  DataQueryInput,
  QueryColumnMetadata,
  QueryDslError,
  QueryDslField,
} from "@/shared/query-dsl/types";
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

/**
 * Memoized so query-toolbar activity (errors appearing or clearing) never
 * re-renders a large grid whose inputs didn't change.
 */
const DataContent = memo(function DataContent({
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
      <EmptyState
        icon={<CircleAlert className="text-destructive-foreground" />}
        title="No rows to display."
        description={
          <span className="font-mono text-destructive-foreground">{error}</span>
        }
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive-foreground">
          <CircleAlert className="size-3.5 shrink-0" />
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
});

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

type LoadOutcome = "loaded" | "dsl-error" | "failed" | "stale";

/**
 * Instant feedback before a round trip: syntax always, and binding once the
 * relation's columns are loaded. The main process re-validates regardless.
 */
function validateDraft(
  query: DataQueryInput,
  columns: QueryColumnMetadata[],
): QueryDslError[] {
  const result =
    columns.length > 0
      ? prepareDataQuery(query, columns)
      : parseDataQuery(query);
  return result.ok ? [] : result.errors;
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
  const { settings } = useSettings();
  const runLatestRequest = useLatestRequest();
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [primaryKey, setPrimaryKey] = useState<string[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(session?.dataPageSize ?? 50);
  // `activeQuery` is the last successfully applied query. Drafts live in
  // the toolbar so typing never re-renders this component or its grid.
  // Rows, pagination, export and delete only ever use the active query.
  const [activeQuery, setActiveQuery] = useState<DataQueryInput>(
    session?.dataQuery ?? EMPTY_DATA_QUERY,
  );
  const [dslErrors, setDslErrors] = useState<QueryDslError[]>([]);
  // The query of an Apply still waiting for its rows, if any.
  const pendingApplyRef = useRef<DataQueryInput | null>(null);
  const [queryColumns, setQueryColumns] = useState<QueryColumnMetadata[]>([]);
  // Sampled JSON keys per column and path, reset with the column list.
  const jsonKeyCacheRef = useRef(new Map<string, Promise<string[]>>());
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewModeState] = useState<ViewMode>(
    session?.dataViewMode ?? "table",
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const seenRefreshSignal = useRef(refreshSignal);
  const isTable = relationType === "table";
  const hasProjection = activeQuery.projection.trim() !== "";

  const loadRows = useCallback(
    async (
      p: number,
      ps: number,
      query: DataQueryInput,
      background = false,
    ): Promise<LoadOutcome> => {
      if (!background) setLoading(true);
      const request = await runLatestRequest(() =>
        globalThis.window.tableDataApi.getRows({
          connectionId,
          schema,
          table,
          page: p,
          pageSize: ps,
          query,
        }),
      );
      // A stale result means a newer call (background or foreground)
      // already superseded this one — that newer call is responsible for
      // the final loading state when IT resolves, so this one touches
      // nothing further (in particular, it must NOT clear `loading`, since
      // the newer call may still be pending).
      if (request.status === "stale") return "stale";

      const failWith = (msg: string): LoadOutcome => {
        setError(msg);
        if (!background) {
          setRows([]);
          setTotalCount(0);
        }
        setLoading(false);
        toast.error("Failed to load rows", { description: msg });
        return "failed";
      };

      if (request.status === "error") {
        return failWith((request.error as Error).message);
      }
      const result = request.value;
      if (!result.success) {
        // Invalid DSL leaves the previous results, count and page intact;
        // the errors are shown inline next to the offending field.
        if (result.failure?.kind === "query-dsl") {
          setDslErrors(result.failure.errors);
          setLoading(false);
          return "dsl-error";
        }
        return failWith(result.error);
      }
      setError(null);
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
      return "loaded";
    },
    [connectionId, runLatestRequest, schema, table],
  );

  // The initial load reads the current view through a ref so it only
  // re-runs when the relation changes; page, page size and query changes
  // load explicitly from their handlers.
  const viewRef = useRef({ page, pageSize, activeQuery });
  viewRef.current = { page, pageSize, activeQuery };

  useEffect(
    function loadRelationRows() {
      const view = viewRef.current;
      void loadRows(view.page, view.pageSize, view.activeQuery);
    },
    [loadRows],
  );

  useEffect(
    function loadQueryColumns() {
      // The relation's full column list drives completion and linting; it is
      // kept apart from result columns, which a projection can shrink.
      let cancelled = false;
      jsonKeyCacheRef.current = new Map();
      globalThis.window.tableDataApi
        .getQueryColumns({ connectionId, schema, table })
        .then((result) => {
          if (!cancelled && result.success) setQueryColumns(result.data);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    },
    [connectionId, schema, table, refreshSignal],
  );

  const loadJsonKeys = useCallback(
    (column: string, path: BoundPathSegment[]): Promise<string[]> => {
      const cacheKey = JSON.stringify([column, path]);
      const cached = jsonKeyCacheRef.current.get(cacheKey);
      if (cached) return cached;
      const cache = jsonKeyCacheRef.current;
      // Failures aren't cached, so the next dot tries again.
      const forget = (): string[] => {
        cache.delete(cacheKey);
        return [];
      };
      const request = globalThis.window.tableDataApi
        .getJsonKeys({ connectionId, schema, table, column, path })
        .then((result) => (result.success ? result.data : forget()))
        .catch(forget);
      cache.set(cacheKey, request);
      return request;
    },
    [connectionId, schema, table],
  );

  useEffect(() => {
    if (seenRefreshSignal.current === refreshSignal) return;
    seenRefreshSignal.current = refreshSignal;
    void loadRows(page, pageSize, activeQuery, true).then((outcome) =>
      onRefreshComplete?.(outcome === "loaded"),
    );
  }, [activeQuery, loadRows, onRefreshComplete, page, pageSize, refreshSignal]);

  function handlePageChange(next: number) {
    setPage(next);
    void loadRows(next, pageSize, activeQuery);
  }

  function setPageSize(next: number) {
    setPageSizeState(next);
    setPage(1);
    onSessionChange?.({ dataPageSize: next });
    void loadRows(1, next, activeQuery);
  }

  function setViewMode(next: ViewMode) {
    setViewModeState(next);
    onSessionChange?.({ dataViewMode: next });
  }

  const handleFieldEdited = useCallback((field: QueryDslField) => {
    // Ranges in an edited field no longer point at the right text. Returning
    // the same array when nothing changes lets React skip the re-render.
    setDslErrors((previous) =>
      previous.some((dslError) => dslError.field === field)
        ? previous.filter((dslError) => dslError.field !== field)
        : previous,
    );
  }, []);

  /**
   * Validates and runs a query. Only a query that parses and binds in the
   * main process becomes active; a database error on a valid query (say an
   * invalid date) shows the normal result error state. All three fields
   * change together and paging resets.
   */
  async function applyQuery(next: DataQueryInput) {
    const localErrors = validateDraft(next, queryColumns);
    if (localErrors.length > 0) {
      setDslErrors(localErrors);
      return;
    }
    setDslErrors([]);
    if (dataQueryEquals(next, activeQuery)) {
      // A slower Apply of a different query may still be in flight (say the
      // user hit Clear while it loads). Reloading the active query makes
      // that response stale, so it can never install itself afterwards.
      if (pendingApplyRef.current) {
        pendingApplyRef.current = null;
        void loadRows(page, pageSize, activeQuery);
      }
      return;
    }

    pendingApplyRef.current = next;
    const outcome = await loadRows(1, pageSize, next);
    if (pendingApplyRef.current === next) pendingApplyRef.current = null;
    if (outcome === "stale" || outcome === "dsl-error") return;
    setActiveQuery(next);
    setPage(1);
    onSessionChange?.({ dataQuery: next });
  }

  function handleApply(next: DataQueryInput) {
    void applyQuery(next);
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
    void loadRows(1, pageSize, activeQuery);
  }, [loadRows, pageSize, activeQuery]);

  const handleDataChanged = useCallback(() => {
    void loadRows(page, pageSize, activeQuery, true);
  }, [loadRows, page, pageSize, activeQuery]);

  const updatedLabel = lastRefreshedAt
    ? `Updated ${lastRefreshedAt.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "";
  const canEditRows = isTable && !settings.general.readOnlyMode;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <DataQueryToolbar
        activeQuery={activeQuery}
        errors={dslErrors}
        columns={queryColumns}
        loadJsonKeys={loadJsonKeys}
        onApply={handleApply}
        onFieldEdited={handleFieldEdited}
        trailing={
          <SegmentedControl
            ariaLabel="Data view mode"
            value={viewMode}
            onValueChange={setViewMode}
            options={[
              { value: "table", icon: <Table2 />, ariaLabel: "Table view" },
              { value: "card", icon: <LayoutList />, ariaLabel: "Card view" },
            ]}
          />
        }
      />

      <Panel className="flex-1">
        <PanelHeader className="px-3">
          <Rows3 />
          <PanelTitle>Rows</PanelTitle>
          {!loading && <PanelCount>{totalCount.toLocaleString()}</PanelCount>}
          <span
            className="ml-1 truncate text-xs text-muted-foreground"
            title={lastRefreshedAt?.toLocaleString()}
          >
            {updatedLabel}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {canEditRows && hasProjection && (
              // aria-disabled rather than disabled so it can still show its
              // tooltip on hover and focus.
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-disabled="true"
                      aria-description="Clear projection to edit rows."
                      className="cursor-not-allowed"
                    >
                      <Lock />
                      Read-only
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Clear projection to edit rows.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {canEditRows && !hasProjection && (
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
                <Button type="button" variant="ghost" size="xs" disabled>
                  <Pencil />
                  Update
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={loading || settings.general.readOnlyMode || !!error}
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 />
                  Delete
                </Button>
              </>
            )}

            <ExportDropdown
              connectionId={connectionId}
              schema={schema}
              table={table}
              dataQuery={
                isEmptyDataQuery(activeQuery) ? undefined : activeQuery
              }
            />
          </div>
        </PanelHeader>

        {/* Content */}
        <div className="min-h-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
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

        <DataPagination
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={handlePageChange}
          onPageSizeChange={setPageSize}
          disabled={loading}
        />
      </Panel>

      {isTable && (
        <DeleteDataDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          connectionId={connectionId}
          schema={schema}
          table={table}
          query={activeQuery}
          initialPreviewMode={viewMode === "table" ? "table" : "json"}
          onDeleted={handleRowsDeleted}
        />
      )}
    </div>
  );
}
