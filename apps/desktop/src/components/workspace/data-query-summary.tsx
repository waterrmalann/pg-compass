import { useEffect, useId, useState } from "react";
import { CircleAlert, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DataQueryInput } from "@/shared/query-dsl/types";
import type { PreviewQuerySqlResult } from "@/shared/types/table-data";

/** Renders a bound parameter the way it would read as a SQL literal. */
export function formatSqlParameter(value: unknown): string {
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value) ?? String(value);
}

const FIELDS = [
  ["Filter", "filter"],
  ["Project", "projection"],
  ["Sort", "sort"],
  ["Skip", "skip"],
  ["Limit", "limit"],
] as const;

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: PreviewQuerySqlResult }
  | { status: "error"; message: string };

interface DataQuerySummaryProps {
  connectionId: string;
  schema: string;
  table: string;
  query: DataQueryInput;
}

/**
 * The active Data-tab query as the user wrote it, with an eye toggle that
 * reveals the SQL the main process compiled from it. The preview comes from
 * the same builder the export runs, so it is exactly what gets executed.
 */
export function DataQuerySummary({
  connectionId,
  schema,
  table,
  query,
}: Readonly<DataQuerySummaryProps>) {
  const sqlId = useId();
  const [showSql, setShowSql] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  useEffect(() => {
    if (!showSql) return;
    let cancelled = false;
    setPreview({ status: "loading" });
    globalThis.window.tableDataApi
      .previewQuerySql({ connectionId, schema, table, query })
      .then((response) => {
        if (cancelled) return;
        if (!response.success) {
          setPreview({ status: "error", message: response.error });
          return;
        }
        setPreview({ status: "ready", result: response.data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreview({ status: "error", message: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [showSql, connectionId, schema, table, query]);

  const toggleLabel = showSql ? "Hide SQL" : "Show SQL";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Query</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-pressed={showSql}
          aria-controls={showSql ? sqlId : undefined}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => setShowSql((shown) => !shown)}
        >
          {showSql ? <EyeOff /> : <Eye />}
        </Button>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-border bg-code p-3 text-xs">
        {FIELDS.map(([label, field]) => {
          const text = query[field].trim();
          return (
            <div key={field} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate font-mono" title={text || undefined}>
                {text || "—"}
              </dd>
            </div>
          );
        })}
      </dl>

      {showSql ? (
        <div id={sqlId} aria-live="polite">
          <SqlPreview preview={preview} />
        </div>
      ) : null}
    </div>
  );
}

function SqlPreview({ preview }: Readonly<{ preview: PreviewState }>) {
  if (preview.status === "idle" || preview.status === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-code p-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Building SQL…
      </div>
    );
  }
  if (preview.status === "error") {
    return (
      <p className="flex items-start gap-1.5 rounded-lg border border-border bg-code p-3 text-xs text-destructive-foreground">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>{preview.message}</span>
      </p>
    );
  }

  const { sql, values } = preview.result;
  return (
    <div className="flex flex-col rounded-lg border border-border bg-code">
      <pre
        data-testid="export-sql-preview"
        className="max-h-48 overflow-auto p-3 font-mono text-xs leading-5 whitespace-pre-wrap"
      >
        {sql}
      </pre>
      {values.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-t border-border px-3 py-2 font-mono text-xs">
          {values.map((value, index) => (
            <div key={`$${String(index + 1)}`} className="contents">
              <dt className="text-muted-foreground">${index + 1}</dt>
              <dd className="truncate">{formatSqlParameter(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
