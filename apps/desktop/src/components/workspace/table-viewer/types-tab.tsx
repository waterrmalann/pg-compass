import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronRight, Shapes } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { useLatestRequest } from "@/hooks/use-latest-request";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TableTypeInfo } from "@/shared/types/table-data";
import { cn } from "@/lib/utils";

interface TypesTabProps {
  connectionId: string;
  schema: string;
  table: string;
  refreshSignal?: number;
  onRefreshComplete?: (success: boolean) => void;
}

function typeKey(type: TableTypeInfo): string {
  return `${type.schema}.${type.name}`;
}

function usedByLabel(type: TableTypeInfo): string {
  return type.usedByColumns
    .map((column) => `${column.name}${column.isArray ? "[]" : ""}`)
    .join(", ");
}

function summary(type: TableTypeInfo): string {
  switch (type.kind) {
    case "ENUM": {
      const preview = type.enumLabels.slice(0, 3).join(", ");
      const suffix = type.enumLabels.length > 3 ? ", ..." : "";
      return `${type.enumLabels.length.toLocaleString()} values${preview ? `: ${preview}${suffix}` : ""}`;
    }
    case "DOMAIN": {
      const details = [
        type.domainBaseType ?? "unknown base",
        type.domainDefault ? "default" : null,
        type.domainConstraints.length > 0 ? "check" : null,
      ].filter(Boolean);
      return details.join(", ");
    }
    case "COMPOSITE":
      return `${type.compositeAttributes.length.toLocaleString()} attributes`;
  }
}

function TypeDetails({ type }: Readonly<{ type: TableTypeInfo }>) {
  if (type.kind === "ENUM") {
    return (
      <div className="flex flex-wrap gap-1">
        {type.enumLabels.map((label) => (
          <Badge key={label} variant="outline" className="font-mono">
            {label}
          </Badge>
        ))}
      </div>
    );
  }

  if (type.kind === "DOMAIN") {
    return (
      <dl className="grid gap-2 text-xs sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">Base type</dt>
        <dd className="font-mono">{type.domainBaseType ?? "unknown"}</dd>
        {type.domainDefault && (
          <>
            <dt className="text-muted-foreground">Default</dt>
            <dd className="font-mono">{type.domainDefault}</dd>
          </>
        )}
        {type.domainConstraints.length > 0 && (
          <>
            <dt className="text-muted-foreground">Constraints</dt>
            <dd className="space-y-1">
              {type.domainConstraints.map((constraint) => (
                <div
                  key={constraint}
                  className="font-mono text-muted-foreground"
                >
                  {constraint}
                </div>
              ))}
            </dd>
          </>
        )}
      </dl>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border border-border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Attribute</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Nullable</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {type.compositeAttributes.map((attribute) => (
            <TableRow key={attribute.name}>
              <TableCell className="font-mono text-[12.5px] font-medium">
                {attribute.name}
              </TableCell>
              <TableCell>
                <Badge className="font-mono">{attribute.dataType}</Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {attribute.isNullable ? "Nullable" : "NOT NULL"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function TypesTab({
  connectionId,
  schema,
  table,
  refreshSignal = 0,
  onRefreshComplete,
}: Readonly<TypesTabProps>) {
  const runLatestRequest = useLatestRequest();
  const [types, setTypes] = useState<TableTypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedType, setExpandedType] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    const request = await runLatestRequest(() =>
      globalThis.window.tableDataApi.getTypes({
        connectionId,
        schema,
        table,
      }),
    );
    if (request.status === "stale") return false;
    if (request.status === "error") {
      toast.error("Failed to load types", {
        description: (request.error as Error).message,
      });
      setLoading(false);
      return false;
    }
    const result = request.value;
    if (!result.success || !result.data) {
      toast.error("Failed to load types", { description: result.error });
      setLoading(false);
      return false;
    }
    setTypes(result.data);
    setLoading(false);
    return true;
  }, [connectionId, runLatestRequest, schema, table]);

  useEffect(
    function loadTypes() {
      void fetch().then((success) => {
        if (refreshSignal > 0) onRefreshComplete?.(success);
      });
    },
    [fetch, onRefreshComplete, refreshSignal],
  );

  if (loading && types.length === 0) {
    return <LoadingState />;
  }

  if (types.length === 0) {
    return (
      <Panel className="h-full">
        <EmptyState
          icon={<Shapes />}
          title="No user-defined types found on this table."
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
              <TableHead>Schema</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Used by</TableHead>
              <TableHead>Summary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((type) => {
              const key = typeKey(type);
              const expanded = expandedType === key;

              return (
                <Fragment key={key}>
                  <TableRow key={key}>
                    <TableCell className="font-mono text-[12.5px] font-medium">
                      <button
                        type="button"
                        className="flex items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={expanded}
                        onClick={() => {
                          setExpandedType(expanded ? null : key);
                        }}
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 shrink-0 text-muted-foreground transition-transform",
                            expanded && "rotate-90",
                          )}
                        />
                        <span>{type.name}</span>
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {type.schema}
                    </TableCell>
                    <TableCell>
                      <Badge className="font-mono">{type.kind}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {type.usedByColumns.map((column) => (
                          <Badge
                            key={`${column.name}-${String(column.isArray)}`}
                            variant="outline"
                            className="font-mono"
                          >
                            {column.name}
                            {column.isArray ? "[]" : ""}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-100 truncate text-xs text-muted-foreground">
                      <span title={summary(type)}>{summary(type)}</span>
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow
                      key={`${key}-details`}
                      className="hover:bg-transparent"
                    >
                      <TableCell
                        colSpan={5}
                        className="bg-muted/40 px-4 py-3 whitespace-normal"
                      >
                        <div className="mb-2 text-xs text-muted-foreground">
                          Used by {usedByLabel(type)}
                        </div>
                        <TypeDetails type={type} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
