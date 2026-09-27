import { Table2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface RelationListRow {
  name: string;
  /** Formatted estimate, or null when Postgres has no statistics yet. */
  rowCount: string | null;
  sizeOnDisk: string | null;
  definition?: string;
}

interface RelationListTableProps {
  rows: RelationListRow[];
  selectedName?: string;
  onOpenRow?: (row: RelationListRow) => void;
  includeDefinition?: boolean;
  emptyMessage: string;
}

/** A muted em dash stands in for unknown values (docs/DESIGN.md §9.17). */
export function MissingValue() {
  return <span className="text-muted-foreground/60">—</span>;
}

export function RelationListTable({
  rows,
  selectedName,
  onOpenRow,
  includeDefinition,
  emptyMessage,
}: Readonly<RelationListTableProps>) {
  if (rows.length === 0) {
    return (
      <Panel className="h-full">
        <EmptyState icon={<Table2 />} title={emptyMessage} />
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
              {!includeDefinition && (
                <>
                  <TableHead className="w-40 text-right">Rows</TableHead>
                  <TableHead className="w-40 text-right">
                    Size on disk
                  </TableHead>
                </>
              )}
              {includeDefinition && <TableHead>Definition</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isSelected = selectedName === row.name;
              const clickable = Boolean(onOpenRow);

              return (
                <TableRow
                  key={row.name}
                  data-state={isSelected ? "selected" : undefined}
                  className={cn(clickable && "cursor-pointer")}
                  onClick={onOpenRow ? () => onOpenRow(row) : undefined}
                >
                  <TableCell className="font-mono text-[12.5px] font-medium">
                    {row.name}
                  </TableCell>
                  {!includeDefinition && (
                    <>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.rowCount ?? <MissingValue />}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.sizeOnDisk ?? <MissingValue />}
                      </TableCell>
                    </>
                  )}
                  {includeDefinition && (
                    <TableCell className="max-w-[60ch] truncate font-mono text-xs text-muted-foreground">
                      {row.definition ?? <MissingValue />}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
