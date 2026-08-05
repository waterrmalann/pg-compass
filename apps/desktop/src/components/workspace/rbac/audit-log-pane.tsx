import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AuditLogEntry } from "@/shared/types/roles";
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
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await globalThis.window.rolesApi.getAuditLog(connectionId);
      setEntries(unwrap(result));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleClear(): Promise<void> {
    setBusy(true);
    const result = await globalThis.window.rolesApi.clearAuditLog(connectionId);
    setBusy(false);
    if (result.success) {
      toast.success("Audit log cleared");
      setClearOpen(false);
      await refresh();
    } else {
      toast.error("Clear audit log failed", { description: result.error });
    }
  }

  const sorted = [...entries].sort((a, b) =>
    a.timestamp < b.timestamp ? 1 : -1,
  );

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
      {loading && sorted.length === 0 ? (
        <LoadingState label="Loading audit log…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void refresh()} />
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No audit entries yet.</p>
      ) : (
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
                      <Badge variant="outline" className="font-mono uppercase">
                        {entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{entry.target}</TableCell>
                    <TableCell>
                      {entry.success ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="size-3.5" />
                          OK
                        </span>
                      ) : (
                        <span
                          className="flex items-center gap-1 text-xs text-destructive"
                          title={entry.error ?? undefined}
                        >
                          <XCircle className="size-3.5" />
                          Failed
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>
      )}

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
              onClick={() => void handleClear()}
            >
              Clear log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}