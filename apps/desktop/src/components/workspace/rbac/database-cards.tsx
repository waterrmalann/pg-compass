import { useMemo } from "react";
import {
  Database,
  HardDrive,
  Layers,
  MoreHorizontal,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PgDatabaseInfo } from "@/shared/types/roles";
import { formatLevel } from "./shared";

interface DatabaseCardsProps {
  databases: PgDatabaseInfo[];
  /** Called with the database name when "Users" is picked from a card's menu. */
  onOpenUsers?: (databaseName: string) => void;
}

export function DatabaseCards({
  databases,
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
    <ScrollArea className="min-h-0 flex-1">
      <div className="grid gap-3 p-1 sm:grid-cols-2 xl:grid-cols-3">
        {sorted.map((db) => (
          <DatabaseCard key={db.name} db={db} onOpenUsers={onOpenUsers} />
        ))}
      </div>
    </ScrollArea>
  );
}

function DatabaseCard({
  db,
  onOpenUsers,
}: Readonly<{ db: PgDatabaseInfo; onOpenUsers?: (databaseName: string) => void }>) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="rounded-md bg-muted p-1.5">
            <Database className="size-4 text-muted-foreground" />
          </div>
          <span className="truncate font-mono text-sm font-semibold">
            {db.name}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Badge
            variant={db.level === "none" ? "outline" : "secondary"}
            className="uppercase"
          >
            {formatLevel(db.level)}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`More actions for ${db.name}`}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => onOpenUsers?.(db.name)}>
                <Users className="mr-2 size-3.5" />
                Users
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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

      <div className="flex flex-wrap gap-1">
        {db.isTemplate && (
          <Badge variant="outline" className="uppercase">
            Template
          </Badge>
        )}
        {db.allowConnections === false && (
          <Badge variant="outline" className="uppercase">
            No connections
          </Badge>
        )}
      </div>
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