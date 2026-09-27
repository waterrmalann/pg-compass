import { useMemo, useState } from "react";
import { ChevronDownIcon, Layers, Loader2, Search } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  AccessLevel,
  PgDatabaseInfo,
  PgTableAccess,
} from "@/shared/types/roles";
import { ACCESS_LEVELS, AccessLevelControl } from "./access-level-control";
import { formatLevel } from "./shared";

export interface TableGrant {
  schema: string;
  name: string;
  level: AccessLevel;
}

interface TableAccessSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  db: PgDatabaseInfo;
  roleName: string;
  disabled: boolean;
  onSave: (tables: TableGrant[]) => Promise<boolean>;
}

export function TableAccessSheet({
  open,
  onOpenChange,
  db,
  roleName,
  disabled,
  onSave,
}: Readonly<TableAccessSheetProps>) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-2xl">
        {/*
          The draft lives in a child that mounts when the sheet opens (and is
          keyed by role and database), so it is seeded once per opening and a
          snapshot refresh while the sheet is open doesn't discard edits.
        */}
        <TableAccessForm
          key={`${roleName}\u0000${db.name}`}
          db={db}
          roleName={roleName}
          disabled={disabled}
          onCancel={() => onOpenChange(false)}
          onSave={async (tables) => {
            const ok = await onSave(tables);
            if (ok) onOpenChange(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function groupTablesBySchema(
  tables: PgTableAccess[],
): Array<{ schema: string; tables: PgTableAccess[] }> {
  const bySchema = new Map<string, PgTableAccess[]>();
  for (const table of tables) {
    const list = bySchema.get(table.schemaName) ?? [];
    list.push(table);
    bySchema.set(table.schemaName, list);
  }
  return Array.from(bySchema.entries())
    .map(([schema, schemaTables]) => ({ schema, tables: schemaTables }))
    .sort((a, b) => {
      if (a.schema === "public") return -1;
      if (b.schema === "public") return 1;
      return a.schema.localeCompare(b.schema);
    });
}

function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function initialDraft(tables: PgTableAccess[]): Map<string, AccessLevel> {
  const draft = new Map<string, AccessLevel>();
  for (const table of tables) {
    draft.set(tableKey(table.schemaName, table.tableName), table.level);
  }
  return draft;
}

function TableAccessForm({
  db,
  roleName,
  disabled,
  onCancel,
  onSave,
}: Readonly<{
  db: PgDatabaseInfo;
  roleName: string;
  disabled: boolean;
  onCancel: () => void;
  onSave: (tables: TableGrant[]) => Promise<void>;
}>) {
  const schemas = useMemo(() => groupTablesBySchema(db.tables), [db.tables]);
  const [draft, setDraft] = useState(() => initialDraft(db.tables));
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const controlsDisabled = disabled || saving;

  const filteredSchemas = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    if (!trimmed) return schemas;
    return schemas
      .map((group) => ({
        schema: group.schema,
        tables: group.schema.toLowerCase().includes(trimmed)
          ? group.tables
          : group.tables.filter((t) =>
              t.tableName.toLowerCase().includes(trimmed),
            ),
      }))
      .filter((group) => group.tables.length > 0);
  }, [schemas, search]);

  function levelOf(schema: string, table: string): AccessLevel {
    return draft.get(tableKey(schema, table)) ?? "none";
  }

  function setLevel(schema: string, table: string, level: AccessLevel) {
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(tableKey(schema, table), level);
      return next;
    });
  }

  function setSchemaLevel(schema: string, level: AccessLevel) {
    const group = schemas.find((g) => g.schema === schema);
    if (!group) return;
    setDraft((prev) => {
      const next = new Map(prev);
      for (const table of group.tables) {
        next.set(tableKey(schema, table.tableName), level);
      }
      return next;
    });
  }

  async function handleSave() {
    const tables = db.tables.map((table) => ({
      schema: table.schemaName,
      name: table.tableName,
      level: levelOf(table.schemaName, table.tableName),
    }));
    setSaving(true);
    try {
      await onSave(tables);
    } finally {
      setSaving(false);
    }
  }

  const totalGranted = Array.from(draft.values()).filter(
    (level) => level !== "none",
  ).length;

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          Table access on <span className="font-mono">{db.name}</span>
        </SheetTitle>
        <SheetDescription>
          Give <span className="font-mono text-foreground">{roleName}</span>{" "}
          read or read + write access to specific tables. Tables left at No
          access are revoked, and future tables are not granted automatically.
        </SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter schemas or tables"
              aria-label="Filter schemas or tables"
              className="pl-8 text-xs"
            />
          </div>
          <Badge className="shrink-0 tabular-nums">
            {totalGranted}/{db.tables.length} granted
          </Badge>
        </div>
        <ScrollArea className="min-h-0 flex-1 rounded-xl border border-border bg-card shadow-xs/5">
          {filteredSchemas.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No tables match &quot;{search}&quot;.
            </p>
          ) : (
            <Accordion type="multiple">
              {filteredSchemas.map((group) => {
                const grantedInSchema = group.tables.filter(
                  (t) => levelOf(group.schema, t.tableName) !== "none",
                ).length;
                return (
                  <AccordionItem
                    key={group.schema}
                    value={group.schema}
                    className="border-border/70"
                  >
                    <AccordionPrimitive.Header className="flex">
                      <AccordionPrimitive.Trigger className="flex h-10 flex-1 items-center gap-2 px-4 text-left outline-none transition-colors duration-150 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&[data-state=open]>svg:last-child]:rotate-180">
                        <Layers className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="font-mono text-[12.5px] font-medium">
                          {group.schema}
                        </span>
                        <span className="font-mono text-[11px] text-subtle-foreground tabular-nums">
                          {grantedInSchema}/{group.tables.length}
                        </span>
                        <ChevronDownIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-150" />
                      </AccordionPrimitive.Trigger>
                    </AccordionPrimitive.Header>
                    <AccordionContent className="pb-0">
                      <div className="flex items-center gap-1 border-y border-border/70 bg-muted/40 px-4 py-1.5">
                        <span className="mr-1 text-xs text-muted-foreground">
                          Set all
                        </span>
                        {ACCESS_LEVELS.map((level) => (
                          <Button
                            key={level}
                            type="button"
                            variant="ghost"
                            size="xs"
                            disabled={controlsDisabled}
                            onClick={() => setSchemaLevel(group.schema, level)}
                          >
                            {formatLevel(level)}
                          </Button>
                        ))}
                      </div>
                      <div className="flex flex-col divide-y divide-border/70">
                        {group.tables.map((table) => (
                          <div
                            key={table.tableName}
                            className="flex h-10 items-center justify-between gap-2 pr-2 pl-9.5 transition-colors duration-150 hover:bg-muted/40"
                          >
                            <span className="truncate font-mono text-[12.5px]">
                              {table.tableName}
                            </span>
                            <AccessLevelControl
                              label={`Access level on ${group.schema}.${table.tableName}`}
                              value={levelOf(group.schema, table.tableName)}
                              disabled={controlsDisabled}
                              onChange={(level) =>
                                setLevel(group.schema, table.tableName, level)
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </ScrollArea>
      </div>
      <SheetFooter className="flex-row justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={controlsDisabled}
          onClick={() => {
            handleSave().catch(() => undefined);
          }}
        >
          {saving && <Loader2 className="animate-spin" />}
          Save table access
        </Button>
      </SheetFooter>
    </>
  );
}
