import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { RelationSubTabsList } from "@/components/workspace/relation-sub-tabs";
import { ViewerShell } from "@/components/workspace/viewer-shell";
import { DataTab } from "@/components/workspace/table-viewer/data-tab";
import { StructureTab } from "@/components/workspace/table-viewer/structure-tab";
import { IndexesTab } from "@/components/workspace/table-viewer/indexes-tab";
import { ConstraintsTab } from "@/components/workspace/table-viewer/constraints-tab";
import { TriggersTab } from "@/components/workspace/table-viewer/triggers-tab";
import { TypesTab } from "@/components/workspace/table-viewer/types-tab";
import { QueryTab } from "@/components/workspace/table-viewer/query-tab";
import { useWorkspace } from "@/hooks/use-workspace";
import type { TableListViewerPath } from "@/shared/types/workspace";
import { DEFAULT_RELATION_SESSION } from "@/shared/types/workspace";

interface TableDetailsViewerProps {
  path: TableListViewerPath;
  tabId: string;
}

export function TableDetailsViewer({
  path,
  tabId,
}: Readonly<TableDetailsViewerProps>) {
  const {
    refreshSchemaTreeWithStatus,
    navigateToView,
    relationSessions,
    updateRelationSession,
  } = useWorkspace();
  const session = relationSessions[tabId] ?? DEFAULT_RELATION_SESSION;
  const activeTab = session.activeSubTab;
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const metadataRefreshOkRef = useRef(true);

  async function handleRefresh() {
    setRefreshing(true);
    const result = await refreshSchemaTreeWithStatus(path.connectionId, true);
    metadataRefreshOkRef.current = result.ok;
    setRefreshSignal((current) => current + 1);
  }

  const handleRefreshComplete = useCallback((success: boolean) => {
    setRefreshing(false);
    if (success && metadataRefreshOkRef.current) {
      setLastRefreshedAt(new Date());
      toast.success("Table view refreshed");
    }
  }, []);

  const signalFor = (tab: string) => (activeTab === tab ? refreshSignal : 0);

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
          label: path.tableName,
          view: {
            type: "table-details",
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
      refreshLabel={`Refresh ${activeTab} and table metadata`}
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          updateRelationSession(tabId, {
            activeSubTab: value as typeof session.activeSubTab,
          })
        }
        className="flex h-full min-h-0 flex-col gap-3"
      >
        <RelationSubTabsList
          tabs={[
            "data",
            "structure",
            "indexes",
            "constraints",
            "triggers",
            "types",
            "query",
          ]}
        />

        <TabsContent value="data" className="min-h-0 flex-1">
          <DataTab
            connectionId={path.connectionId}
            schema={path.schemaName}
            table={path.tableName}
            relationType="table"
            session={session}
            onSessionChange={(patch) => updateRelationSession(tabId, patch)}
            refreshSignal={signalFor("data")}
            onRefreshComplete={handleRefreshComplete}
          />
        </TabsContent>

        <TabsContent value="structure" className="min-h-0 flex-1">
          <StructureTab
            connectionId={path.connectionId}
            schema={path.schemaName}
            table={path.tableName}
            refreshSignal={signalFor("structure")}
            onRefreshComplete={handleRefreshComplete}
          />
        </TabsContent>

        <TabsContent value="indexes" className="min-h-0 flex-1">
          <IndexesTab
            connectionId={path.connectionId}
            schema={path.schemaName}
            table={path.tableName}
            refreshSignal={signalFor("indexes")}
            onRefreshComplete={handleRefreshComplete}
          />
        </TabsContent>

        <TabsContent value="constraints" className="min-h-0 flex-1">
          <ConstraintsTab
            connectionId={path.connectionId}
            schema={path.schemaName}
            table={path.tableName}
            refreshSignal={signalFor("constraints")}
            onRefreshComplete={handleRefreshComplete}
          />
        </TabsContent>

        <TabsContent value="triggers" className="min-h-0 flex-1">
          <TriggersTab
            connectionId={path.connectionId}
            schema={path.schemaName}
            table={path.tableName}
            refreshSignal={signalFor("triggers")}
            onRefreshComplete={handleRefreshComplete}
          />
        </TabsContent>

        <TabsContent value="types" className="min-h-0 flex-1">
          <TypesTab
            connectionId={path.connectionId}
            schema={path.schemaName}
            table={path.tableName}
            refreshSignal={signalFor("types")}
            onRefreshComplete={handleRefreshComplete}
          />
        </TabsContent>

        <TabsContent value="query" className="min-h-0 flex-1">
          <QueryTab
            connectionId={path.connectionId}
            schema={path.schemaName}
            table={path.tableName}
            refreshSignal={signalFor("query")}
            onRefreshComplete={handleRefreshComplete}
          />
        </TabsContent>
      </Tabs>
    </ViewerShell>
  );
}
