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
import { cn } from "@/lib/utils";
import type { DbSyncProgressEvent } from "@/shared/types/db-sync";

export { looksLikeProduction } from "@/shared/production-guard";

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

/** Whether the "show production databases" guard is currently open, refreshed on mount. */
export function useProdGuard(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    globalThis.window.dbSyncApi.getProdGuard().then((result) => {
      if (result.success) setEnabled(result.data.enabled);
    });
  }, []);
  return enabled;
}

/** Fetches the database list for a connection whenever it changes. */
export function useDatabaseList(connectionId: string): {
  databases: string[];
  loading: boolean;
} {
  const [databases, setDatabases] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connectionId) {
      setDatabases([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    globalThis.window.dbSyncApi
      .listDatabases({ connectionId })
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setDatabases(result.data);
        } else {
          toast.error("Failed to list databases", { description: result.error });
        }
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

interface LogLine {
  line: string;
  level: DbSyncProgressEvent["level"];
}

/** Accumulates progress lines for one run and auto-scrolls to the newest. */
export function useRunLog(): {
  log: LogLine[];
  endRef: React.RefObject<HTMLDivElement | null>;
  reset: () => void;
  append: (line: string, level: DbSyncProgressEvent["level"]) => void;
} {
  const [log, setLog] = useState<LogLine[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [log]);

  const reset = useCallback(() => setLog([]), []);
  const append = useCallback(
    (line: string, level: DbSyncProgressEvent["level"]) => {
      setLog((prev) => [...prev, { line, level }]);
    },
    [],
  );

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
      <div className="flex flex-col gap-0.5 p-2 font-mono text-[11px]">
        {log.map((entry, index) => (
          <div
            key={index}
            className={cn(
              entry.level === "error" && "text-destructive",
              entry.level === "warn" && "text-amber-600 dark:text-amber-400",
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
  connectionId: string;
  onConnectionChange: (id: string) => void;
  database: string;
  onDatabaseChange: (name: string) => void;
  databases: string[];
  loadingDatabases: boolean;
  connections: Array<{ id: string; label: string }>;
  disabled: boolean;
  hint?: string;
}

export function EndpointFields({
  label,
  connectionId,
  onConnectionChange,
  database,
  onDatabaseChange,
  databases,
  loadingDatabases,
  connections,
  disabled,
  hint,
}: Readonly<EndpointFieldsProps>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
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
        value={database}
        onChange={(e) => onDatabaseChange(e.target.value)}
        disabled={disabled || !connectionId || loadingDatabases}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {loadingDatabases ? (
          <option value="">Loading…</option>
        ) : (
          <>
            {databases.length === 0 && <option value="">No databases</option>}
            {databases.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </>
        )}
      </select>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
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
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="size-4" />
            Production database selected
          </DialogTitle>
          <DialogDescription>
            &quot;{database}&quot;{connectionLabel ? ` on "${connectionLabel}"` : ""}{" "}
            looks like a production database (by hostname or name). Are you sure
            you want to use it as the target?
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
