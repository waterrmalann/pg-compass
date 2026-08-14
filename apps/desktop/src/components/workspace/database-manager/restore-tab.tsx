import { useEffect, useRef, useState } from "react";
import { Ban, FolderOpen, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConnections } from "@/hooks/use-connections";
import { useSettings } from "@/hooks/use-settings";
import { looksLikeProduction } from "@/shared/production-guard";
import type { ConnectionConfig } from "@/shared/types/connection";
import {
  EndpointFields,
  ProdConfirmDialog,
  RunLog,
  endpointKey,
  formatBytes,
  formatRelativeTime,
  useBackupList,
  useDatabaseList,
  useRunLog,
} from "./shared";

interface RestoreTabProps {
  prefillPath: string | null;
  onConsumePrefill: () => void;
  /** Bumped when the Backup tab creates or removes a backup. */
  backupsRevision: number;
}

function connectionHost(connection: ConnectionConfig | undefined): string {
  if (!connection) return "";
  if (connection.mode === "fields") return connection.fields?.host ?? "";
  if (!connection.uri) return "";
  try {
    return new URL(connection.uri).hostname;
  } catch {
    return "";
  }
}

function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.at(-1) ?? path;
}

export function RestoreTab({
  prefillPath,
  onConsumePrefill,
  backupsRevision,
}: Readonly<RestoreTabProps>) {
  const { connections } = useConnections();
  const { settings } = useSettings();
  const readOnlyMode = settings.general.readOnlyMode;

  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [targetDatabase, setTargetDatabase] = useState("");
  const [sourceMode, setSourceMode] = useState<"list" | "file">("list");
  const [selectedBackupPath, setSelectedBackupPath] = useState("");
  const [filePath, setFilePath] = useState("");
  const {
    backups,
    loading: loadingBackups,
    refresh: refreshBackups,
  } = useBackupList();
  const [confirmText, setConfirmText] = useState("");
  const [backupTarget, setBackupTarget] = useState(false);
  const [running, setRunning] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const runLog = useRunLog();

  const [prodConfirmOpen, setProdConfirmOpen] = useState(false);
  const [confirmedProdKey, setConfirmedProdKey] = useState<string | null>(null);

  const { databases: targetDatabases, loading: loadingTargetDbs } =
    useDatabaseList(targetConnectionId);

  useEffect(() => {
    void refreshBackups();
  }, [refreshBackups, backupsRevision]);

  useEffect(() => {
    if (!prefillPath) return;
    setSourceMode("list");
    setSelectedBackupPath(prefillPath);
    onConsumePrefill();
    // The path may belong to a backup created after this list was loaded.
    void refreshBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillPath]);

  const targetConnection = connections.find(
    (connection) => connection.id === targetConnectionId,
  );

  useEffect(() => {
    if (targetDatabase && targetDatabases.includes(targetDatabase)) return;
    setTargetDatabase(targetDatabases[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetDatabases]);

  const isTargetProd =
    targetDatabase !== "" &&
    looksLikeProduction(
      targetConnection?.label,
      connectionHost(targetConnection),
      targetDatabase,
    );
  const targetKey = endpointKey(targetConnectionId, targetDatabase);

  useEffect(() => {
    if (!isTargetProd) return;
    if (confirmedProdKey === targetKey) return;
    setProdConfirmOpen(true);
  }, [isTargetProd, targetKey, confirmedProdKey]);

  useEffect(() => {
    setConfirmText("");
    if (!targetDatabase) return;
    setBackupTarget(isTargetProd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetConnectionId, targetDatabase]);

  const selectedBackupListed = backups.some(
    (backup) => backup.path === selectedBackupPath,
  );
  const backupPath = sourceMode === "list" ? selectedBackupPath : filePath;
  const hasValidSource =
    sourceMode === "list" ? selectedBackupListed : filePath !== "";
  const targetLabel = targetConnection?.label;
  const confirmedProdTarget = !isTargetProd || confirmedProdKey === targetKey;
  const confirmedRestore =
    targetDatabase !== "" && confirmText === targetDatabase;

  const canRun =
    !running &&
    !readOnlyMode &&
    targetConnectionId !== "" &&
    targetDatabase !== "" &&
    hasValidSource &&
    confirmedProdTarget &&
    confirmedRestore;

  async function handleBrowse() {
    try {
      const result = await globalThis.window.backupApi.showRestoreFileDialog();
      if (!result.success) {
        toast.error("Failed to open file picker", {
          description: result.error,
        });
        return;
      }
      if (!result.data) return;
      setSourceMode("file");
      setFilePath(result.data);
    } catch (err) {
      toast.error("Failed to open file picker", {
        description: (err as Error).message,
      });
    }
  }

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
      const result = await globalThis.window.backupApi.restore({
        runId,
        target: { connectionId: targetConnectionId, database: targetDatabase },
        backupPath,
        backupTarget,
        confirmProduction: isTargetProd,
      });

      if (!result.success) {
        toast.error("Restore failed", { description: result.error });
        return;
      }
      if (result.data.status === "ok") {
        toast.success("Restore complete", {
          description: result.data.backupPath
            ? `Pre-restore backup saved to ${result.data.backupPath}`
            : undefined,
        });
        if (result.data.backupPath) void refreshBackups();
      } else if (result.data.status === "cancelled") {
        toast.info("Restore cancelled");
      } else {
        toast.error("Restore failed", { description: result.data.message });
      }
    } catch (err) {
      toast.error("Restore failed", { description: (err as Error).message });
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

  function handleConfirmProdTarget() {
    setConfirmedProdKey(targetKey);
    setProdConfirmOpen(false);
  }

  function handleCancelProdTarget() {
    setProdConfirmOpen(false);
    setTargetDatabase("");
  }

  let emptyBackupOption = "Select a backup…";
  if (loadingBackups) emptyBackupOption = "Loading…";
  else if (backups.length === 0) emptyBackupOption = "No backups yet";

  return (
    <>
      <div className="flex flex-col gap-3">
        <EndpointFields
          label="Target"
          idPrefix="restore-target"
          connectionId={targetConnectionId}
          onConnectionChange={setTargetConnectionId}
          database={targetDatabase}
          onDatabaseChange={setTargetDatabase}
          databases={targetDatabases}
          loadingDatabases={loadingTargetDbs}
          connections={connections}
          disabled={running}
        />

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Backup source
          </span>
          <div className="flex items-center gap-0.5 self-start rounded-md border border-border p-0.5">
            <Button
              type="button"
              variant={sourceMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-3 text-xs"
              aria-pressed={sourceMode === "list"}
              onClick={() => setSourceMode("list")}
              disabled={running}
            >
              From backups
            </Button>
            <Button
              type="button"
              variant={sourceMode === "file" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-3 text-xs"
              aria-pressed={sourceMode === "file"}
              onClick={() => setSourceMode("file")}
              disabled={running}
            >
              Browse for file
            </Button>
          </div>

          {sourceMode === "list" ? (
            <select
              aria-label="Backup to restore"
              value={selectedBackupPath}
              onChange={(e) => setSelectedBackupPath(e.target.value)}
              disabled={running}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{emptyBackupOption}</option>
              {selectedBackupPath && !selectedBackupListed && (
                <option value={selectedBackupPath}>
                  {fileNameFromPath(selectedBackupPath)}
                  {loadingBackups ? "" : " (not in backup list)"}
                </option>
              )}
              {backups.map((backup) => (
                <option key={backup.path} value={backup.path}>
                  {backup.fileName} ({formatBytes(backup.sizeBytes)},{" "}
                  {formatRelativeTime(backup.mtimeMs)})
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                aria-label="Backup file"
                value={filePath}
                readOnly
                placeholder="No file selected"
                className="h-9 flex-1 text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  handleBrowse().catch(() => undefined);
                }}
                disabled={running}
              >
                <FolderOpen className="size-3.5" />
                Browse…
              </Button>
            </div>
          )}
        </div>

        <label className="flex items-start gap-2 rounded-md border border-border bg-card p-2.5 text-xs">
          <input
            type="checkbox"
            aria-label="Back up target before restoring"
            className="mt-0.5 size-3.5"
            checked={backupTarget}
            disabled={running}
            onChange={(e) => setBackupTarget(e.target.checked)}
          />
          <span>
            <span className="font-medium">Back up target before restoring</span>
            <span className="block text-muted-foreground">
              Dumps the target&apos;s current state to a local file first, in
              case the restore isn&apos;t what you wanted.
              {isTargetProd && " Selected by default for production targets."}
            </span>
          </span>
        </label>

        {targetDatabase && (
          <div className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
            <Label
              htmlFor="db-restore-confirm"
              className="text-xs text-destructive"
            >
              Type <span className="font-mono">{targetDatabase}</span> to
              confirm you want to permanently replace it
              {targetLabel ? ` on "${targetLabel}"` : ""}.
            </Label>
            <Input
              id="db-restore-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={running}
              placeholder={targetDatabase}
              className="h-8 text-xs"
            />
          </div>
        )}

        {(runLog.log.length > 0 || running) && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Log
            </span>
            <RunLog log={runLog.log} running={running} endRef={runLog.endRef} />
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {readOnlyMode && (
            <p className="text-xs text-muted-foreground">
              Read-only mode is on. Turn it off in Settings to restore.
            </p>
          )}
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
              variant="destructive"
              disabled={!canRun}
              onClick={() => {
                handleRun().catch(() => undefined);
              }}
            >
              <Play className="size-3.5" />
              Run restore
            </Button>
          )}
        </div>
      </div>

      <ProdConfirmDialog
        open={prodConfirmOpen}
        database={targetDatabase}
        connectionLabel={targetLabel}
        onConfirm={handleConfirmProdTarget}
        onCancel={handleCancelProdTarget}
      />
    </>
  );
}
