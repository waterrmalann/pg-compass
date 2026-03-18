import { useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ViewerShell } from '@/components/workspace/viewer-shell';
import {
  RelationListTable,
  type RelationListRow,
} from '@/components/workspace/relation-list-table';
import { useWorkspace } from '@/hooks/use-workspace';
import type { SchemaViewerPath } from '@/shared/types/workspace';

interface SchemaViewerProps {
  path: SchemaViewerPath;
}

function formatEstimatedRowCount(value: number | null | undefined): string {
  if (value == null) {
    return 'Unknown';
  }

  return new Intl.NumberFormat().format(value);
}

export function SchemaViewer({ path }: Readonly<SchemaViewerProps>) {
  const {
    schemaCache,
    refreshSchemaTree,
    openTab,
    navigateToView,
  } = useWorkspace();
  const [activeTab, setActiveTab] = useState('tables');

  const schemaNode = useMemo(
    () => schemaCache[path.connectionId]?.find((schema) => schema.name === path.schemaName),
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
        sizeOnDisk: stats?.sizeOnDisk ?? 'Unknown',
      };
    });
  }, [schemaNode]);

  const viewRows = useMemo<RelationListRow[]>(() => {
    // Views are not yet included in the schema IPC payload.
    return [];
  }, []);

  function handleRefresh() {
    refreshSchemaTree(path.connectionId, true).catch(() => undefined);
  }

  function handleOpenTable(name: string) {
    openTab({
      type: 'table-details',
      path: { ...path, tableName: name },
    }).catch(() => undefined);
  }

  function handleOpenView(name: string) {
    openTab({
      type: 'view-details',
      path: { ...path, viewName: name },
    }).catch(() => undefined);
  }

  return (
    <ViewerShell
      breadcrumb={[
        {
          label: path.connectionLabel,
          view: {
            type: 'schema-list',
            path: {
              connectionId: path.connectionId,
              connectionLabel: path.connectionLabel,
            },
          },
        },
        {
          label: path.schemaName,
          view: {
            type: 'schema',
            path,
          },
        },
      ]}
      onNavigateToView={(view) => {
        navigateToView(view).catch(() => undefined);
      }}
      onRefresh={handleRefresh}
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full min-h-0">
        <TabsList variant="line" className="h-8">
          <TabsTrigger value="tables" className="h-7 px-3 text-xs">
            Tables
          </TabsTrigger>
          <TabsTrigger value="views" className="h-7 px-3 text-xs">
            Views
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tables" className="min-h-0 flex-1 pt-2">
          <RelationListTable
            rows={tableRows}
            onOpenRow={(row) => handleOpenTable(row.name)}
            emptyMessage="No tables found in this schema."
          />
        </TabsContent>

        <TabsContent value="views" className="min-h-0 flex-1 pt-2">
          <RelationListTable
            rows={viewRows}
            onOpenRow={(row) => handleOpenView(row.name)}
            emptyMessage="No views found in this schema."
          />
        </TabsContent>
      </Tabs>
    </ViewerShell>
  );
}
