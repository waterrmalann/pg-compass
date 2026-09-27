import { useCallback, useEffect, useState } from "react";
import { Zap } from "lucide-react";
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
import { fieldClassName } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Panel,
  PanelCount,
  PanelHeader,
  PanelTitle,
} from "@/components/ui/panel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLatestRequest } from "@/hooks/use-latest-request";
import { useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";
import type { PgTriggerInfo } from "@/shared/types/roles";
import { ErrorState, LoadingState, ReadOnlyNotice, unwrap } from "./shared";

interface TriggersPaneProps {
  connectionId: string;
  databaseNames: string[];
}

interface ToggleResult {
  ok: boolean;
  error?: string;
}

function triggerKey(trigger: PgTriggerInfo): string {
  return `${trigger.schemaName}.${trigger.tableName}.${trigger.triggerName}`;
}

export function TriggersPane({
  connectionId,
  databaseNames,
}: Readonly<TriggersPaneProps>) {
  const { settings } = useSettings();
  const readOnlyMode = settings.general.readOnlyMode;
  const runLatestRequest = useLatestRequest();
  const [database, setDatabase] = useState<string>(databaseNames[0] ?? "");
  const [triggers, setTriggers] = useState<PgTriggerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadSignal, setReloadSignal] = useState(0);
  const [toggleAllTarget, setToggleAllTarget] = useState<boolean | null>(null);

  useEffect(() => {
    if (databaseNames.length === 0) return;
    if (databaseNames.includes(database)) return;
    setDatabase(databaseNames[0] ?? "");
  }, [databaseNames, database]);

  const load = useCallback(async () => {
    if (!database) return;
    setLoading(true);
    setError(null);
    const request = await runLatestRequest(async () =>
      unwrap(
        await globalThis.window.rolesApi.listTriggers(connectionId, database),
      ),
    );
    if (request.status === "stale") return;
    setLoading(false);
    if (request.status === "error") {
      setError((request.error as Error).message);
      return;
    }
    setTriggers(request.value);
  }, [connectionId, database, runLatestRequest]);

  // Drop the previous database's triggers as soon as the key changes so they
  // can't be shown (or toggled) under the newly selected database.
  useEffect(() => {
    setTriggers([]);
    setError(null);
  }, [connectionId, database]);

  // `reloadSignal` re-runs the loader for whichever database is current,
  // even when a toggle started before the selection changed.
  useEffect(() => {
    void load();
  }, [load, reloadSignal]);

  function reload() {
    setReloadSignal((signal) => signal + 1);
  }

  async function setTriggerEnabled(
    trigger: PgTriggerInfo,
    enabled: boolean,
  ): Promise<ToggleResult> {
    try {
      const result = await globalThis.window.rolesApi.setTriggerEnabled({
        connectionId,
        databaseName: database,
        schemaName: trigger.schemaName,
        tableName: trigger.tableName,
        triggerName: trigger.triggerName,
        enabled,
      });
      if (result.success) return { ok: true };
      return { ok: false, error: result.error };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async function handleToggleTrigger(trigger: PgTriggerInfo, enabled: boolean) {
    setBusy(true);
    const result = await setTriggerEnabled(trigger, enabled);
    setBusy(false);
    if (!result.ok) {
      toast.error(`Failed to ${enabled ? "enable" : "disable"} trigger`, {
        description: result.error,
      });
      return;
    }
    toast.success(
      `${enabled ? "Enabled" : "Disabled"} trigger "${trigger.triggerName}"`,
    );
    reload();
  }

  async function handleToggleAll(enabled: boolean) {
    setToggleAllTarget(null);
    setBusy(true);
    const results = await Promise.all(
      triggers.map((trigger) => setTriggerEnabled(trigger, enabled)),
    );
    setBusy(false);
    reload();

    const verb = enabled ? "enable" : "disable";
    const failures = results.filter((result) => !result.ok);
    if (failures.length === 0) {
      toast.success(
        `${enabled ? "Enabled" : "Disabled"} ${results.length} trigger${results.length === 1 ? "" : "s"} in ${database}`,
      );
      return;
    }
    toast.error(
      `Failed to ${verb} ${failures.length} of ${results.length} triggers in ${database}`,
      { description: failures[0]?.error },
    );
  }

  const allEnabled = triggers.length > 0 && triggers.every((t) => t.enabled);
  const controlsDisabled = busy || readOnlyMode;

  if (databaseNames.length === 0) {
    return (
      <EmptyState
        icon={<Zap />}
        title="No databases"
        description="No databases on this server accept connections."
      />
    );
  }

  let content: React.ReactNode;
  if (loading && triggers.length === 0) {
    content = <LoadingState label="Loading triggers…" />;
  } else if (error) {
    content = <ErrorState message={error} onRetry={reload} />;
  } else if (triggers.length === 0) {
    content = (
      <EmptyState
        icon={<Zap />}
        title="No triggers"
        description={`There are no triggers in ${database}.`}
      />
    );
  } else {
    content = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Table</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Timing</TableHead>
            <TableHead>Events</TableHead>
            <TableHead>Function</TableHead>
            <TableHead>Enabled</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {triggers.map((trigger) => (
            <TableRow key={triggerKey(trigger)}>
              <TableCell className="font-mono text-[12.5px]">
                <span className="text-muted-foreground">
                  {trigger.schemaName}.
                </span>
                {trigger.tableName}
              </TableCell>
              <TableCell className="font-mono text-[12.5px] font-medium">
                {trigger.triggerName}
              </TableCell>
              <TableCell>
                <Badge className="font-mono">{trigger.timing}</Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {trigger.events}
              </TableCell>
              <TableCell className="font-mono text-[12.5px]">
                <span className="text-muted-foreground">
                  {trigger.functionSchema}.
                </span>
                {trigger.functionName}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={trigger.enabled}
                    disabled={controlsDisabled}
                    onCheckedChange={(checked) => {
                      handleToggleTrigger(trigger, checked).catch(
                        () => undefined,
                      );
                    }}
                    aria-label={`Toggle trigger ${trigger.triggerName}`}
                  />
                  {(trigger.enabledMode === "replica" ||
                    trigger.enabledMode === "always") && (
                    <Badge>{trigger.enabledMode}</Badge>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {readOnlyMode && <ReadOnlyNotice action="toggle triggers" />}
      <Panel className="min-h-0 flex-1">
        <PanelHeader className="flex-wrap">
          <Zap />
          <PanelTitle>Triggers</PanelTitle>
          <PanelCount>{triggers.length}</PanelCount>
          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label
                htmlFor="triggers-db"
                className="text-xs font-normal text-muted-foreground"
              >
                Database
              </Label>
              <select
                id="triggers-db"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                className={cn(
                  fieldClassName,
                  "h-7 w-auto px-1.5 font-mono text-xs",
                )}
              >
                {databaseNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <Label className="gap-2 text-xs font-normal text-muted-foreground">
              <Switch
                checked={allEnabled}
                disabled={controlsDisabled || loading || triggers.length === 0}
                onCheckedChange={(checked) => setToggleAllTarget(checked)}
              />
              All triggers enabled
            </Label>
          </div>
        </PanelHeader>
        <ScrollArea className="min-h-0 flex-1">{content}</ScrollArea>
      </Panel>

      <Dialog
        open={toggleAllTarget !== null}
        onOpenChange={(open) => {
          if (!open) setToggleAllTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {toggleAllTarget ? "Enable" : "Disable"} all triggers?
            </DialogTitle>
            <DialogDescription>
              This will {toggleAllTarget ? "enable" : "disable"}{" "}
              {triggers.length} trigger{triggers.length === 1 ? "" : "s"} in{" "}
              <span className="font-mono">{database}</span>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToggleAllTarget(null)}>
              Cancel
            </Button>
            <Button
              variant={toggleAllTarget ? "default" : "destructive"}
              onClick={() => {
                if (toggleAllTarget === null) return;
                handleToggleAll(toggleAllTarget).catch(() => undefined);
              }}
            >
              {toggleAllTarget ? "Enable" : "Disable"} {triggers.length} trigger
              {triggers.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
