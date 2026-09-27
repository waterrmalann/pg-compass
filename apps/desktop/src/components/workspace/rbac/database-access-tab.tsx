import { useState } from "react";
import { Database, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelCount,
  PanelHeader,
  PanelTitle,
} from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MissingValue } from "@/components/workspace/relation-list-table";
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
      <EmptyState
        icon={<Database />}
        title="No databases"
        description="No databases on this server accept connections."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[72ch] text-xs leading-5 text-muted-foreground">
        Read only grants CONNECT, USAGE on the public schema and SELECT on
        tables. Read + write adds INSERT, UPDATE and DELETE. Use Manage in the
        Tables column to give specific tables, in any schema, their own level.
      </p>
      <Panel>
        <PanelHeader>
          <Database />
          <PanelTitle>Database access</PanelTitle>
          <PanelCount>{databases.length}</PanelCount>
          <span className="ml-auto truncate text-xs text-muted-foreground">
            For <span className="font-mono">{role.name}</span>
          </span>
        </PanelHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Database</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Size</TableHead>
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
      </Panel>
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
      <TableCell className="font-mono text-[12.5px] font-medium">
        {db.name}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {db.owner}
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
        {db.size ?? <MissingValue />}
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
          <Badge variant={db.level === "none" ? "outline" : "default"}>
            {formatLevel(db.level)}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {canManageTables ? (
          <>
            <Button
              variant="ghost"
              size="xs"
              disabled={disabled}
              onClick={() => setSheetOpen(true)}
              aria-label={`Manage table access on ${db.name}`}
            >
              <Layers />
              Manage
              <span className="font-mono text-[11px] text-subtle-foreground tabular-nums">
                {grantedCount}/{db.tables.length}
              </span>
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
          <MissingValue />
        )}
      </TableCell>
    </TableRow>
  );
}
