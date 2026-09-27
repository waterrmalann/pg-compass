import { useEffect, useId, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Ban,
  ChevronRight,
  HardDriveDownload,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelCount,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from "@/components/ui/panel";
import { MissingValue } from "@/components/workspace/relation-list-table";
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
    <div className="flex max-w-3xl flex-col gap-4">
      <Panel>
        <PanelHeader>
          <HardDriveDownload />
          <PanelTitle>New backup</PanelTitle>
          <span className="ml-auto text-xs text-muted-foreground">
            Custom-format dump with pg_dump
          </span>
        </PanelHeader>
        <div className="flex flex-col gap-4 p-4">
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
          {(runLog.log.length > 0 || running) && (
            <RunLog log={runLog.log} running={running} endRef={runLog.endRef} />
          )}
        </div>
        <PanelFooter className="justify-end">
          {running ? (
            <Button variant="outline" size="sm" onClick={handleCancel}>
              <Ban />
              Cancel run
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!canRun}
              onClick={() => {
                handleRun().catch(() => undefined);
              }}
            >
              <HardDriveDownload />
              Run backup
            </Button>
          )}
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader>
          <Archive />
          <PanelTitle>Backups</PanelTitle>
          <PanelCount>{backups.length}</PanelCount>
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            onClick={() => {
              void refreshBackups();
            }}
            disabled={loadingBackups}
            aria-label="Refresh backups"
            title="Refresh backups"
          >
            <RotateCcw className={cn(loadingBackups && "animate-spin")} />
          </Button>
        </PanelHeader>
        {backups.length === 0 ? (
          <EmptyState
            icon={<Archive />}
            title="No backups yet"
            description="Backups you run are saved on this machine and listed here."
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-border/70">
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
          </ul>
        )}
      </Panel>

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
    <li className="text-xs">
      <div className="flex min-h-12 items-center gap-2 py-1.5 pr-2 pl-4 transition-colors duration-150 hover:bg-muted/40">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onToggleDetails}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="block truncate font-mono text-[12.5px] text-foreground">
              {backup.fileName}
            </span>
            <span className="block text-muted-foreground tabular-nums">
              {formatBytes(backup.sizeBytes)} ·{" "}
              {formatRelativeTime(backup.mtimeMs)}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={running}
            onClick={onUseForRestore}
          >
            <ArchiveRestore />
            Restore from this
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="hover:text-destructive-foreground"
            aria-label={`Remove backup ${backup.fileName}`}
            title="Remove backup"
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <div
        id={detailsId}
        hidden={!expanded}
        className="border-t border-border/70 bg-muted/40 py-3 pr-4 pl-9.5"
      >
        {expanded && <BackupDetails backup={backup} inspection={inspection} />}
      </div>
    </li>
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
    <div className="flex flex-col gap-2.5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Created</dt>
        <dd className="tabular-nums">
          {new Date(backup.createdAt ?? backup.mtimeMs).toLocaleString()}
        </dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd className="min-w-0 truncate font-mono">
          {backup.target ?? <MissingValue />}
        </dd>
      </dl>
      {inspectionPending && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Reading backup contents…
        </span>
      )}
      {inspection?.status === "error" && (
        <span className="text-destructive-foreground">
          {inspection.message}
        </span>
      )}
      {inspection?.status === "ok" && (
        <div className="flex flex-wrap gap-1.5">
          <ObjectCount count={inspection.data.schemas} noun="schema" />
          <ObjectCount count={inspection.data.tables} noun="table" />
          <ObjectCount count={inspection.data.views} noun="view" />
          <ObjectCount count={inspection.data.sequences} noun="sequence" />
          <ObjectCount count={inspection.data.functions} noun="function" />
        </div>
      )}
    </div>
  );
}

function ObjectCount({
  count,
  noun,
}: Readonly<{ count: number; noun: string }>) {
  return (
    <Badge className="tabular-nums">
      {count} {noun}
      {count === 1 ? "" : "s"}
    </Badge>
  );
}
