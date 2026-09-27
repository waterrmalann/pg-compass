import { useMemo } from "react";
import { Database, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MissingValue } from "@/components/workspace/relation-list-table";
import { cn } from "@/lib/utils";
import type { PgDatabaseInfo } from "@/shared/types/roles";
import { formatLevel } from "./shared";

interface DatabaseCardsProps {
  databases: PgDatabaseInfo[];
  /** Role the access levels on each card were evaluated for. */
  targetUser: string;
  /** Switches to the Users and roles tab. */
  onOpenUsers: () => void;
}

export function DatabaseCards({
  databases,
  targetUser,
  onOpenUsers,
}: Readonly<DatabaseCardsProps>) {
  const sorted = useMemo(
    () => [...databases].sort((a, b) => a.name.localeCompare(b.name)),
    [databases],
  );

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={<Database />}
        title="No databases"
        description="No databases on this server accept connections."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Access levels shown for{" "}
          <span className="font-mono text-foreground">{targetUser}</span>.
        </p>
        <Button variant="ghost" size="xs" onClick={onOpenUsers}>
          <Users />
          Open users and roles
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((db) => (
            <DatabaseCard key={db.name} db={db} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function DatabaseCard({ db }: Readonly<{ db: PgDatabaseInfo }>) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3 shadow-xs/5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Database className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-[13px] font-medium">
            {db.name}
          </span>
        </div>
        <Badge variant={db.level === "none" ? "outline" : "default"}>
          {formatLevel(db.level)}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <CardStat label="Owner" value={db.owner} mono />
        <CardStat label="Size" value={db.size} />
        <CardStat
          label="Schemas"
          value={db.schemaCount === null ? null : String(db.schemaCount)}
        />
        <CardStat label="Roles with access" value={String(db.roleCount)} />
      </dl>

      {(db.isTemplate || !db.allowConnections) && (
        <div className="flex flex-wrap gap-1">
          {db.isTemplate && <Badge>Template</Badge>}
          {!db.allowConnections && <Badge>No connections</Badge>}
        </div>
      )}
    </div>
  );
}

function CardStat({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string | null; mono?: boolean }>) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "truncate text-[13px] text-foreground tabular-nums",
          mono && "font-mono text-xs",
        )}
      >
        {value ?? <MissingValue />}
      </dd>
    </div>
  );
}
