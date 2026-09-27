// ---------------------------------------------------------------------------
// Vector (pgvector)
// ---------------------------------------------------------------------------

import { stringify } from "@/lib/utils";
import { typeRegistry, TypeRenderer } from "./type-registry";
import { useState } from "react";

function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value)) return value as number[];

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const inner = trimmed.slice(1, -1);

      return inner
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => !Number.isNaN(v));
    }
  }

  return null;
}

function ExpandableVector({ vector }: { vector: number[] }) {
  const [expanded, setExpanded] = useState(false);

  const preview = vector
    .slice(0, 3)
    .map((v) => v.toFixed(3))
    .join(", ");
  const dims = vector.length;

  if (!expanded) {
    return (
      <span className="font-mono text-xs">
        [{preview}, …{" "}
        <button
          onClick={() => setExpanded(true)}
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {dims} dimensions
        </button>
        ]
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-subtle-foreground">
        {dims} dimensions
      </span>

      <pre className="font-mono text-xs whitespace-pre-wrap break-all max-h-48 overflow-auto">
        [{vector.join(", ")}]
      </pre>
    </div>
  );
}

const vectorRenderer: TypeRenderer = {
  renderCell(value: unknown) {
    const vec = parseVector(value);
    if (vec) {
      const preview = vec
        .slice(0, 4)
        .map((v) => v.toFixed(3))
        .join(", ");
      return (
        <span className="font-mono text-xs">
          [{preview}
          {vec.length > 4 ? `…${vec.length} dims` : ""}]
        </span>
      );
    }

    const str = stringify(value);
    if (str.length > 60) {
      return (
        <span className="font-mono text-xs" title={str}>
          {str.slice(0, 60)}…
        </span>
      );
    }

    return <span className="font-mono text-xs">{str}</span>;
  },

  renderCard(value: unknown) {
    const vec = parseVector(value);
    if (vec) {
      return <ExpandableVector vector={vec} />;
    }

    return (
      <pre className="font-mono text-xs whitespace-pre-wrap break-all">
        {stringify(value)}
      </pre>
    );
  },
};

export function registerPgVectorRenderers(): void {
  typeRegistry.register("vector", vectorRenderer);
}
