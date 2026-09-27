import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const ARRAY_COLLAPSE_THRESHOLD = 50;

interface JsonTreeProps {
  value: unknown;
  depth?: number;
}

export function JsonTree({ value, depth = 0 }: Readonly<JsonTreeProps>) {
  if (value === null || value === undefined) {
    return <span className="text-info-foreground">null</span>;
  }

  if (typeof value === "boolean") {
    return (
      <span className="text-info-foreground">{value ? "true" : "false"}</span>
    );
  }

  if (typeof value === "number") {
    return (
      <span className="tabular-nums text-info-foreground">{String(value)}</span>
    );
  }

  if (typeof value === "string") {
    return (
      <span className="break-all text-success-foreground">
        {JSON.stringify(value)}
      </span>
    );
  }

  if (Array.isArray(value)) {
    return <JsonArray items={value} depth={depth} />;
  }

  if (typeof value === "object") {
    return <JsonObject obj={value as Record<string, unknown>} depth={depth} />;
  }

  return <span>{JSON.stringify(value)}</span>;
}

function JsonObject({
  obj,
  depth,
}: Readonly<{ obj: Record<string, unknown>; depth: number }>) {
  const [expanded, setExpanded] = useState(depth < 2);
  const entries = Object.entries(obj);

  if (entries.length === 0) {
    return <span className="text-muted-foreground">{"{}"}</span>;
  }

  if (!expanded) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(true)}
      >
        <ChevronRight className="size-3" />
        <span>{"{"}</span>
        <span className="text-subtle-foreground">{entries.length} fields</span>
        <span>{"}"}</span>
      </button>
    );
  }

  return (
    <div className="text-xs">
      <button
        type="button"
        className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(false)}
      >
        <ChevronRight
          className={cn("size-3 transition-transform", "rotate-90")}
        />
        <span>{"{"}</span>
      </button>
      <div className="ml-4 border-l border-border pl-2">
        {entries.map(([key, val]) => (
          <div key={key} className="flex gap-1 py-0.5">
            <span className="shrink-0 text-foreground/85">
              {key}
              <span className="text-muted-foreground">:</span>
            </span>
            <JsonTree value={val} depth={depth + 1} />
          </div>
        ))}
      </div>
      <span className="text-muted-foreground">{"}"}</span>
    </div>
  );
}

function JsonArray({
  items,
  depth,
}: Readonly<{ items: unknown[]; depth: number }>) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [showAll, setShowAll] = useState(false);

  if (items.length === 0) {
    return <span className="text-muted-foreground">[]</span>;
  }

  if (!expanded) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(true)}
      >
        <ChevronRight className="size-3" />
        <span>[</span>
        <span className="text-subtle-foreground">{items.length} items</span>
        <span>]</span>
      </button>
    );
  }

  const displayItems =
    showAll || items.length <= ARRAY_COLLAPSE_THRESHOLD
      ? items
      : items.slice(0, ARRAY_COLLAPSE_THRESHOLD);
  const hiddenCount = items.length - displayItems.length;

  return (
    <div className="text-xs">
      <button
        type="button"
        className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(false)}
      >
        <ChevronRight
          className={cn("size-3 transition-transform", "rotate-90")}
        />
        <span>[</span>
      </button>
      <div className="ml-4 border-l border-border pl-2">
        {displayItems.map((item, index) => {
          const key = `arr-${String(index)}`;
          return (
            <div key={key} className="flex gap-1 py-0.5">
              <span className="shrink-0 tabular-nums text-subtle-foreground">
                {index}:
              </span>
              <JsonTree value={item} depth={depth + 1} />
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <button
            type="button"
            className="py-0.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setShowAll(true)}
          >
            [ …{hiddenCount} more items ]
          </button>
        )}
      </div>
      <span className="text-muted-foreground">]</span>
    </div>
  );
}
