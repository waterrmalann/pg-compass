import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, HardDriveDownload, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useConnections } from "@/hooks/use-connections";
import type { BackupFileInfo } from "@/shared/types/db-sync";
import {
  EndpointFields,
  RunLog,
  formatBytes,
  formatRelativeTime,
  useDatabaseList,
  useRunLog,
} from "./shared";

interface BackupTabProps {
  onUseForRestore: (path: string) => void;
}

export function BackupTab({ onUseForRestore }: Readonly<BackupTabProps>) {
  const { connections } = useConnections();
  const [connectionId, setConnectionId] = useState("");
  const [database, setDatabase] = useState("");
  const [running, setRunning] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const runLog = useRunLog();
  const [backups, setBackups] = useState<BackupFileInfo[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);

  const { databases, loading: loadingDatabases } = useDatabaseList(connectionId);

  useEffect(() => {
    if (database && databases.includes(database)) return;
    setDatabase(databases[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databases]);

  const refreshBackups = useCallback(async () => {
    setLoadingBackups(true);
    const result = await globalThis.window.dbSyncApi.listBackups();
    if (result.success) {
      setBackups(result.data);
    } else {
      toast.error("Failed to list backups", { description: result.error });
    }
    setLoadingBackups(false);
  }, []);

  useEffect(() => {
    refreshBackups().catch(() => undefined);
  }, [refreshBackups]);

  const canRun = !running && connectionId !== "" && database !== "";

  async function handleRun() {
    const runId = globalThis.crypto.randomUUID();
    runIdRef.current = runId;
    setRunning(true);
    runLog.reset();

    const cleanup = globalThis.window.dbSyncApi.onProgress((event) => {
      if (event.runId !== runId) return;
      runLog.append(event.line, event.level);
    });

    try {
      const result = await globalThis.window.dbSyncApi.backup({
        runId,
        source: { connectionId, database },
      });

      if (!result.success) {
        toast.error("Backup failed", { description: result.error });
        return;
      }
      if (result.data.status === "ok") {
        toast.success("Backup complete", { description: result.data.backupPath });
        await refreshBackups();
      } else if (result.data.status === "cancelled") {
        toast.info("Backup cancelled");
      } else {
        toast.error("Backup failed", { description: result.data.message });
      }
    } catch (err) {
      toast.error("Backup failed", { description: (err as Error).message });
    } finally {
      cleanup();
      runIdRef.current = null;
      setRunning(false);
    }
  }

  function handleCancel() {
    if (!runIdRef.current) return;
    globalThis.window.dbSyncApi.cancel({ runId: runIdRef.current }).catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <EndpointFields
          label="Database to back up"
          connectionId={connectionId}
          onConnectionChange={setConnectionId}
          database={database}
          onDatabaseChange={setDatabase}
          databases={databases}
          loadingDatabases={loadingDatabases}
          connections={connections}
          disabled={running}
        />
      </div>

      {(runLog.log.length > 0 || running) && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Log</span>
          <RunLog log={runLog.log} running={running} endRef={runLog.endRef} />
        </div>
      )}

      <div className="flex justify-end gap-2">
        {running ? (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCancel}>
            <Ban className="size-3.5" />
            Cancel run
          </Button>
        ) : (
          <Button size="sm" className="gap-1.5" disabled={!canRun} onClick={handleRun}>
            <HardDriveDownload className="size-3.5" />
            Run backup
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Recent backups
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              refreshBackups().catch(() => undefined);
            }}
            disabled={loadingBackups}
            aria-label="Refresh backups"
          >
            <RotateCcw className={cn("size-3.5", loadingBackups && "animate-spin")} />
          </Button>
        </div>
        {backups.length === 0 ? (
          <p className="text-xs text-muted-foreground">No backups yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {backups.map((backup) => (
              <div
                key={backup.path}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono">{backup.fileName}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatBytes(backup.sizeBytes)} · {formatRelativeTime(backup.mtimeMs)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => onUseForRestore(backup.path)}
                >
                  Restore from this
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
