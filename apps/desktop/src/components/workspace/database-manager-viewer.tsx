import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ViewerShell } from "@/components/workspace/viewer-shell";
import { BackupTab } from "@/components/workspace/database-manager/backup-tab";
import { RestoreTab } from "@/components/workspace/database-manager/restore-tab";

type DatabaseManagerTab = "backup" | "restore";

export function DatabaseManagerViewer() {
  const [activeTab, setActiveTab] = useState<DatabaseManagerTab>("backup");
  const [restorePrefillPath, setRestorePrefillPath] = useState<string | null>(
    null,
  );

  return (
    <ViewerShell
      breadcrumb={[{ label: "Database Manager" }]}
      onRefresh={() => undefined}
      refreshDisabled
      refreshLabel="Nothing to refresh here"
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as DatabaseManagerTab)}
          className="flex min-h-0 flex-1 flex-col gap-2"
        >
          <TabsList>
            <TabsTrigger value="backup">Back Up</TabsTrigger>
            <TabsTrigger value="restore">Restore</TabsTrigger>
          </TabsList>

          <TabsContent value="backup" className="mt-0 min-h-0 flex-1 overflow-y-auto">
            <BackupTab
              onUseForRestore={(path) => {
                setRestorePrefillPath(path);
                setActiveTab("restore");
              }}
            />
          </TabsContent>

          <TabsContent value="restore" className="mt-0 min-h-0 flex-1 overflow-y-auto">
            <RestoreTab
              prefillPath={restorePrefillPath}
              onConsumePrefill={() => setRestorePrefillPath(null)}
            />
          </TabsContent>
        </Tabs>
      </div>
    </ViewerShell>
  );
}
