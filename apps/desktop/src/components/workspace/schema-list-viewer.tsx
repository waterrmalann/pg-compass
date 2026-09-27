import { useState } from "react";
import { FolderTree } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ViewerShell } from "@/components/workspace/viewer-shell";
import { useWorkspace } from "@/hooks/use-workspace";
import type { DatabaseViewerPath } from "@/shared/types/workspace";

interface SchemaListViewerProps {
  path: DatabaseViewerPath;
}

export function SchemaListViewer({ path }: Readonly<SchemaListViewerProps>) {
  const { schemaCache, refreshSchemaTreeWithStatus, openTab, navigateToView } =
    useWorkspace();

  const rows = schemaCache[path.connectionId] ?? [];
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    const result = await refreshSchemaTreeWithStatus(path.connectionId, true);
    if (result.ok) setLastRefreshedAt(new Date());
    setRefreshing(false);
  }

  function handleOpenSchema(schemaName: string) {
    openTab({
      type: "schema",
      path: { ...path, schemaName },
    }).catch(() => undefined);
  }

  return (
    <ViewerShell
      breadcrumb={[
        {
          label: path.connectionLabel,
          view: {
            type: "schema-list",
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
      refreshLabel="Refresh connection schemas and relation counts"
    >
      {rows.length === 0 ? (
        <Panel className="h-full">
          <EmptyState
            icon={<FolderTree />}
            title="No schemas found for this database."
          />
        </Panel>
      ) : (
        <Panel className="max-h-full">
          <div className="min-h-0 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Schema name</TableHead>
                  <TableHead className="w-40 text-right">Tables</TableHead>
                  <TableHead className="w-40 text-right">Views</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((schema) => (
                  <TableRow
                    key={schema.name}
                    className="cursor-pointer"
                    onClick={() => handleOpenSchema(schema.name)}
                  >
                    <TableCell className="font-mono text-[12.5px] font-medium">
                      {schema.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {schema.tables.length}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {schema.views.length}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
    </ViewerShell>
  );
}
