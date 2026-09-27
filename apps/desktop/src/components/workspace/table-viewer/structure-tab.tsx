import { useCallback, useEffect, useState } from "react";
import { Columns3 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
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
import { MissingValue } from "@/components/workspace/relation-list-table";
import type { ColumnStructure } from "@/shared/types/table-data";

interface StructureTabProps {
  connectionId: string;
  schema: string;
  table: string;
  refreshSignal?: number;
  onRefreshComplete?: (success: boolean) => void;
}

function formatType(col: ColumnStructure): string {
  // information_schema reports enums, domains and extension types (vector,
  // geometry) as USER-DEFINED and arrays as ARRAY; the udt name is the
  // useful label for both.
  if (col.dataType === "USER-DEFINED") return col.udtName;
  if (col.dataType === "ARRAY") return `${col.udtName.replace(/^_/, "")}[]`;
  if (col.characterMaxLength != null) {
    return `${col.dataType}(${String(col.characterMaxLength)})`;
  }
  // Integer and float types report a binary precision (32, 53…) that isn't
  // part of the declared type, so only numeric shows precision and scale.
  if (col.dataType !== "numeric" || col.numericPrecision == null) {
    return col.dataType;
  }
  if (col.numericScale == null) {
    return `numeric(${String(col.numericPrecision)})`;
  }
  return `numeric(${String(col.numericPrecision)},${String(col.numericScale)})`;
}

function renderSample(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value as string | number | boolean);
}

export function StructureTab({
  connectionId,
  schema,
  table,
  refreshSignal = 0,
  onRefreshComplete,
}: Readonly<StructureTabProps>) {
  const runLatestRequest = useLatestRequest();
  const [columns, setColumns] = useState<ColumnStructure[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const request = await runLatestRequest(() =>
      globalThis.window.tableDataApi.getStructure({
        connectionId,
        schema,
        table,
      }),
    );
    if (request.status === "stale") return false;
    if (request.status === "error") {
      toast.error("Failed to load structure", {
        description: (request.error as Error).message,
      });
      setLoading(false);
      return false;
    }
    const result = request.value;
    if (!result.success || !result.data) {
      toast.error("Failed to load structure", { description: result.error });
      setLoading(false);
      return false;
    }
    setColumns(result.data);
    setLoading(false);
    return true;
  }, [connectionId, runLatestRequest, schema, table]);

  useEffect(
    function loadStructure() {
      void fetch().then((success) => {
        if (refreshSignal > 0) onRefreshComplete?.(success);
      });
    },
    [fetch, onRefreshComplete, refreshSignal],
  );

  if (loading && columns.length === 0) {
    return <LoadingState />;
  }

  if (columns.length === 0) {
    return (
      <Panel className="h-full">
        <EmptyState icon={<Columns3 />} title="No columns found." />
      </Panel>
    );
  }

  return (
    <Panel className="max-h-full">
      <div className="min-h-0 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="w-12 text-right">#</TableHead>
              <TableHead>Column</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Nullable</TableHead>
              <TableHead>Default</TableHead>
              <TableHead>Sample values</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {columns.map((col) => (
              <TableRow key={col.name}>
                <TableCell className="text-right font-mono text-[11px] text-subtle-foreground tabular-nums">
                  {col.ordinalPosition}
                </TableCell>
                <TableCell className="font-mono text-[12.5px] font-medium">
                  {col.name}
                </TableCell>
                <TableCell>
                  <Badge className="font-mono">{formatType(col)}</Badge>
                </TableCell>
                <TableCell>
                  {col.isNullable ? (
                    <span className="text-xs text-muted-foreground">
                      Nullable
                    </span>
                  ) : (
                    <span className="font-mono text-xs">NOT NULL</span>
                  )}
                </TableCell>
                <TableCell className="max-w-50 truncate font-mono text-xs text-muted-foreground">
                  {col.columnDefault ?? <MissingValue />}
                </TableCell>
                <TableCell className="max-w-75">
                  <div className="flex gap-1 overflow-hidden">
                    {col.sampleValues.length > 0 ? (
                      col.sampleValues.slice(0, 3).map((val, i) => {
                        const key = `sample-${col.name}-${String(i)}`;
                        return (
                          <Badge
                            key={key}
                            variant="outline"
                            className="block max-w-30 truncate font-mono leading-5 font-normal"
                            title={renderSample(val)}
                          >
                            {renderSample(val)}
                          </Badge>
                        );
                      })
                    ) : (
                      <MissingValue />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
