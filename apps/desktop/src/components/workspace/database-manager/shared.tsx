import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLatestRequest } from "@/hooks/use-latest-request";
import { cn } from "@/lib/utils";
import type { BackupFileInfo, BackupLogLevel } from "@/shared/types/backup";

export function endpointKey(connectionId: string, database: string): string {
  return `${connectionId}::${database}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex++;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatRelativeTime(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** Fetches the database list for a connection whenever it changes. */
export function useDatabaseList(connectionId: string): {
  databases: string[];
  loading: boolean;
} {
  const [databases, setDatabases] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setDatabases([]);
    if (!connectionId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    globalThis.window.backupApi
      .listDatabases({ connectionId })
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setDatabases(result.data);
          return;
        }
        toast.error("Failed to list databases", { description: result.error });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error("Failed to list databases", {
          description: (error as Error).message,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  return { databases, loading };
}

/** Loads the local backup list; `refresh` ignores superseded responses. */
export function useBackupList(): {
  backups: BackupFileInfo[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const runLatestRequest = useLatestRequest();
  const [backups, setBackups] = useState<BackupFileInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const request = await runLatestRequest(() =>
      globalThis.window.backupApi.listBackups(),
    );
    if (request.status === "stale") return;
    setLoading(false);
    if (request.status === "error") {
      toast.error("Failed to list backups", {
        description: (request.error as Error).message,
      });
      return;
    }
    const result = request.value;
    if (!result.success) {
      toast.error("Failed to list backups", { description: result.error });
      return;
    }
    setBackups(result.data);
  }, [runLatestRequest]);

  return { backups, loading, refresh };
}

interface LogLine {
  line: string;
  level: BackupLogLevel;
}

/** Accumulates progress lines for one run and auto-scrolls to the newest. */
export function useRunLog(): {
  log: LogLine[];
  endRef: React.RefObject<HTMLDivElement | null>;
  reset: () => void;
  append: (line: string, level: BackupLogLevel) => void;
} {
  const [log, setLog] = useState<LogLine[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [log]);

  const reset = useCallback(() => setLog([]), []);
  const append = useCallback((line: string, level: BackupLogLevel) => {
    setLog((prev) => [...prev, { line, level }]);
  }, []);

  return { log, endRef, reset, append };
}

export function RunLog({
  log,
  running,
  endRef,
}: Readonly<{
  log: LogLine[];
  running: boolean;
  endRef: React.RefObject<HTMLDivElement | null>;
}>) {
  return (
    <ScrollArea className="h-40 rounded-md border border-border bg-muted/30">
      <div
        role="log"
        aria-live="polite"
        aria-label="Run log"
        className="flex flex-col gap-0.5 p-2 font-mono text-[11px]"
      >
        {log.map((entry, index) => (
          <div
            key={index}
            className={cn(
              entry.level === "info" && "text-muted-foreground",
              entry.level === "warn" && "font-medium text-foreground",
              entry.level === "error" && "text-destructive",
            )}
          >
            {entry.line}
          </div>
        ))}
        {running && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Running…
          </div>
        )}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}

interface EndpointFieldsProps {
  label: string;
  idPrefix: string;
  connectionId: string;
  onConnectionChange: (id: string) => void;
  database: string;
  onDatabaseChange: (name: string) => void;
  databases: string[];
  loadingDatabases: boolean;
  connections: Array<{ id: string; label: string }>;
  disabled: boolean;
}

export function EndpointFields({
  label,
  idPrefix,
  connectionId,
  onConnectionChange,
  database,
  onDatabaseChange,
  databases,
  loadingDatabases,
  connections,
  disabled,
}: Readonly<EndpointFieldsProps>) {
  return (
    <div
      role="group"
      aria-labelledby={`${idPrefix}-label`}
      className="flex flex-col gap-1.5"
    >
      <span
        id={`${idPrefix}-label`}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </span>
      <select
        aria-label={`${label} connection`}
        value={connectionId}
        onChange={(e) => onConnectionChange(e.target.value)}
        disabled={disabled}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">Select connection…</option>
        {connections.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.label}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} database`}
        value={database}
        onChange={(e) => onDatabaseChange(e.target.value)}
        disabled={disabled || !connectionId || loadingDatabases}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {loadingDatabases ? (
          <option value="">Loading…</option>
        ) : (
          <>
            <option value="">
              {databases.length === 0 ? "No databases" : "Select database…"}
            </option>
            {databases.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </>
        )}
      </select>
    </div>
  );
}

export function ProdConfirmDialog({
  open,
  database,
  connectionLabel,
  onConfirm,
  onCancel,
}: Readonly<{
  open: boolean;
  database: string;
  connectionLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const onConnection = connectionLabel ? ` on "${connectionLabel}"` : "";
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="size-4" />
            Production database selected
          </DialogTitle>
          <DialogDescription>
            &quot;{database}&quot;{onConnection} looks like a production
            database (by connection name, host, or database name). Are you sure
            you want to restore over it?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            Yes, use it as target
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
