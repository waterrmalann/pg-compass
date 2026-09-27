import { useCallback, useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { useLatestRequest } from "@/hooks/use-latest-request";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSettings } from "@/hooks/use-settings";
import type { TriggerInfo } from "@/shared/types/table-data";

interface TriggersTabProps {
  connectionId: string;
  schema: string;
  table: string;
  refreshSignal?: number;
  onRefreshComplete?: (success: boolean) => void;
}

function enabledLabel(trigger: TriggerInfo): string {
  if (!trigger.enabled) {
    return "Disabled";
  }

  if (trigger.enabledMode === "ORIGIN") {
    return "Enabled";
  }

  return trigger.enabledMode;
}

export function TriggersTab({
  connectionId,
  schema,
  table,
  refreshSignal = 0,
  onRefreshComplete,
}: Readonly<TriggersTabProps>) {
  const { settings } = useSettings();
  const runLatestRequest = useLatestRequest();
  const runLatestToggle = useLatestRequest();
  const [triggers, setTriggers] = useState<TriggerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingTrigger, setPendingTrigger] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    const request = await runLatestRequest(() =>
      globalThis.window.tableDataApi.getTriggers({
        connectionId,
        schema,
        table,
      }),
    );
    if (request.status === "stale") return false;
    if (request.status === "error") {
      toast.error("Failed to load triggers", {
        description: (request.error as Error).message,
      });
      setLoading(false);
      return false;
    }
    const result = request.value;
    if (!result.success || !result.data) {
      toast.error("Failed to load triggers", { description: result.error });
      setLoading(false);
      return false;
    }
    setTriggers(result.data);
    setLoading(false);
    return true;
  }, [connectionId, runLatestRequest, schema, table]);

  useEffect(
    function loadTriggers() {
      void fetch().then((success) => {
        if (refreshSignal > 0) onRefreshComplete?.(success);
      });
    },
    [fetch, onRefreshComplete, refreshSignal],
  );

  async function handleToggle(trigger: TriggerInfo, enabled: boolean) {
    setPendingTrigger(trigger.name);
    const request = await runLatestToggle(() =>
      globalThis.window.tableDataApi.toggleTrigger({
        connectionId,
        schema,
        table,
        trigger: trigger.name,
        enabled,
      }),
    );
    if (request.status === "stale") return;
    setPendingTrigger(null);
    if (request.status === "error") {
      toast.error("Failed to update trigger", {
        description: (request.error as Error).message,
      });
      return;
    }
    const result = request.value;
    if (!result.success || !result.data) {
      toast.error("Failed to update trigger", { description: result.error });
      return;
    }
    setTriggers(result.data);
    toast.success(enabled ? "Trigger enabled" : "Trigger disabled");
  }

  if (loading && triggers.length === 0) {
    return <LoadingState />;
  }

  if (triggers.length === 0) {
    return (
      <Panel className="h-full">
        <EmptyState icon={<Zap />} title="No triggers found on this table." />
      </Panel>
    );
  }

  return (
    <Panel className="max-h-full">
      <div className="min-h-0 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>Timing</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Function</TableHead>
              <TableHead>Definition</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {triggers.map((trigger) => (
              <TableRow key={trigger.name}>
                <TableCell className="font-mono text-[12.5px] font-medium">
                  {trigger.name}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={trigger.enabled}
                      disabled={
                        settings.general.readOnlyMode ||
                        pendingTrigger === trigger.name
                      }
                      aria-label={`${trigger.enabled ? "Disable" : "Enable"} trigger ${trigger.name}`}
                      onCheckedChange={(checked) => {
                        handleToggle(trigger, checked).catch(() => undefined);
                      }}
                    />
                    <span className="text-xs text-muted-foreground">
                      {pendingTrigger === trigger.name
                        ? "Updating"
                        : enabledLabel(trigger)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className="font-mono">{trigger.timing}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {trigger.events.map((event) => (
                      <Badge
                        key={event}
                        variant="outline"
                        className="font-mono"
                      >
                        {event}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {trigger.functionName}
                </TableCell>
                <TableCell className="max-w-100 truncate font-mono text-xs text-muted-foreground">
                  <span title={trigger.definition}>{trigger.definition}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
