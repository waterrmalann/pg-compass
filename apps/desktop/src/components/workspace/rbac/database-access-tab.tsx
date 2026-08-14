import { useState } from "react";
import { Database, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AccessLevel, PgDatabaseInfo, PgRole } from "@/shared/types/roles";
import { AccessLevelControl } from "./access-level-control";
import { LoadingState, formatLevel } from "./shared";
import { TableAccessSheet, type TableGrant } from "./table-access-sheet";

interface DatabaseAccessTabProps {
  role: PgRole;
  databases: PgDatabaseInfo[];
  /** Role the snapshot's per-database levels were evaluated for. */
  accessTargetUser: string;
  isAdmin: boolean;
  disabled: boolean;
  onSetDbAccessLevel: (db: PgDatabaseInfo, level: AccessLevel) => void;
  onSetTableRestrictions: (
    db: PgDatabaseInfo,
    tables: TableGrant[],
  ) => Promise<boolean>;
}

export function DatabaseAccessTab({
  role,
  databases,
  accessTargetUser,
  isAdmin,
  disabled,
  onSetDbAccessLevel,
  onSetTableRestrictions,
}: Readonly<DatabaseAccessTabProps>) {
  // Levels belong to whichever role the snapshot was fetched for; until the
  // snapshot for this role arrives, showing them would attribute another
  // role's grants to this one.
  const levelsMatchRole = accessTargetUser === role.name;
  if (!levelsMatchRole) {
    return <LoadingState label="Loading database access…" />;
  }

  if (databases.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No databases are connectable on this server.
      </p>
    );
  }

  return (
    <div className="flex max-w-5xl flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Each database grants one of three access levels for{" "}
        <span className="font-medium text-foreground">{role.name}</span>. Read
        only grants CONNECT, USAGE on the public schema, and SELECT on tables;
        read + write adds INSERT, UPDATE, DELETE. Use &quot;Manage tables&quot;
        to grant specific tables — in any schema — their own read or read/write
        level.
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader className="bg-card">
            <TableRow>
              <TableHead>Database</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Access level</TableHead>
              <TableHead>Tables</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {databases.map((db) => (
              <DatabaseAccessRow
                key={db.name}
                db={db}
                roleName={role.name}
                isAdmin={isAdmin}
                disabled={disabled}
                onSetDbAccessLevel={onSetDbAccessLevel}
                onSetTableRestrictions={onSetTableRestrictions}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DatabaseAccessRow({
  db,
  roleName,
  isAdmin,
  disabled,
  onSetDbAccessLevel,
  onSetTableRestrictions,
}: Readonly<{
  db: PgDatabaseInfo;
  roleName: string;
  isAdmin: boolean;
  disabled: boolean;
  onSetDbAccessLevel: (db: PgDatabaseInfo, level: AccessLevel) => void;
  onSetTableRestrictions: (
    db: PgDatabaseInfo,
    tables: TableGrant[],
  ) => Promise<boolean>;
}>) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const grantedCount = db.tables.filter((t) => t.level !== "none").length;
  const canManageTables = isAdmin && db.tables.length > 0;

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        <span className="flex items-center gap-2">
          <Database className="size-3.5 text-muted-foreground" />
          {db.name}
        </span>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {db.owner}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {db.size ?? "—"}
      </TableCell>
      <TableCell>
        {isAdmin ? (
          <AccessLevelControl
            label={`Access level on ${db.name}`}
            value={db.level}
            disabled={disabled}
            onChange={(level) => onSetDbAccessLevel(db, level)}
          />
        ) : (
          <Badge variant={db.level === "none" ? "outline" : "secondary"}>
            {formatLevel(db.level)}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {canManageTables ? (
          <>
            <Button
              variant="outline"
              size="xs"
              disabled={disabled}
              onClick={() => setSheetOpen(true)}
            >
              <Layers className="size-3.5" />
              Manage tables
              <Badge variant="secondary" className="text-[10px]">
                {grantedCount}/{db.tables.length}
              </Badge>
            </Button>
            <TableAccessSheet
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              db={db}
              roleName={roleName}
              disabled={disabled}
              onSave={(tables) => onSetTableRestrictions(db, tables)}
            />
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}
