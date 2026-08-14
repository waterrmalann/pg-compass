import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Play, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useConnections } from "@/hooks/use-connections";
import type { DbSyncMode } from "@/shared/types/db-sync";
import {
  EndpointFields,
  ProdConfirmDialog,
  RunLog,
  endpointKey,
  looksLikeProduction,
  useDatabaseList,
  useProdGuard,
  useRunLog,
} from "./shared";

const MODES: Array<{
  mode: DbSyncMode;
  title: string;
  description: string;
}> = [
  {
    mode: "full-override",
    title: "Full Override",
    description:
      "Wipes the target and replaces it with an exact copy of source (schema + data). Destructive — cannot be undone.",
  },
  {
    mode: "row-sync",
    title: "Row Sync",
    description:
      "No schema changes. For tables that exist on both sides with a primary key: adds new rows, updates changed rows, and deletes target rows removed from source. Still deletes data — not a \"safe\" no-op.",
  },
];

export function SyncTab() {
  const { connections } = useConnections();

  const [sourceConnectionId, setSourceConnectionId] = useState("");
  const [sourceDatabase, setSourceDatabase] = useState("");
  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [targetDatabase, setTargetDatabase] = useState("");

  const [mode, setMode] = useState<DbSyncMode>("row-sync");
  const [confirmText, setConfirmText] = useState("");
  const [backupTarget, setBackupTarget] = useState(false);
  const [running, setRunning] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const runLog = useRunLog();

  const prodGuardEnabled = useProdGuard();
  const [prodConfirmOpen, setProdConfirmOpen] = useState(false);
  const [confirmedProdKey, setConfirmedProdKey] = useState<string | null>(null);

  const { databases: sourceDatabases, loading: loadingSourceDbs } =
    useDatabaseList(sourceConnectionId);
  const { databases: targetDatabasesRaw, loading: loadingTargetDbs } =
    useDatabaseList(targetConnectionId);

  useEffect(() => {
    if (sourceDatabase && sourceDatabases.includes(sourceDatabase)) return;
    setSourceDatabase(sourceDatabases[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceDatabases]);

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

  const isSamePair =
    sourceConnectionId === targetConnectionId && sourceDatabase === targetDatabase;

  const confirmedFullOverride = mode !== "full-override" || confirmText === targetDatabase;
  const confirmedProdTarget = !isTargetProd || confirmedProdKey === targetKey;

  const canRun =
    !running &&
    sourceConnectionId !== "" &&
    sourceDatabase !== "" &&
    targetConnectionId !== "" &&
    targetDatabase !== "" &&
    !isSamePair &&
    confirmedFullOverride &&
    confirmedProdTarget;

  const sourceLabel = useMemo(
    () => connections.find((c) => c.id === sourceConnectionId)?.label,
    [connections, sourceConnectionId],
  );
  const targetLabel = targetConnection?.label;

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
      const result = await globalThis.window.dbSyncApi.run({
        runId,
        source: { connectionId: sourceConnectionId, database: sourceDatabase },
        target: { connectionId: targetConnectionId, database: targetDatabase },
        mode,
        backupTarget,
      });

      if (!result.success) {
        toast.error("Sync failed", { description: result.error });
        return;
      }
      if (result.data.status === "ok") {
        toast.success("Sync complete", {
          description: result.data.backupPath
            ? `Backup saved to ${result.data.backupPath}`
            : undefined,
        });
      } else if (result.data.status === "cancelled") {
        toast.info("Sync cancelled");
      } else {
        toast.error("Sync failed", { description: result.data.message });
      }
    } catch (err) {
      toast.error("Sync failed", { description: (err as Error).message });
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
        <div className="grid grid-cols-2 gap-3">
          <EndpointFields
            label="Source"
            connectionId={sourceConnectionId}
            onConnectionChange={setSourceConnectionId}
            database={sourceDatabase}
            onDatabaseChange={setSourceDatabase}
            databases={sourceDatabases}
            loadingDatabases={loadingSourceDbs}
            connections={connections}
            disabled={running}
          />
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
        </div>

        {isSamePair && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <TriangleAlert className="size-3.5" />
            Source and target must be different databases.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Mode</span>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((option) => (
              <button
                key={option.mode}
                type="button"
                disabled={running}
                onClick={() => setMode(option.mode)}
                className={cn(
                  "flex flex-col gap-1 rounded-md border p-2.5 text-left transition-colors",
                  mode === option.mode
                    ? option.mode === "full-override"
                      ? "border-destructive bg-destructive/10"
                      : "border-primary bg-primary/5"
                    : "border-border hover:bg-accent/40",
                )}
              >
                <span className="text-sm font-medium">{option.title}</span>
                <span className="text-[11px] text-muted-foreground">
                  {option.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2 rounded-md border border-border bg-card p-2.5 text-xs">
          <input
            type="checkbox"
            aria-label="Back up target before running"
            className="mt-0.5 size-3.5"
            checked={backupTarget}
            disabled={running}
            onChange={(e) => setBackupTarget(e.target.checked)}
          />
          <span>
            <span className="font-medium">Back up target before running</span>
            <span className="block text-muted-foreground">
              Dumps the target database to a local file first. Aborts the sync
              if the backup fails.
              {isTargetProd && " Selected by default for production targets."}
            </span>
          </span>
        </label>

        {mode === "full-override" && targetDatabase && (
          <div className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
            <Label htmlFor="db-sync-confirm" className="text-xs text-destructive">
              Type <span className="font-mono">{targetDatabase}</span> to confirm
              you want to permanently replace it{targetLabel ? ` on "${targetLabel}"` : ""}.
            </Label>
            <Input
              id="db-sync-confirm"
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
              {sourceLabel && targetLabel
                ? `${sourceLabel}:${sourceDatabase} → ${targetLabel}:${targetDatabase}`
                : "Log"}
            </span>
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
              variant={mode === "full-override" ? "destructive" : "default"}
              disabled={!canRun}
              onClick={handleRun}
            >
              <Play className="size-3.5" />
              Run sync
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
