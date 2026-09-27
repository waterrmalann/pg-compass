import { useMemo, useState } from "react";
import { Eye, Table2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ViewerShell } from "@/components/workspace/viewer-shell";
import {
  RelationListTable,
  type RelationListRow,
} from "@/components/workspace/relation-list-table";
import { useWorkspace } from "@/hooks/use-workspace";
import type { SchemaViewerPath } from "@/shared/types/workspace";

interface SchemaViewerProps {
  path: SchemaViewerPath;
}

function formatEstimatedRowCount(
  value: number | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }

  return new Intl.NumberFormat().format(value);
}

export function SchemaViewer({ path }: Readonly<SchemaViewerProps>) {
  const { schemaCache, refreshSchemaTreeWithStatus, openTab, navigateToView } =
    useWorkspace();
  const [activeTab, setActiveTab] = useState("tables");
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const schemaNode = useMemo(
    () =>
      schemaCache[path.connectionId]?.find(
        (schema) => schema.name === path.schemaName,
      ),
    [schemaCache, path.connectionId, path.schemaName],
  );

  const tableRows = useMemo<RelationListRow[]>(() => {
    if (!schemaNode) {
      return [];
    }

    return schemaNode.tables.map((tableName) => {
      const stats = schemaNode.tableStats?.[tableName];

      return {
        name: tableName,
        rowCount: formatEstimatedRowCount(stats?.estimatedRowCount),
        sizeOnDisk: stats?.sizeOnDisk ?? null,
      };
    });
  }, [schemaNode]);

  const viewRows = useMemo<RelationListRow[]>(() => {
    if (!schemaNode) {
      return [];
    }

    return schemaNode.views.map((view) => ({
      name: view.name,
      rowCount: null,
      sizeOnDisk: null,
      definition: view.definition ?? undefined,
    }));
  }, [schemaNode]);

  async function handleRefresh() {
    setRefreshing(true);
    const result = await refreshSchemaTreeWithStatus(path.connectionId, true);
    if (result.ok) setLastRefreshedAt(new Date());
    setRefreshing(false);
  }

  function handleOpenTable(name: string) {
    openTab({
      type: "table-details",
      path: { ...path, tableName: name },
    }).catch(() => undefined);
  }

  function handleOpenView(name: string) {
    openTab({
      type: "view-details",
      path: { ...path, viewName: name },
    }).catch(() => undefined);
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
      refreshLabel={`Refresh schema ${path.schemaName} and visible relation list`}
    >
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="h-full min-h-0 gap-3"
      >
        <TabsList className="shrink-0">
          <TabsTrigger value="tables">
            <Table2 />
            Tables
            <span
              aria-hidden
              className="font-mono text-[11px] text-subtle-foreground"
            >
              {tableRows.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="views">
            <Eye />
            Views
            <span
              aria-hidden
              className="font-mono text-[11px] text-subtle-foreground"
            >
              {viewRows.length}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tables" className="min-h-0 flex-1">
          <RelationListTable
            rows={tableRows}
            onOpenRow={(row) => handleOpenTable(row.name)}
            emptyMessage="No tables found in this schema."
          />
        </TabsContent>

        <TabsContent value="views" className="min-h-0 flex-1">
          <RelationListTable
            rows={viewRows}
            onOpenRow={(row) => handleOpenView(row.name)}
            includeDefinition
            emptyMessage="No views found in this schema."
          />
        </TabsContent>
      </Tabs>
    </ViewerShell>
  );
}
