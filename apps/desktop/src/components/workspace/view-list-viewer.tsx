import { useMemo, useState } from "react";
import { RelationListTable } from "@/components/workspace/relation-list-table";
import { ViewerShell } from "@/components/workspace/viewer-shell";
import { useWorkspace } from "@/hooks/use-workspace";
import type { ViewListViewerPath } from "@/shared/types/workspace";

interface ViewListViewerProps {
  path: ViewListViewerPath;
}

export function ViewListViewer({ path }: Readonly<ViewListViewerProps>) {
  const { schemaCache, refreshSchemaTreeWithStatus, navigateToView } =
    useWorkspace();
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const rows = useMemo(() => {
    const schema = schemaCache[path.connectionId]?.find(
      (item) => item.name === path.schemaName,
    );

    return (
      schema?.views.map((view) => ({
        name: view.name,
        rowCount: null,
        sizeOnDisk: null,
        definition: view.definition ?? undefined,
      })) ?? []
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
      shellPath={{
        connectionId: path.connectionId,
        connectionLabel: path.connectionLabel,
      }}
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
          label: path.viewName,
          view: {
            type: "view-list",
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
      refreshLabel="Refresh schema metadata and view list"
    >
      <RelationListTable
        rows={rows}
        selectedName={path.viewName}
        onOpenRow={(row) => {
          navigateToView({
            type: "view-details",
            path: { ...path, viewName: row.name },
          }).catch(() => undefined);
        }}
        includeDefinition
        emptyMessage="No views found in this schema."
      />
    </ViewerShell>
  );
}
