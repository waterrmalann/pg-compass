import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ban, FolderOpen, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConnections } from "@/hooks/use-connections";
import type { BackupFileInfo } from "@/shared/types/db-sync";
import {
  EndpointFields,
  ProdConfirmDialog,
  RunLog,
  endpointKey,
  formatBytes,
  formatRelativeTime,
  looksLikeProduction,
  useDatabaseList,
  useProdGuard,
  useRunLog,
} from "./shared";

interface RestoreTabProps {
  prefillPath: string | null;
  onConsumePrefill: () => void;
}

export function RestoreTab({
  prefillPath,
  onConsumePrefill,
}: Readonly<RestoreTabProps>) {
  const { connections } = useConnections();

  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [targetDatabase, setTargetDatabase] = useState("");
  const [sourceMode, setSourceMode] = useState<"list" | "file">("list");
  const [selectedBackupPath, setSelectedBackupPath] = useState("");
  const [filePath, setFilePath] = useState("");
  const [backups, setBackups] = useState<BackupFileInfo[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [backupTarget, setBackupTarget] = useState(false);
  const [running, setRunning] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const runLog = useRunLog();

  const prodGuardEnabled = useProdGuard();
  const [prodConfirmOpen, setProdConfirmOpen] = useState(false);
  const [confirmedProdKey, setConfirmedProdKey] = useState<string | null>(null);

  const { databases: targetDatabasesRaw, loading: loadingTargetDbs } =
    useDatabaseList(targetConnectionId);

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

  useEffect(() => {
    if (!prefillPath) return;
    setSourceMode("list");
    setSelectedBackupPath(prefillPath);
    onConsumePrefill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillPath]);

  const targetConnection = useMemo(
    () => connections.find((c) => c.id === targetConnectionId),
    [connections, targetConnectionId],
  );

  const visibleTargetDatabases = useMemo(() => {
    if (prodGuardEnabled) return targetDatabasesRaw;
    return targetDatabasesRaw.filter(
      (name) => !looksLikeProduction(targetConnection, name),
    );
  }, [targetDatabasesRaw, targetConnection, prodGuardEnabled]);
  const hiddenProdCount = targetDatabasesRaw.length - visibleTargetDatabases.length;

  useEffect(() => {
    if (targetDatabase && visibleTargetDatabases.includes(targetDatabase)) return;
    setTargetDatabase(visibleTargetDatabases[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTargetDatabases]);

  const isTargetProd = looksLikeProduction(targetConnection, targetDatabase);
  const targetKey = endpointKey(targetConnectionId, targetDatabase);

  useEffect(() => {
    if (!targetDatabase || !isTargetProd) return;
    if (confirmedProdKey === targetKey) return;
    setProdConfirmOpen(true);
  }, [targetDatabase, isTargetProd, targetKey, confirmedProdKey]);

  useEffect(() => {
    if (!targetDatabase) return;
    setBackupTarget(isTargetProd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetConnectionId, targetDatabase]);

  const backupPath = sourceMode === "list" ? selectedBackupPath : filePath;
  const targetLabel = targetConnection?.label;
  const confirmedProdTarget = !isTargetProd || confirmedProdKey === targetKey;
  const confirmedRestore = targetDatabase !== "" && confirmText === targetDatabase;

  const canRun =
    !running &&
    targetConnectionId !== "" &&
    targetDatabase !== "" &&
    backupPath !== "" &&
    confirmedProdTarget &&
    confirmedRestore;

  async function handleBrowse() {
    const result = await globalThis.window.connectionApi.showOpenFileDialog({
      title: "Select a backup file to restore",
      filters: [
        { name: "Backup files", extensions: ["dump", "sql", "backup"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.success && result.data) {
      setSourceMode("file");
      setFilePath(result.data);
    }
  }

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
      const result = await globalThis.window.dbSyncApi.restore({
        runId,
        target: { connectionId: targetConnectionId, database: targetDatabase },
        backupPath,
        backupTarget,
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
    globalThis.window.dbSyncApi.cancel({ runId: runIdRef.current }).catch(() => undefined);
  }

  function handleConfirmProdTarget() {
    setConfirmedProdKey(targetKey);
    setProdConfirmOpen(false);
  }

  function handleCancelProdTarget() {
    setProdConfirmOpen(false);
    setTargetDatabase("");
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <EndpointFields
          label="Target"
          connectionId={targetConnectionId}
          onConnectionChange={setTargetConnectionId}
          database={targetDatabase}
          onDatabaseChange={setTargetDatabase}
          databases={visibleTargetDatabases}
          loadingDatabases={loadingTargetDbs}
          connections={connections}
          disabled={running}
          hint={
            hiddenProdCount > 0
              ? `${hiddenProdCount} production database${hiddenProdCount === 1 ? "" : "s"} hidden — enable in Settings > General.`
              : undefined
          }
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
              onClick={() => setSourceMode("file")}
              disabled={running}
            >
              Browse for file
            </Button>
          </div>

          {sourceMode === "list" ? (
            <select
              value={selectedBackupPath}
              onChange={(e) => setSelectedBackupPath(e.target.value)}
              disabled={running || loadingBackups}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">
                {loadingBackups
                  ? "Loading…"
                  : backups.length === 0
                    ? "No backups yet"
                    : "Select a backup…"}
              </option>
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
            <Label htmlFor="db-restore-confirm" className="text-xs text-destructive">
              Type <span className="font-mono">{targetDatabase}</span> to confirm
              you want to permanently replace it{targetLabel ? ` on "${targetLabel}"` : ""}.
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
            <Button
              size="sm"
              className="gap-1.5"
              variant="destructive"
              disabled={!canRun}
              onClick={handleRun}
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
