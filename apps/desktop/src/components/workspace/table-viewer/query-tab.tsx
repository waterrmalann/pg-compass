import { useCallback, useMemo, useState } from 'react';
import { Loader2, Play, Table2, LayoutList } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SqlEditor, type CompletionSchema } from '@/components/sql-editor/SqlEditor';
import { DataPagination } from '@/components/workspace/table-viewer/data-pagination';
import { TableDataView } from '@/components/workspace/table-viewer/table-data-view';
import { CardDataView } from '@/components/workspace/table-viewer/card-data-view';
import { useWorkspace } from '@/hooks/use-workspace';
import type { ColumnInfo } from '@/shared/types/table-data';

type ViewMode = 'table' | 'card';

function QueryResultView({
  viewMode,
  columns,
  rows,
}: Readonly<{ viewMode: ViewMode; columns: ColumnInfo[]; rows: Record<string, unknown>[] }>) {
  if (viewMode === 'table') {
    return <TableDataView columns={columns} rows={rows} />;
  }
  return <CardDataView columns={columns} rows={rows} />;
}

interface QueryTabProps {
  connectionId: string;
  schema: string;
  table: string;
}

export function QueryTab({ connectionId, schema, table }: Readonly<QueryTabProps>) {
  const { schemaCache } = useWorkspace();
  const [sql, setSql] = useState(`SELECT * FROM "${schema}"."${table}" LIMIT 100;`);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [error, setError] = useState<string | null>(null);

  const completionSchema = useMemo<CompletionSchema>(() => {
    const schemas: string[] = [];
    const tables: Record<string, string[]> = {};
    const cols: Record<string, { name: string; type?: string }[]> = {};

    for (const [connId, dbSchemas] of Object.entries(schemaCache)) {
      if (connId !== connectionId) continue;
      for (const s of dbSchemas) {
        schemas.push(s.name);
        tables[s.name] = s.tables;
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
    async (p: number, ps: number) => {
      setLoading(true);
      setError(null);
      try {
        const result = await globalThis.window.tableDataApi.executeQuery({
          connectionId,
          sql,
          page: p,
          pageSize: ps,
        });

        if (!result.success || !result.data) {
          setError(result.error ?? 'Unknown error');
          toast.error('Query failed', { description: result.error });
          return;
        }

        setColumns(result.data.columns);
        setRows(result.data.rows);
        setTotalCount(result.data.totalCount);
        setHasRun(true);
      } catch (err) {
        const msg = (err as Error).message;
        setError(msg);
        toast.error('Query failed', { description: msg });
      } finally {
        setLoading(false);
      }
    },
    [connectionId, sql],
  );

  function handleRun() {
    setPage(1);
    executeQuery(1, pageSize);
  }

  function handlePageChange(p: number) {
    setPage(p);
    executeQuery(p, pageSize);
  }

  function handlePageSizeChange(ps: number) {
    setPageSize(ps);
    setPage(1);
    executeQuery(1, ps);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Editor area */}
      <div className="flex flex-col gap-2 border-b border-border p-3" data-query-editor>
        <SqlEditor
          value={sql}
          onChange={setSql}
          onSubmit={handleRun}
          placeholder="Write a SELECT query…"
          schema={completionSchema}
          minHeight="96px"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            Only SELECT statements are allowed. Press Ctrl+Enter to run.
          </span>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={handleRun}
            disabled={loading || !sql.trim()}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            Run Query
          </Button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Results */}
      {hasRun && !error && (
        <>
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="text-xs text-muted-foreground">
              {totalCount.toLocaleString()} row{totalCount === 1 ? '' : 's'} returned
            </span>
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              <Button
                type="button"
                variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                size="icon-sm"
                className="size-6"
                onClick={() => setViewMode('table')}
                aria-label="Table view"
              >
                <Table2 className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant={viewMode === 'card' ? 'secondary' : 'ghost'}
                size="icon-sm"
                className="size-6"
                onClick={() => setViewMode('card')}
                aria-label="Card view"
              >
                <LayoutList className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <QueryResultView viewMode={viewMode} columns={columns} rows={rows} />
            )}
          </div>

          <DataPagination
            page={page}
            pageSize={pageSize}
            totalCount={totalCount}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        </>
      )}

      {/* Initial state before running */}
      {!hasRun && !error && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Write a query and press Run to see results.
        </div>
      )}
    </div>
  );
}
