import { useCallback, useEffect, useState } from "react";
import { ListTree } from "lucide-react";
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
import type { IndexInfo } from "@/shared/types/table-data";

interface IndexesTabProps {
  connectionId: string;
  schema: string;
  table: string;
  refreshSignal?: number;
  onRefreshComplete?: (success: boolean) => void;
}

export function IndexesTab({
  connectionId,
  schema,
  table,
  refreshSignal = 0,
  onRefreshComplete,
}: Readonly<IndexesTabProps>) {
  const runLatestRequest = useLatestRequest();
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const request = await runLatestRequest(() =>
      globalThis.window.tableDataApi.getIndexes({
        connectionId,
        schema,
        table,
      }),
    );
    if (request.status === "stale") return false;
    if (request.status === "error") {
      toast.error("Failed to load indexes", {
        description: (request.error as Error).message,
      });
      setLoading(false);
      return false;
    }
    const result = request.value;
    if (!result.success || !result.data) {
      toast.error("Failed to load indexes", { description: result.error });
      setLoading(false);
      return false;
    }
    setIndexes(result.data);
    setLoading(false);
    return true;
  }, [connectionId, runLatestRequest, schema, table]);

  useEffect(
    function loadIndexes() {
      void fetch().then((success) => {
        if (refreshSignal > 0) onRefreshComplete?.(success);
      });
    },
    [fetch, onRefreshComplete, refreshSignal],
  );

  if (loading && indexes.length === 0) {
    return <LoadingState />;
  }

  if (indexes.length === 0) {
    return (
      <Panel className="h-full">
        <EmptyState
          icon={<ListTree />}
          title="No indexes found on this table."
        />
      </Panel>
    );
  }

  return (
    <Panel className="max-h-full">
      <div className="min-h-0 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Properties</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead className="text-right">Scans</TableHead>
              <TableHead className="text-right">Tuples read</TableHead>
              <TableHead className="text-right">Tuples fetched</TableHead>
              <TableHead>Definition</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {indexes.map((idx) => (
              <TableRow key={idx.name}>
                <TableCell className="font-mono text-[12.5px] font-medium">
                  {idx.name}
                </TableCell>
                <TableCell>
                  <Badge className="font-mono">{idx.type}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {idx.isPrimary && <Badge>Primary key</Badge>}
                    {idx.isUnique && !idx.isPrimary && (
                      <Badge variant="outline">Unique</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {idx.size}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {idx.scans.toLocaleString()}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {idx.tuplesRead.toLocaleString()}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {idx.tuplesFetched.toLocaleString()}
                </TableCell>
                <TableCell className="max-w-100 truncate font-mono text-xs text-muted-foreground">
                  <span title={idx.definition}>{idx.definition}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
