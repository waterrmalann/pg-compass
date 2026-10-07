import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelCount,
  PanelHeader,
  PanelTitle,
} from "@/components/ui/panel";
import { useLatestRequest } from "@/hooks/use-latest-request";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { ConstraintInfo } from "@/shared/types/table-data";

interface ConstraintsTabProps {
  connectionId: string;
  schema: string;
  table: string;
  refreshSignal?: number;
  onRefreshComplete?: (success: boolean) => void;
}

const CONSTRAINT_TYPE_ORDER: ConstraintInfo["type"][] = [
  "PRIMARY KEY",
  "FOREIGN KEY",
  "UNIQUE",
  "CHECK",
  "EXCLUDE",
];

const CONSTRAINT_TITLE: Record<ConstraintInfo["type"], string> = {
  "PRIMARY KEY": "Primary key",
  "FOREIGN KEY": "Foreign keys",
  UNIQUE: "Unique",
  CHECK: "Check",
  EXCLUDE: "Exclusion",
};

function groupByType(
  constraints: ConstraintInfo[],
): Map<ConstraintInfo["type"], ConstraintInfo[]> {
  const groups = new Map<ConstraintInfo["type"], ConstraintInfo[]>();

  for (const type of CONSTRAINT_TYPE_ORDER) {
    const items = constraints.filter((c) => c.type === type);
    if (items.length > 0) {
      groups.set(type, items);
    }
  }

  return groups;
}

export function ConstraintsTab({
  connectionId,
  schema,
  table,
  refreshSignal = 0,
  onRefreshComplete,
}: Readonly<ConstraintsTabProps>) {
  const runLatestRequest = useLatestRequest();
  const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const request = await runLatestRequest(() =>
      globalThis.window.tableDataApi.getConstraints({
        connectionId,
        schema,
        table,
      }),
    );
    if (request.status === "stale") return false;
    if (request.status === "error") {
      toast.error("Failed to load constraints", {
        description: (request.error as Error).message,
      });
      setLoading(false);
      return false;
    }
    const result = request.value;
    if (!result.success || !result.data) {
      toast.error("Failed to load constraints", {
        description: result.error,
      });
      setLoading(false);
      return false;
    }
    setConstraints(result.data);
    setLoading(false);
    return true;
  }, [connectionId, runLatestRequest, schema, table]);

  useEffect(
    function loadConstraints() {
      void fetch().then((success) => {
        if (refreshSignal > 0) onRefreshComplete?.(success);
      });
    },
    [fetch, onRefreshComplete, refreshSignal],
  );

  if (loading && constraints.length === 0) {
    return <LoadingState />;
  }

  if (constraints.length === 0) {
    return (
      <Panel className="h-full">
        <EmptyState
          icon={<KeyRound />}
          title="No constraints found on this table."
        />
      </Panel>
    );
  }

  const groups = groupByType(constraints);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      {Array.from(groups.entries()).map(([type, items]) => (
        <Panel key={type} className="shrink-0">
          <PanelHeader>
            <PanelTitle>{CONSTRAINT_TITLE[type]}</PanelTitle>
            <PanelCount>{items.length}</PanelCount>
            <span className="ml-auto font-mono text-[11px] text-subtle-foreground">
              {type}
            </span>
          </PanelHeader>
          <div className="overflow-auto">
            <Table scrollable={false}>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Columns</TableHead>
                  {type === "FOREIGN KEY" && <TableHead>References</TableHead>}
                  <TableHead>Definition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="font-mono text-[12.5px] font-medium">
                      {c.name}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {c.columns.map((col) => (
                          <Badge key={col} className="font-mono">
                            {col}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    {type === "FOREIGN KEY" && (
                      <TableCell className="font-mono text-xs">
                        {c.foreignTable && (
                          <QualifiedReference
                            table={c.foreignTable}
                            columns={c.foreignColumns}
                          />
                        )}
                      </TableCell>
                    )}
                    <TableCell className="max-w-100 truncate font-mono text-xs text-muted-foreground">
                      <span title={c.definition ?? undefined}>
                        {c.definition}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      ))}
    </div>
  );
}

/** `schema.` in muted, the relation name in foreground (§9.17). */
function QualifiedReference({
  table,
  columns,
}: Readonly<{ table: string; columns: string[] }>) {
  const dot = table.lastIndexOf(".");
  const schemaPart = dot >= 0 ? table.slice(0, dot + 1) : "";
  const namePart = dot >= 0 ? table.slice(dot + 1) : table;
  return (
    <span>
      <span className="text-muted-foreground">{schemaPart}</span>
      <span className="font-medium text-foreground">{namePart}</span>
      <span className="text-muted-foreground">({columns.join(", ")})</span>
    </span>
  );
}
