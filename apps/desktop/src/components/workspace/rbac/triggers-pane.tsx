import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PgTriggerInfo, SetTriggerEnabledInput } from "@/shared/types/roles";
import { ErrorState, Field, LoadingState, unwrap } from "./shared";

interface TriggersPaneProps {
  connectionId: string;
  databaseNames: string[];
}

export function TriggersPane({
  connectionId,
  databaseNames,
}: Readonly<TriggersPaneProps>) {
  const [database, setDatabase] = useState<string>(
    databaseNames[0] ?? "",
  );
  useEffect(() => {
    if (databaseNames.length === 0) return;
    if (!databaseNames.includes(database)) {
      setDatabase(databaseNames[0] ?? "");
    }
  }, [databaseNames, database]);

  const [triggers, setTriggers] = useState<PgTriggerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!database) return;
    setLoading(true);
    setError(null);
    try {
      const result = await globalThis.window.rolesApi.listTriggers(
        connectionId,
        database,
      );
      setTriggers(unwrap(result));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [connectionId, database]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function setTriggerEnabled(
    trigger: PgTriggerInfo,
    enabled: boolean,
  ): Promise<boolean> {
    const input: SetTriggerEnabledInput = {
      connectionId,
      databaseName: database,
      schemaName: trigger.schemaName,
      tableName: trigger.tableName,
      triggerName: trigger.triggerName,
      enabled,
    };
    const result = await globalThis.window.rolesApi.setTriggerEnabled(input);
    if (!result.success) {
      toast.error(`Failed to ${enabled ? "enable" : "disable"} trigger`, {
        description: result.error,
      });
    }
    return result.success;
  }

  async function handleToggleTrigger(
    trigger: PgTriggerInfo,
    enabled: boolean,
  ): Promise<void> {
    setBusy(true);
    const ok = await setTriggerEnabled(trigger, enabled);
    setBusy(false);
    if (ok) {
      toast.success(
        `${enabled ? "Enabled" : "Disabled"} trigger "${trigger.triggerName}"`,
      );
      await refresh();
    }
  }

  async function handleToggleAll(enabled: boolean): Promise<void> {
    setBusy(true);
    const results = await Promise.all(
      triggers.map((trigger) => setTriggerEnabled(trigger, enabled)),
    );
    setBusy(false);
    if (results.every(Boolean)) {
      toast.success(`${enabled ? "Enabled" : "Disabled"} all triggers`);
    }
    await refresh();
  }

  const allEnabled = triggers.length > 0 && triggers.every((t) => t.enabled);

  if (databaseNames.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No connectable databases on this server.
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Database" htmlFor="triggers-db">
          <select
            id="triggers-db"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {databaseNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-1 items-center justify-end gap-2">
          <Switch
            checked={allEnabled}
            disabled={busy || loading || triggers.length === 0}
            onCheckedChange={(checked) => void handleToggleAll(checked)}
            aria-label="Toggle all triggers"
          />
        </div>
      </div>
      <Separator />
      {loading && triggers.length === 0 ? (
        <LoadingState label="Loading triggers…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void refresh()} />
      ) : triggers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No triggers in {database}.
        </p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader className="bg-card">
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
                  <TableRow key={`${trigger.schemaName}.${trigger.tableName}.${trigger.triggerName}`}>
                    <TableCell className="font-mono text-xs">
                      {trigger.schemaName}.{trigger.tableName}
                    </TableCell>
                    <TableCell className="font-medium">
                      {trigger.triggerName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="uppercase">
                        {trigger.timing}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {trigger.events}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {trigger.functionSchema}.{trigger.functionName}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={trigger.enabled}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            void handleToggleTrigger(trigger, checked)
                          }
                          aria-label={`Toggle trigger ${trigger.triggerName}`}
                        />
                        {(trigger.enabledMode === "replica" ||
                          trigger.enabledMode === "always") && (
                          <Badge variant="outline" className="uppercase">
                            {trigger.enabledMode}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
