import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Loader2, Trash2, Zap } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  CreateTriggerFunctionInput,
  CreateTriggerInput,
  DropTriggerInput,
  PgTriggerFunction,
  PgTriggerInfo,
} from "@/shared/types/roles";
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
  const [functions, setFunctions] = useState<PgTriggerFunction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createFnOpen, setCreateFnOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!database) return;
    setLoading(true);
    setError(null);
    try {
      const [t, f] = await Promise.all([
        globalThis.window.rolesApi.listTriggers(connectionId, database),
        globalThis.window.rolesApi.listTriggerFunctions(connectionId, database),
      ]);
      setTriggers(unwrap(t));
      setFunctions(unwrap(f));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [connectionId, database]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleDrop(trigger: PgTriggerInfo): Promise<void> {
    const input: DropTriggerInput = {
      connectionId,
      databaseName: database,
      schemaName: trigger.schemaName,
      tableName: trigger.tableName,
      triggerName: trigger.triggerName,
    };
    setBusy(true);
    const result = await globalThis.window.rolesApi.dropTrigger(input);
    setBusy(false);
    if (result.success) {
      toast.success(`Dropped trigger "${trigger.triggerName}"`);
      await refresh();
    } else {
      toast.error("Drop trigger failed", { description: result.error });
    }
  }

  async function handleCreateTrigger(
    input: CreateTriggerInput,
  ): Promise<boolean> {
    setBusy(true);
    const result = await globalThis.window.rolesApi.createTrigger(input);
    setBusy(false);
    if (result.success) {
      toast.success(`Created trigger "${input.triggerName}"`);
      await refresh();
      setCreateOpen(false);
      return true;
    }
    toast.error("Create trigger failed", { description: result.error });
    return false;
  }

  async function handleCreateFunction(
    input: CreateTriggerFunctionInput,
  ): Promise<boolean> {
    setBusy(true);
    const result =
      await globalThis.window.rolesApi.createTriggerFunction(input);
    setBusy(false);
    if (result.success) {
      toast.success(`Created function "${input.functionName}"`);
      await refresh();
      setCreateFnOpen(false);
      return true;
    }
    toast.error("Create function failed", { description: result.error });
    return false;
  }

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateFnOpen(true)}
            disabled={busy || loading}
          >
            New trigger function
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={busy || loading || functions.length === 0}
            title={
              functions.length === 0
                ? "Create a trigger function first"
                : "Create trigger"
            }
          >
            <Zap className="size-3.5" />
            New trigger
          </Button>
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
                  <TableHead className="text-right" />
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
                      <Badge
                        variant={trigger.enabled ? "secondary" : "outline"}
                        className="uppercase"
                      >
                        {trigger.enabled ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Drop trigger ${trigger.triggerName}`}
                        disabled={busy}
                        onClick={() => void handleDrop(trigger)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>
      )}

      <CreateTriggerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        connectionId={connectionId}
        databaseName={database}
        functions={functions}
        busy={busy}
        onSubmit={handleCreateTrigger}
      />
      <CreateTriggerFunctionDialog
        open={createFnOpen}
        onOpenChange={setCreateFnOpen}
        connectionId={connectionId}
        databaseName={database}
        busy={busy}
        onSubmit={handleCreateFunction}
      />
    </div>
  );
}

function CreateTriggerDialog({
  open,
  onOpenChange,
  connectionId,
  databaseName,
  functions,
  busy,
  onSubmit,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  databaseName: string;
  functions: PgTriggerFunction[];
  busy: boolean;
  onSubmit: (input: CreateTriggerInput) => Promise<boolean>;
}>) {
  const [schemaName, setSchemaName] = useState("public");
  const [tableName, setTableName] = useState("");
  const [triggerName, setTriggerName] = useState("");
  const [timing, setTiming] = useState<"BEFORE" | "AFTER" | "INSTEAD OF">(
    "BEFORE",
  );
  const [events, setEvents] = useState<
    Array<"INSERT" | "UPDATE" | "DELETE" | "TRUNCATE">
  >(["INSERT"]);
  const [orientation, setOrientation] = useState<"ROW" | "STATEMENT">("ROW");
  const [functionKey, setFunctionKey] = useState("");

  useEffect(() => {
    if (open && functions.length > 0) {
      const first = functions[0];
      if (first) {
        setFunctionKey(`${first.schemaName}.${first.functionName}`);
      }
    }
  }, [open, functions]);

  const selectedFunction = useMemo(
    () => functions.find((f) => `${f.schemaName}.${f.functionName}` === functionKey),
    [functions, functionKey],
  );

  const valid =
    schemaName.trim() !== "" &&
    tableName.trim() !== "" &&
    triggerName.trim() !== "" &&
    events.length > 0 &&
    Boolean(selectedFunction);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !selectedFunction) return;
    const input: CreateTriggerInput = {
      connectionId,
      databaseName,
      schemaName: schemaName.trim(),
      tableName: tableName.trim(),
      triggerName: triggerName.trim(),
      timing,
      events,
      orientation,
      functionSchema: selectedFunction.schemaName,
      functionName: selectedFunction.functionName,
    };
    if (await onSubmit(input)) {
      setTriggerName("");
      setTableName("");
    }
  }

  function toggleEvent(event: "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE") {
    setEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create trigger</DialogTitle>
          <DialogDescription>
            Define a trigger on a table in <strong>{databaseName}</strong> using
            an existing trigger function.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Schema" htmlFor="trigger-schema">
              <Input
                id="trigger-schema"
                value={schemaName}
                onChange={(e) => setSchemaName(e.target.value)}
                placeholder="public"
              />
            </Field>
            <Field label="Table" htmlFor="trigger-table">
              <Input
                id="trigger-table"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="e.g. invoices"
              />
            </Field>
          </div>
          <Field label="Trigger name" htmlFor="trigger-name">
            <Input
              id="trigger-name"
              value={triggerName}
              onChange={(e) => setTriggerName(e.target.value)}
              placeholder="e.g. trg_invoices_audit"
              autoComplete="off"
            />
          </Field>
          <Field label="Function" htmlFor="trigger-function">
            <select
              id="trigger-function"
              value={functionKey}
              onChange={(e) => setFunctionKey(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {functions.map((fn) => (
                <option
                  key={`${fn.schemaName}.${fn.functionName}`}
                  value={`${fn.schemaName}.${fn.functionName}`}
                >
                  {fn.schemaName}.{fn.functionName}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Timing" htmlFor="trigger-timing">
              <select
                id="trigger-timing"
                value={timing}
                onChange={(e) =>
                  setTiming(e.target.value as typeof timing)
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="BEFORE">BEFORE</option>
                <option value="AFTER">AFTER</option>
                <option value="INSTEAD OF">INSTEAD OF</option>
              </select>
            </Field>
            <Field label="Orientation" htmlFor="trigger-orientation">
              <select
                id="trigger-orientation"
                value={orientation}
                onChange={(e) =>
                  setOrientation(e.target.value as typeof orientation)
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="ROW">ROW</option>
                <option value="STATEMENT">STATEMENT</option>
              </select>
            </Field>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Events</Label>
            <div className="flex flex-wrap gap-4">
              {(["INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const).map(
                (event) => (
                  <Label key={event} className="gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={events.includes(event)}
                      onChange={() => toggleEvent(event)}
                      className="size-3.5"
                    />
                    {event}
                  </Label>
                ),
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !valid}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Create trigger
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateTriggerFunctionDialog({
  open,
  onOpenChange,
  connectionId,
  databaseName,
  busy,
  onSubmit,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  databaseName: string;
  busy: boolean;
  onSubmit: (input: CreateTriggerFunctionInput) => Promise<boolean>;
}>) {
  const [schemaName, setSchemaName] = useState("public");
  const [functionName, setFunctionName] = useState("");
  const [source, setSource] = useState(
    `CREATE OR REPLACE FUNCTION public.() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  RETURN NEW;\nEND;\n$$;`,
  );

  useEffect(() => {
    if (open) {
      setSchemaName("public");
      setFunctionName("");
      setSource(
        `CREATE OR REPLACE FUNCTION public.() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  RETURN NEW;\nEND;\n$$;`,
      );
    }
  }, [open]);

  const valid =
    schemaName.trim() !== "" && functionName.trim() !== "" && source.trim() !== "";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    const input: CreateTriggerFunctionInput = {
      connectionId,
      databaseName,
      schemaName: schemaName.trim(),
      functionName: functionName.trim(),
      source,
    };
    if (await onSubmit(input)) {
      setFunctionName("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create trigger function</DialogTitle>
          <DialogDescription>
            The source is executed verbatim against <strong>{databaseName}</strong>.
            Prefix the function name with its schema in the source body.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Schema" htmlFor="fn-schema">
              <Input
                id="fn-schema"
                value={schemaName}
                onChange={(e) => setSchemaName(e.target.value)}
                placeholder="public"
              />
            </Field>
            <Field label="Function name" htmlFor="fn-name">
              <Input
                id="fn-name"
                value={functionName}
                onChange={(e) => setFunctionName(e.target.value)}
                placeholder="e.g. audit_log"
                autoComplete="off"
              />
            </Field>
          </div>
          <Field label="Source (PL/pgSQL)" htmlFor="fn-source">
            <textarea
              id="fn-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              spellCheck={false}
              className="h-48 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-xs"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !valid}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Create function
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}