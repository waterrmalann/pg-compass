import { Badge } from "@/components/ui/badge";
import { typeRegistry, type TypeRenderer } from "./type-registry";
import { stringify } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Null renderer
// ---------------------------------------------------------------------------

const nullRenderer: TypeRenderer = {
  renderCell() {
    return <span className="text-muted-foreground">null</span>;
  },
  renderCard() {
    return <span className="text-muted-foreground">null</span>;
  },
};

// ---------------------------------------------------------------------------
// Text types
// ---------------------------------------------------------------------------

const textRenderer: TypeRenderer = {
  renderCell(value: unknown) {
    const str = stringify(value);
    if (str.length > 200) {
      return <span title={str}>{str.slice(0, 200)}…</span>;
    }
    return str;
  },
  renderCard(value: unknown) {
    return (
      <span className="break-all whitespace-pre-wrap">{stringify(value)}</span>
    );
  },
};

// ---------------------------------------------------------------------------
// Numeric types
// ---------------------------------------------------------------------------

const numericRenderer: TypeRenderer = {
  renderCell(value: unknown) {
    return <span className="tabular-nums">{stringify(value)}</span>;
  },
  renderCard(value: unknown) {
    return <span className="tabular-nums">{stringify(value)}</span>;
  },
};

// ---------------------------------------------------------------------------
// Boolean type
// ---------------------------------------------------------------------------

const booleanRenderer: TypeRenderer = {
  renderCell(value: unknown) {
    const bool = Boolean(value);
    return (
      <Badge variant={bool ? "default" : "outline"} className="font-mono">
        {bool ? "true" : "false"}
      </Badge>
    );
  },
  renderCard(value: unknown) {
    const bool = Boolean(value);
    return (
      <Badge variant={bool ? "default" : "outline"} className="font-mono">
        {bool ? "true" : "false"}
      </Badge>
    );
  },
};

// ---------------------------------------------------------------------------
// Date / Time types
// ---------------------------------------------------------------------------

const dateRenderer: TypeRenderer = {
  renderCell(value: unknown) {
    if (value instanceof Date) {
      return <span className="tabular-nums">{value.toISOString()}</span>;
    }
    return <span className="tabular-nums">{stringify(value)}</span>;
  },
  renderCard(value: unknown) {
    if (value instanceof Date) {
      return <span className="tabular-nums">{value.toISOString()}</span>;
    }
    return <span className="tabular-nums">{stringify(value)}</span>;
  },
};

// ---------------------------------------------------------------------------
// JSON / JSONB types — compact in cell, tree-expandable in card
// ---------------------------------------------------------------------------

const jsonRenderer: TypeRenderer = {
  renderCell(value: unknown) {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    if (str.length > 100) {
      return (
        <span className="font-mono text-xs" title={str}>
          {str.slice(0, 100)}…
        </span>
      );
    }
    return <span className="font-mono text-xs">{str}</span>;
  },
  renderCard(value: unknown) {
    // Card view uses the JsonTree component; signal to callers
    // that this is a structured value by returning the raw value.
    // The CardDataView component handles tree rendering for objects/arrays.
    const str =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return (
      <pre className="font-mono text-xs whitespace-pre-wrap break-all">
        {str}
      </pre>
    );
  },
};

// ---------------------------------------------------------------------------
// Array types (PostgreSQL arrays prefixed with underscore)
// ---------------------------------------------------------------------------

const arrayRenderer: TypeRenderer = {
  renderCell(value: unknown) {
    if (Array.isArray(value)) {
      return (
        <span className="font-mono text-xs text-muted-foreground">
          [{value.length} items]
        </span>
      );
    }
    return <span className="font-mono text-xs">{stringify(value)}</span>;
  },
  renderCard(value: unknown) {
    if (Array.isArray(value)) {
      const str = JSON.stringify(value, null, 2);
      return (
        <pre className="font-mono text-xs whitespace-pre-wrap break-all">
          {str}
        </pre>
      );
    }
    return <span className="font-mono text-xs">{stringify(value)}</span>;
  },
};

// ---------------------------------------------------------------------------
// UUID
// ---------------------------------------------------------------------------

const uuidRenderer: TypeRenderer = {
  renderCell(value: unknown) {
    return <span className="font-mono text-xs">{stringify(value)}</span>;
  },
  renderCard(value: unknown) {
    return (
      <span className="font-mono text-xs select-all">{stringify(value)}</span>
    );
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDefaultRenderers(): void {
  // Null is handled inline (check value before calling renderer),
  // but register for completeness.
  typeRegistry.register("__null__", nullRenderer);

  // Text types
  typeRegistry.registerMany(
    ["text", "varchar", "char", "bpchar", "name", "citext", "xml"],
    textRenderer,
  );

  // Numeric types
  typeRegistry.registerMany(
    ["int2", "int4", "int8", "float4", "float8", "numeric", "money", "oid"],
    numericRenderer,
  );

  // Boolean
  typeRegistry.register("bool", booleanRenderer);

  // Date / Time
  typeRegistry.registerMany(
    ["date", "time", "timetz", "timestamp", "timestamptz", "interval"],
    dateRenderer,
  );

  // JSON / JSONB
  typeRegistry.registerMany(["json", "jsonb"], jsonRenderer);

  // UUID
  typeRegistry.register("uuid", uuidRenderer);

  // Common array types (PG prefixes arrays with _)
  typeRegistry.registerMany(
    [
      "_text",
      "_varchar",
      "_int4",
      "_int8",
      "_float4",
      "_float8",
      "_bool",
      "_uuid",
      "_json",
      "_jsonb",
      "_timestamp",
      "_timestamptz",
      "_numeric",
    ],
    arrayRenderer,
  );
}
