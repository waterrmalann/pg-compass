import { useMemo } from "react";
import { Database, HardDrive, Layers, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PgDatabaseInfo } from "@/shared/types/roles";
import { formatLevel } from "./shared";

interface DatabaseCardsProps {
  databases: PgDatabaseInfo[];
  /** Role the access levels on each card were evaluated for. */
  targetUser: string;
  /** Switches to the Users & roles tab. */
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
      <p className="text-sm text-muted-foreground">
        No connectable databases on this server.
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Access levels shown for{" "}
          <span className="font-mono text-foreground">{targetUser}</span>.
        </p>
        <Button variant="ghost" size="xs" onClick={onOpenUsers}>
          <Users className="size-3.5" />
          Open users & roles
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-3 p-1 sm:grid-cols-2 xl:grid-cols-3">
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
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="rounded-md bg-muted p-1.5">
            <Database className="size-4 text-muted-foreground" />
          </div>
          <span className="truncate font-mono text-sm font-semibold">
            {db.name}
          </span>
        </div>
        <Badge variant={db.level === "none" ? "outline" : "secondary"}>
          {formatLevel(db.level)}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-y-2 text-xs">
        <CardStat
          icon={<Users className="size-3" />}
          label="Owner"
          value={db.owner}
        />
        <CardStat
          icon={<HardDrive className="size-3" />}
          label="Size"
          value={db.size ?? "—"}
        />
        <CardStat
          icon={<Layers className="size-3" />}
          label="Schemas"
          value={db.schemaCount === null ? "—" : String(db.schemaCount)}
        />
        <CardStat
          icon={<Users className="size-3" />}
          label="Roles with access"
          value={String(db.roleCount)}
        />
      </div>

      {(db.isTemplate || !db.allowConnections) && (
        <div className="flex flex-wrap gap-1">
          {db.isTemplate && <Badge variant="outline">Template</Badge>}
          {!db.allowConnections && (
            <Badge variant="outline">No connections</Badge>
          )}
        </div>
      )}
    </div>
  );
}

function CardStat({
  icon,
  label,
  value,
}: Readonly<{ icon: React.ReactNode; label: string; value: string }>) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="truncate text-xs text-foreground">{value}</span>
    </div>
  );
}
