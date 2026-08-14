import { useCallback, useEffect, useRef, useState } from "react";
import {
  Ban,
  ChevronDown,
  ChevronRight,
  HardDriveDownload,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useConnections } from "@/hooks/use-connections";
import type { BackupFileInfo, BackupInspection } from "@/shared/types/db-sync";
import {
  EndpointFields,
  RunLog,
  formatBytes,
  formatRelativeTime,
  useDatabaseList,
  useRunLog,
} from "./shared";

type InspectionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: BackupInspection };

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
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [inspections, setInspections] = useState<Record<string, InspectionState>>({});
  const [deleteTarget, setDeleteTarget] = useState<BackupFileInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  async function handleToggleDetails(backup: BackupFileInfo) {
    if (expandedPath === backup.path) {
      setExpandedPath(null);
      return;
    }
    setExpandedPath(backup.path);
    if (inspections[backup.path]) return;

    setInspections((prev) => ({ ...prev, [backup.path]: { status: "loading" } }));
    const result = await globalThis.window.dbSyncApi.inspectBackup(backup.path);
    setInspections((prev) => ({
      ...prev,
      [backup.path]: result.success
        ? { status: "ok", data: result.data }
        : { status: "error", message: result.error },
    }));
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await globalThis.window.dbSyncApi.deleteBackup(deleteTarget.path);
    setDeleting(false);
    if (result.success) {
      toast.success("Backup removed");
      setDeleteTarget(null);
      await refreshBackups();
    } else {
      toast.error("Failed to remove backup", { description: result.error });
    }
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
            {backups.map((backup) => {
              const expanded = expandedPath === backup.path;
              const inspection = inspections[backup.path];
              return (
                <div
                  key={backup.path}
                  className="rounded-md border border-border bg-card text-xs"
                >
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-1.5 text-left"
                      onClick={() => {
                        handleToggleDetails(backup).catch(() => undefined);
                      }}
                    >
                      {expanded ? (
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <p className="truncate font-mono">{backup.fileName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatBytes(backup.sizeBytes)} ·{" "}
                          {formatRelativeTime(backup.mtimeMs)}
                        </p>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={running}
                        title={
                          running
                            ? "Wait for the current backup to finish first"
                            : undefined
                        }
                        onClick={() => onUseForRestore(backup.path)}
                      >
                        Restore from this
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove backup"
                        onClick={() => setDeleteTarget(backup)}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-200 ease-out",
                      expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 px-2.5 py-1.5 text-muted-foreground">
                        <span>
                          <span className="font-medium text-foreground">Time:</span>{" "}
                          {new Date(backup.createdAt ?? backup.mtimeMs).toLocaleString()}
                        </span>
                        <span>
                          <span className="font-medium text-foreground">Target:</span>{" "}
                          {backup.target ?? "—"}
                        </span>
                        {!inspection || inspection.status === "loading" ? (
                          <span className="flex items-center gap-1.5">
                            <Loader2 className="size-3 animate-spin" />
                            Reading backup contents…
                          </span>
                        ) : inspection.status === "error" ? (
                          <span className="text-destructive">{inspection.message}</span>
                        ) : (
                          <>
                            <span>
                              <span className="font-medium text-foreground">
                                {inspection.data.schemas}
                              </span>{" "}
                              schema{inspection.data.schemas === 1 ? "" : "s"}
                            </span>
                            <span>
                              <span className="font-medium text-foreground">
                                {inspection.data.tables}
                              </span>{" "}
                              table{inspection.data.tables === 1 ? "" : "s"}
                            </span>
                            <span>
                              <span className="font-medium text-foreground">
                                {inspection.data.views}
                              </span>{" "}
                              view{inspection.data.views === 1 ? "" : "s"}
                            </span>
                            <span>
                              <span className="font-medium text-foreground">
                                {inspection.data.sequences}
                              </span>{" "}
                              sequence{inspection.data.sequences === 1 ? "" : "s"}
                            </span>
                            <span>
                              <span className="font-medium text-foreground">
                                {inspection.data.functions}
                              </span>{" "}
                              function{inspection.data.functions === 1 ? "" : "s"}
                            </span>
                            <span>
                              <span className="font-medium text-foreground">
                                {formatBytes(backup.sizeBytes)}
                              </span>{" "}
                              on disk
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !deleting && !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this backup?</DialogTitle>
            <DialogDescription>
              This permanently deletes{" "}
              <span className="font-mono">{deleteTarget?.fileName}</span> from
              disk. It cannot be restored from afterward.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                handleConfirmDelete().catch(() => undefined);
              }}
            >
              {deleting && <Loader2 className="size-3.5 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
