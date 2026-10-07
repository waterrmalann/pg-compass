import { useCallback, useRef, useState } from "react";
import { FolderTree, Network } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SchemaDiagramTab } from "@/components/workspace/schema-diagram/schema-diagram-tab";
import { ViewerShell } from "@/components/workspace/viewer-shell";
import { useWorkspace } from "@/hooks/use-workspace";
import type { DatabaseSchema } from "@/shared/types/connection";
import type { DatabaseViewerPath } from "@/shared/types/workspace";

interface SchemaListViewerProps {
  path: DatabaseViewerPath;
}

type DatabaseSubTab = "schemas" | "diagram";

export function SchemaListViewer({ path }: Readonly<SchemaListViewerProps>) {
  const { schemaCache, refreshSchemaTreeWithStatus, openTab, navigateToView } =
    useWorkspace();

  const rows = schemaCache[path.connectionId] ?? [];
  const [activeTab, setActiveTab] = useState<DatabaseSubTab>("schemas");
  // The diagram is only loaded once it is first opened, then kept mounted so
  // switching sub-tabs keeps its data and viewport.
  const [diagramOpened, setDiagramOpened] = useState(false);
  const [diagramRefreshSignal, setDiagramRefreshSignal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const schemaRefreshOkRef = useRef(true);

  function handleTabChange(value: string) {
    const tab = value as DatabaseSubTab;
    setActiveTab(tab);
    if (tab === "diagram") setDiagramOpened(true);
  }

  function finishRefresh(success: boolean) {
    setRefreshing(false);
    if (success) setLastRefreshedAt(new Date());
  }

  async function handleRefresh() {
    setRefreshing(true);
    const result = await refreshSchemaTreeWithStatus(path.connectionId, true);
    schemaRefreshOkRef.current = result.ok;
    if (!diagramOpened) {
      finishRefresh(result.ok);
      return;
    }
    // The diagram reports back through handleDiagramRefreshComplete.
    setDiagramRefreshSignal((signal) => signal + 1);
  }

  const handleDiagramRefreshComplete = useCallback((success: boolean) => {
    setRefreshing(false);
    if (success && schemaRefreshOkRef.current) setLastRefreshedAt(new Date());
  }, []);

  function handleOpenSchema(schemaName: string) {
    openTab({
      type: "schema",
      path: { ...path, schemaName },
    }).catch(() => undefined);
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
      refreshLabel={
        activeTab === "diagram"
          ? "Refresh connection schemas and the diagram"
          : "Refresh connection schemas and relation counts"
      }
    >
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="h-full min-h-0 gap-3"
      >
        <TabsList className="shrink-0">
          <TabsTrigger value="schemas">
            <FolderTree />
            Schemas
            <span
              aria-hidden
              className="font-mono text-[11px] text-subtle-foreground"
            >
              {rows.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="diagram">
            <Network />
            Diagram
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schemas" className="min-h-0 flex-1">
          <SchemaTable rows={rows} onOpenSchema={handleOpenSchema} />
        </TabsContent>

        {diagramOpened ? (
          <TabsContent
            value="diagram"
            forceMount
            className="min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <SchemaDiagramTab
              path={path}
              schemas={rows}
              refreshSignal={diagramRefreshSignal}
              onRefreshComplete={handleDiagramRefreshComplete}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </ViewerShell>
  );
}

function SchemaTable({
  rows,
  onOpenSchema,
}: Readonly<{
  rows: DatabaseSchema[];
  onOpenSchema: (schemaName: string) => void;
}>) {
  if (rows.length === 0) {
    return (
      <Panel className="h-full">
        <EmptyState
          icon={<FolderTree />}
          title="No schemas found for this database."
        />
      </Panel>
    );
  }

  return (
    <Panel className="max-h-full">
      <div className="min-h-0 overflow-auto">
        <Table scrollable={false}>
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
                onClick={() => onOpenSchema(schema.name)}
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
  );
}
