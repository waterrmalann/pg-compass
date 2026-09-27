import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  ScrollText,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelCount,
  PanelHeader,
  PanelTitle,
} from "@/components/ui/panel";
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
      <EmptyState
        icon={<ScrollText />}
        title="No audit entries yet"
        description="Role and permission changes made from PG Compass are recorded here."
      />
    );
  } else {
    content = (
      <Table>
        <TableHeader>
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
              <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                {new Date(entry.timestamp).toLocaleString()}
              </TableCell>
              <TableCell className="font-mono text-[12.5px]">
                {entry.actor}
              </TableCell>
              <TableCell>
                <Badge className="font-mono">{entry.action}</Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">
                {entry.target}
              </TableCell>
              <TableCell>
                <AuditResult entry={entry} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Panel className="min-h-0 flex-1">
        <PanelHeader>
          <ScrollText />
          <PanelTitle>Audit log</PanelTitle>
          <PanelCount>{entries.length}</PanelCount>
          <span className="ml-auto hidden truncate text-xs text-muted-foreground md:inline">
            Stored on this machine, up to 5,000 entries
          </span>
          {isAdmin && (
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto md:ml-0"
              disabled={busy || entries.length === 0}
              onClick={() => setClearOpen(true)}
            >
              <Trash2 />
              Clear log
            </Button>
          )}
        </PanelHeader>
        <ScrollArea className="min-h-0 flex-1">{content}</ScrollArea>
      </Panel>

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
              {busy && <Loader2 className="animate-spin" />}
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
    <span className="flex flex-col items-start gap-1">
      <Badge variant="destructive">
        <XCircle />
        Failed
      </Badge>
      {entry.error && (
        <span className="max-w-xs text-xs whitespace-normal text-muted-foreground">
          {entry.error}
        </span>
      )}
    </span>
  );
}
