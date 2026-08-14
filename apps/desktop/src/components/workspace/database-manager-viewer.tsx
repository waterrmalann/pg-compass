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
  const [backupsRevision, setBackupsRevision] = useState(0);

  return (
    <ViewerShell
      breadcrumb={[{ label: "Database manager" }]}
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
            <TabsTrigger value="backup">Back up</TabsTrigger>
            <TabsTrigger value="restore">Restore</TabsTrigger>
          </TabsList>

          {/*
            forceMount + data-[state=inactive]:hidden instead of Radix's default
            unmount-when-inactive: without it, switching sub-tabs mid-run destroys
            the tab's runId/progress-log state, leaving a pg_dump/pg_restore
            process running server-side with no Cancel button and no visible
            progress, and remounting the tab resets its `running` flag so a
            second run against the same target can be started concurrently.
          */}
          <TabsContent
            value="backup"
            forceMount
            className="mt-0 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
          >
            <BackupTab
              onUseForRestore={(path) => {
                setRestorePrefillPath(path);
                setActiveTab("restore");
              }}
              onBackupsChanged={() =>
                setBackupsRevision((revision) => revision + 1)
              }
            />
          </TabsContent>

          <TabsContent
            value="restore"
            forceMount
            className="mt-0 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
          >
            <RestoreTab
              prefillPath={restorePrefillPath}
              onConsumePrefill={() => setRestorePrefillPath(null)}
              backupsRevision={backupsRevision}
            />
          </TabsContent>
        </Tabs>
      </div>
    </ViewerShell>
  );
}
