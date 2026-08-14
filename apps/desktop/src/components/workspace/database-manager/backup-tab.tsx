import { useEffect, useId, useRef, useState } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useConnections } from "@/hooks/use-connections";
import type { BackupFileInfo, BackupInspection } from "@/shared/types/backup";
import {
  EndpointFields,
  RunLog,
  formatBytes,
  formatRelativeTime,
  useBackupList,
  useDatabaseList,
  useRunLog,
} from "./shared";

type InspectionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: BackupInspection };

interface BackupTabProps {
  onUseForRestore: (path: string) => void;
  /** Called after a backup is created or removed so other lists can refresh. */
  onBackupsChanged: () => void;
}

export function BackupTab({
  onUseForRestore,
  onBackupsChanged,
}: Readonly<BackupTabProps>) {
  const { connections } = useConnections();
  const [connectionId, setConnectionId] = useState("");
  const [database, setDatabase] = useState("");
  const [running, setRunning] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const runLog = useRunLog();
  const {
    backups,
    loading: loadingBackups,
    refresh: refreshBackups,
  } = useBackupList();
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [inspections, setInspections] = useState<
    Record<string, InspectionState>
  >({});
  const [deleteTarget, setDeleteTarget] = useState<BackupFileInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { databases, loading: loadingDatabases } =
    useDatabaseList(connectionId);

  useEffect(() => {
    if (database && databases.includes(database)) return;
    setDatabase(databases[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databases]);

  useEffect(() => {
    void refreshBackups();
  }, [refreshBackups]);

  const canRun = !running && connectionId !== "" && database !== "";

  async function handleRun() {
    const runId = globalThis.crypto.randomUUID();
    runIdRef.current = runId;
    setRunning(true);
    runLog.reset();

    const cleanup = globalThis.window.backupApi.onProgress((event) => {
      if (event.runId !== runId) return;
      runLog.append(event.line, event.level);
    });

    try {
      const result = await globalThis.window.backupApi.backup({
        runId,
        source: { connectionId, database },
      });

      if (!result.success) {
        toast.error("Backup failed", { description: result.error });
        return;
      }
      if (result.data.status === "ok") {
        toast.success("Backup complete", {
          description: result.data.backupPath,
        });
        onBackupsChanged();
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
    globalThis.window.backupApi
      .cancel({ runId: runIdRef.current })
      .catch(() => undefined);
  }

  async function handleToggleDetails(backup: BackupFileInfo) {
    if (expandedPath === backup.path) {
      setExpandedPath(null);
      return;
    }
    setExpandedPath(backup.path);
    if (inspections[backup.path]) return;

    setInspections((prev) => ({
      ...prev,
      [backup.path]: { status: "loading" },
    }));
    let next: InspectionState;
    try {
      const result = await globalThis.window.backupApi.inspectBackup(
        backup.path,
      );
      next = result.success
        ? { status: "ok", data: result.data }
        : { status: "error", message: result.error };
    } catch (err) {
      next = { status: "error", message: (err as Error).message };
    }
    setInspections((prev) => ({ ...prev, [backup.path]: next }));
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const result = await globalThis.window.backupApi.deleteBackup(
        deleteTarget.path,
      );
      if (!result.success) {
        toast.error("Failed to remove backup", { description: result.error });
        return;
      }
      toast.success("Backup removed");
      setDeleteTarget(null);
      onBackupsChanged();
      await refreshBackups();
    } catch (err) {
      toast.error("Failed to remove backup", {
        description: (err as Error).message,
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <EndpointFields
          label="Database to back up"
          idPrefix="backup-source"
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
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleCancel}
          >
            <Ban className="size-3.5" />
            Cancel run
          </Button>
        ) : (
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!canRun}
            onClick={() => {
              handleRun().catch(() => undefined);
            }}
          >
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  void refreshBackups();
                }}
                disabled={loadingBackups}
                aria-label="Refresh backups"
              >
                <RotateCcw
                  className={cn("size-3.5", loadingBackups && "animate-spin")}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh backups</TooltipContent>
          </Tooltip>
        </div>
        {backups.length === 0 ? (
          <p className="text-xs text-muted-foreground">No backups yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {backups.map((backup) => (
              <BackupRow
                key={backup.path}
                backup={backup}
                expanded={expandedPath === backup.path}
                inspection={inspections[backup.path]}
                running={running}
                onToggleDetails={() => {
                  handleToggleDetails(backup).catch(() => undefined);
                }}
                onUseForRestore={() => onUseForRestore(backup.path)}
                onDelete={() => setDeleteTarget(backup)}
              />
            ))}
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

function BackupRow({
  backup,
  expanded,
  inspection,
  running,
  onToggleDetails,
  onUseForRestore,
  onDelete,
}: Readonly<{
  backup: BackupFileInfo;
  expanded: boolean;
  inspection: InspectionState | undefined;
  running: boolean;
  onToggleDetails: () => void;
  onUseForRestore: () => void;
  onDelete: () => void;
}>) {
  const detailsId = useId();
  return (
    <div className="rounded-md border border-border bg-card text-xs">
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onToggleDetails}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="block truncate font-mono">{backup.fileName}</span>
            <span className="block text-[10px] text-muted-foreground">
              {formatBytes(backup.sizeBytes)} ·{" "}
              {formatRelativeTime(backup.mtimeMs)}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={running}
            onClick={onUseForRestore}
          >
            Restore from this
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove backup ${backup.fileName}`}
                onClick={onDelete}
              >
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove backup</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div
        id={detailsId}
        hidden={!expanded}
        className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-2.5 py-1.5 text-muted-foreground"
      >
        {expanded && <BackupDetails backup={backup} inspection={inspection} />}
      </div>
    </div>
  );
}

function BackupDetails({
  backup,
  inspection,
}: Readonly<{
  backup: BackupFileInfo;
  inspection: InspectionState | undefined;
}>) {
  const inspectionPending = !inspection || inspection.status === "loading";
  return (
    <>
      <span>
        <span className="font-medium text-foreground">Time:</span>{" "}
        {new Date(backup.createdAt ?? backup.mtimeMs).toLocaleString()}
      </span>
      <span>
        <span className="font-medium text-foreground">Source:</span>{" "}
        {backup.target ?? "—"}
      </span>
      {inspectionPending && (
        <span className="flex items-center gap-1.5">
          <Loader2 className="size-3 animate-spin" />
          Reading backup contents…
        </span>
      )}
      {inspection?.status === "error" && (
        <span className="text-destructive">{inspection.message}</span>
      )}
      {inspection?.status === "ok" && (
        <>
          <ObjectCount count={inspection.data.schemas} noun="schema" />
          <ObjectCount count={inspection.data.tables} noun="table" />
          <ObjectCount count={inspection.data.views} noun="view" />
          <ObjectCount count={inspection.data.sequences} noun="sequence" />
          <ObjectCount count={inspection.data.functions} noun="function" />
        </>
      )}
    </>
  );
}

function ObjectCount({
  count,
  noun,
}: Readonly<{ count: number; noun: string }>) {
  return (
    <span>
      <span className="font-medium text-foreground">{count}</span> {noun}
      {count === 1 ? "" : "s"}
    </span>
  );
}
