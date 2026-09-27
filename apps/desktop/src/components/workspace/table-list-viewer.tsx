import { useMemo, useState } from "react";
import { RelationListTable } from "@/components/workspace/relation-list-table";
import { ViewerShell } from "@/components/workspace/viewer-shell";
import { useWorkspace } from "@/hooks/use-workspace";
import type { TableListViewerPath } from "@/shared/types/workspace";

interface TableListViewerProps {
  path: TableListViewerPath;
}

function formatEstimatedRowCount(
  value: number | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }

  return new Intl.NumberFormat().format(value);
}

export function TableListViewer({ path }: Readonly<TableListViewerProps>) {
  const { schemaCache, refreshSchemaTreeWithStatus, navigateToView } =
    useWorkspace();
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const rows = useMemo(() => {
    const schema = schemaCache[path.connectionId]?.find(
      (item) => item.name === path.schemaName,
    );

    return (
      schema?.tables.map((tableName) => {
        const stats = schema.tableStats?.[tableName];

        return {
          name: tableName,
          rowCount: formatEstimatedRowCount(stats?.estimatedRowCount),
          sizeOnDisk: stats?.sizeOnDisk ?? null,
        };
      }) ?? []
    );
  }, [schemaCache, path.connectionId, path.schemaName]);

  async function handleRefresh() {
    setRefreshing(true);
    const result = await refreshSchemaTreeWithStatus(path.connectionId, true);
    if (result.ok) setLastRefreshedAt(new Date());
    setRefreshing(false);
  }

  return (
    <ViewerShell
      breadcrumb={[
        {
          label: path.connectionLabel,
          view: {
            type: "schema-list",
            path: {
              connectionId: path.connectionId,
              connectionLabel: path.connectionLabel,
            },
          },
        },
        {
          label: path.schemaName,
          view: {
            type: "schema",
            path: {
              connectionId: path.connectionId,
              connectionLabel: path.connectionLabel,
              schemaName: path.schemaName,
            },
          },
        },
        {
          label: path.tableName,
          view: {
            type: "table-list",
            path,
          },
        },
      ]}
      onNavigateToView={(view) => {
        navigateToView(view).catch(() => undefined);
      }}
      onRefresh={handleRefresh}
      refreshing={refreshing}
      lastRefreshedAt={lastRefreshedAt}
      refreshLabel="Refresh schema metadata and table list"
    >
      <RelationListTable
        rows={rows}
        selectedName={path.tableName}
        emptyMessage="No tables found in this schema."
      />
    </ViewerShell>
  );
}
