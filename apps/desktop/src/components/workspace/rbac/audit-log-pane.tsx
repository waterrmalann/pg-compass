import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLatestRequest } from "@/hooks/use-latest-request";
import type { AuditLogEntry } from "@/shared/types/roles";
import { ErrorState, LoadingState, unwrap } from "./shared";

interface AuditLogPaneProps {
  connectionId: string;
  /** Whether the active connection is a superuser connection. */
  isAdmin: boolean;
}

export function AuditLogPane({
  connectionId,
  isAdmin,
}: Readonly<AuditLogPaneProps>) {
  const runLatestRequest = useLatestRequest();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const request = await runLatestRequest(async () =>
      unwrap(await globalThis.window.rolesApi.getAuditLog(connectionId)),
    );
    if (request.status === "stale") return;
    setLoading(false);
    if (request.status === "error") {
      setError((request.error as Error).message);
      return;
    }
    setEntries(request.value);
  }, [connectionId, runLatestRequest]);

  useEffect(() => {
    setEntries([]);
    void refresh();
  }, [refresh]);

  async function handleClear(): Promise<void> {
    setBusy(true);
    try {
      const result =
        await globalThis.window.rolesApi.clearAuditLog(connectionId);
      if (!result.success) {
        toast.error("Clear audit log failed", { description: result.error });
        return;
      }
      toast.success("Audit log cleared");
      setClearOpen(false);
      await refresh();
    } catch (err) {
      toast.error("Clear audit log failed", {
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...entries].sort((a, b) =>
    a.timestamp < b.timestamp ? 1 : -1,
  );

  let content: React.ReactNode;
  if (loading && sorted.length === 0) {
    content = <LoadingState label="Loading audit log…" />;
  } else if (error) {
    content = (
      <ErrorState
        message={error}
        onRetry={() => {
          void refresh();
        }}
      />
    );
  } else if (sorted.length === 0) {
    content = (
      <p className="text-sm text-muted-foreground">No audit entries yet.</p>
    );
  } else {
    content = (
      <ScrollArea className="min-h-0 flex-1">
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader className="bg-card">
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium">{entry.actor}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {entry.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{entry.target}</TableCell>
                  <TableCell>
                    <AuditResult entry={entry} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ScrollArea>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Administrative actions recorded for this connection. The log is stored
          locally and capped at 5,000 entries.
        </p>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || entries.length === 0}
            onClick={() => setClearOpen(true)}
          >
            <Trash2 className="size-3.5" />
            Clear log
          </Button>
        )}
      </div>
      {content}

      <Dialog
        open={clearOpen}
        onOpenChange={(open) => !busy && setClearOpen(open)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clear audit log?</DialogTitle>
            <DialogDescription>
              This removes all locally stored audit entries for the active
              connection. The action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setClearOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                void handleClear();
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Clear log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuditResult({ entry }: Readonly<{ entry: AuditLogEntry }>) {
  if (entry.success) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5" />
        OK
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-0.5 text-xs text-destructive">
      <span className="flex items-center gap-1">
        <XCircle className="size-3.5" />
        Failed
      </span>
      {entry.error && (
        <span className="max-w-xs whitespace-normal text-muted-foreground">
          {entry.error}
        </span>
      )}
    </span>
  );
}
