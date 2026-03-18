import { useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ViewerShell } from '@/components/workspace/viewer-shell';
import { useWorkspace } from '@/hooks/use-workspace';
import type { DatabaseViewerPath } from '@/shared/types/workspace';

interface SchemaListViewerProps {
  path: DatabaseViewerPath;
}

export function SchemaListViewer({ path }: Readonly<SchemaListViewerProps>) {
  const { schemaCache, refreshSchemaTree, openTab, navigateToView } = useWorkspace();

  const rows = useMemo(() => schemaCache[path.connectionId] ?? [], [
    schemaCache,
    path.connectionId,
  ]);

  function handleRefresh() {
    refreshSchemaTree(path.connectionId, true).catch(() => undefined);
  }

  function handleOpenSchema(schemaName: string) {
    openTab({
      type: 'schema',
      path: { ...path, schemaName },
    }).catch(() => undefined);
  }

  return (
    <ViewerShell
      breadcrumb={[
        {
          label: path.connectionLabel,
          view: {
            type: 'schema-list',
            path,
          },
        },
      ]}
      onNavigateToView={(view) => {
        navigateToView(view).catch(() => undefined);
      }}
      onRefresh={handleRefresh}
    >
      {rows.length === 0 ? (
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No schemas found for this database.
        </div>
      ) : (
        <div className="h-full overflow-auto rounded-lg border border-border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Schema Name</TableHead>
                <TableHead>Tables</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((schema) => (
                <TableRow
                  key={schema.name}
                  className="cursor-pointer"
                  onClick={() => handleOpenSchema(schema.name)}
                >
                  <TableCell className="font-medium">{schema.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {schema.tables.length}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ViewerShell>
  );
}
