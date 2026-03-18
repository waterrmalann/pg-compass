import { ScrollArea } from '@/components/ui/scroll-area';
import { typeRegistry } from '@/components/workspace/renderers/type-registry';
import { JsonTree } from '@/components/workspace/table-viewer/json-tree';
import type { ColumnInfo } from '@/shared/types/table-data';

interface CardDataViewProps {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
}

function isStructuredValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return typeof value === 'object';
}

function CardFieldValue({
  col,
  value,
}: Readonly<{ col: ColumnInfo; value: unknown }>) {
  const isNull = value === null || value === undefined;
  if (isNull) {
    return <>{typeRegistry.get('__null__').renderCard(value)}</>;
  }

  const isJson = col.dataType === 'json' || col.dataType === 'jsonb';
  const isStructured = isJson || isStructuredValue(value);
  if (isStructured) {
    return <JsonTree value={value} />;
  }

  return <>{typeRegistry.get(col.dataType).renderCard(value)}</>;
}

export function CardDataView({ columns, rows }: Readonly<CardDataViewProps>) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No rows to display.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-1">
        {rows.map((row, rowIndex) => {
          const rowKey = `card-${String(rowIndex)}`;
          return (
            <div
              key={rowKey}
              className="rounded-lg border border-border bg-card"
            >
              <div className="border-b border-border px-3 py-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Document {rowIndex + 1}
                </span>
              </div>
              <div className="px-3 py-2">
                {columns.map((col) => (
                  <div key={col.name} className="flex gap-2 border-b border-border/30 py-1.5 last:border-b-0">
                    <div className="flex flex-col w-36 shrink-0 items-start gap-1.5">
                      <span className="text-xs font-medium text-foreground/80">{col.name}</span>
                      <span className="text-[10px] text-muted-foreground/50">{col.dataType}</span>
                    </div>
                    <div className="min-w-0 flex-1 font-mono text-xs">
                      <CardFieldValue col={col} value={row[col.name]} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
