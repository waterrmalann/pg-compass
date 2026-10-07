import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Diamond,
  Fingerprint,
  KeyRound,
  Link2,
  Network,
  RotateCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";
import { Input, fieldClassName } from "@/components/ui/input";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { useLatestRequest } from "@/hooks/use-latest-request";
import { useWorkspace } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";
import type { DatabaseSchema } from "@/shared/types/connection";
import type { SchemaDiagram } from "@/shared/types/schema-diagram";
import type { DatabaseViewerPath } from "@/shared/types/workspace";
import { DiagramCanvas, type DiagramCanvasHandle } from "./diagram-canvas";
import {
  buildDiagramModel,
  type DiagramNode,
  type Point,
} from "./diagram-model";
import { layoutDiagram } from "./layout";

/** Scope value for every schema. Schema names cannot contain NUL. */
export const ALL_SCHEMAS = "\u0000all";

/**
 * The schema the diagram opens on: `public` when it has tables, otherwise
 * the schema with the most tables. Null when no schema has tables, so a
 * database without tables is never queried.
 */
export function defaultDiagramScope(schemas: DatabaseSchema[]): string | null {
  const publicSchema = schemas.find((schema) => schema.name === "public");
  if (publicSchema && publicSchema.tables.length > 0) return publicSchema.name;

  let largest: DatabaseSchema | null = null;
  for (const schema of schemas) {
    if (schema.tables.length === 0) continue;
    if (!largest || schema.tables.length > largest.tables.length) {
      largest = schema;
    }
  }
  return largest?.name ?? null;
}

/** The next table whose qualified name matches, after the selected one. */
export function findNextMatch(
  nodes: DiagramNode[],
  query: string,
  selectedKey: string | null,
): DiagramNode | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") return null;
  const matches = nodes.filter((node) => {
    const qualifiedName = `${node.table.schema}.${node.table.name}`;
    return qualifiedName.toLowerCase().includes(needle);
  });
  if (matches.length === 0) return null;
  const selectedIndex = matches.findIndex((node) => node.key === selectedKey);
  return matches[(selectedIndex + 1) % matches.length]!;
}

interface SchemaDiagramTabProps {
  path: DatabaseViewerPath;
  schemas: DatabaseSchema[];
  refreshSignal?: number;
  onRefreshComplete?: (success: boolean) => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  /** `scopeKey` is the scope this diagram was loaded for. */
  | { status: "ready"; diagram: SchemaDiagram; scopeKey: string };

export function SchemaDiagramTab({
  path,
  schemas,
  refreshSignal = 0,
  onRefreshComplete,
}: Readonly<SchemaDiagramTabProps>) {
  const { openTab } = useWorkspace();
  const runLatestRequest = useLatestRequest();
  const canvasRef = useRef<DiagramCanvasHandle>(null);

  const schemaNames = useMemo(
    () => schemas.map((schema) => schema.name),
    [schemas],
  );
  const defaultScope = defaultDiagramScope(schemas);
  const [chosenScope, setChosenScope] = useState<string | null>(null);
  const isChosenScopeValid =
    chosenScope === ALL_SCHEMAS ||
    (chosenScope !== null && schemaNames.includes(chosenScope));
  const scope = isChosenScopeValid ? chosenScope : defaultScope;

  // A string key, so a refreshed schema list with the same names does not
  // trigger another load.
  const scopeKey = useMemo(() => {
    if (scope === null) return null;
    const scopeSchemas = scope === ALL_SCHEMAS ? schemaNames : [scope];
    return JSON.stringify(scopeSchemas);
  }, [schemaNames, scope]);

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [retryCount, setRetryCount] = useState(0);
  const [movedPositions, setMovedPositions] = useState<Map<string, Point>>(
    () => new Map(),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [findMissed, setFindMissed] = useState(false);

  const load = useCallback(
    async (requestedScopeKey: string): Promise<boolean> => {
      // A refresh keeps the current diagram on screen; a new scope does not.
      setLoadState((current) => {
        const isRefresh =
          current.status === "ready" && current.scopeKey === requestedScopeKey;
        return isRefresh ? current : { status: "loading" };
      });
      const request = await runLatestRequest(() =>
        globalThis.window.connectionApi.getSchemaDiagram({
          connectionId: path.connectionId,
          schemas: JSON.parse(requestedScopeKey) as string[],
        }),
      );
      if (request.status === "stale") return false;

      function fail(message: string): false {
        setLoadState({ status: "error", message });
        toast.error("Failed to load the diagram", { description: message });
        return false;
      }
      if (request.status === "error") {
        return fail((request.error as Error).message);
      }
      const result = request.value;
      if (!result.success || !result.data) {
        return fail(result.error ?? "Unknown error");
      }
      setLoadState({
        status: "ready",
        diagram: result.data,
        scopeKey: requestedScopeKey,
      });
      return true;
    },
    [path.connectionId, runLatestRequest],
  );

  useEffect(
    function loadDiagram() {
      if (scopeKey === null) return;
      void load(scopeKey).then((success) => {
        if (refreshSignal > 0) onRefreshComplete?.(success);
      });
    },
    // retryCount re-runs the load after an error.
    [load, onRefreshComplete, refreshSignal, retryCount, scopeKey],
  );

  useEffect(
    function reportRefreshWithoutTables() {
      if (scopeKey === null && refreshSignal > 0) onRefreshComplete?.(true);
    },
    [onRefreshComplete, refreshSignal, scopeKey],
  );

  const diagram = loadState.status === "ready" ? loadState.diagram : null;
  const model = useMemo(
    () => (diagram ? buildDiagramModel(diagram) : null),
    [diagram],
  );
  const layout = useMemo(() => (model ? layoutDiagram(model) : null), [model]);

  const positions = useMemo(() => {
    const merged = new Map(layout?.positions);
    for (const [key, point] of movedPositions) {
      if (merged.has(key)) merged.set(key, point);
    }
    return merged;
  }, [layout, movedPositions]);

  const effectiveSelectedKey =
    selectedKey !== null && model?.nodeByKey.has(selectedKey)
      ? selectedKey
      : null;

  const handleMoveTable = useCallback((key: string, point: Point) => {
    setMovedPositions((current) => new Map(current).set(key, point));
  }, []);

  const handleOpenTable = useCallback(
    (node: DiagramNode) => {
      openTab({
        type: "table-details",
        path: {
          connectionId: path.connectionId,
          connectionLabel: path.connectionLabel,
          schemaName: node.table.schema,
          tableName: node.table.name,
        },
      }).catch(() => undefined);
    },
    [openTab, path.connectionId, path.connectionLabel],
  );

  function handleFind(event: FormEvent) {
    event.preventDefault();
    if (!model) return;
    const match = findNextMatch(model.nodes, findQuery, effectiveSelectedKey);
    setFindMissed(match === null && findQuery.trim() !== "");
    if (!match) return;
    setSelectedKey(match.key);
    canvasRef.current?.focusTable(match.key);
  }

  function handleScopeChange(value: string) {
    setChosenScope(value);
    setSelectedKey(null);
  }

  if (scope === null) {
    return (
      <Panel className="h-full">
        <EmptyState icon={<Network />} title="No tables in this database." />
      </Panel>
    );
  }

  const tableCount = model?.nodes.length ?? 0;
  const relationshipCount = model?.edges.length ?? 0;
  const hasMovedTables = movedPositions.size > 0;

  return (
    <Panel className="h-full">
      <PanelHeader className="flex-wrap gap-y-1.5">
        <Network />
        <select
          aria-label="Diagram schema"
          className={cn(fieldClassName, "h-7 w-auto max-w-56 px-2 text-xs")}
          value={scope}
          onChange={(event) => handleScopeChange(event.target.value)}
        >
          <option value={ALL_SCHEMAS}>All schemas</option>
          {schemaNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {model ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatCount(tableCount, "table")} ·{" "}
            {formatCount(relationshipCount, "relationship")}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {hasMovedTables ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setMovedPositions(new Map())}
            >
              <RotateCcw />
              Reset layout
            </Button>
          ) : null}
          <form role="search" onSubmit={handleFind} className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Find table"
              aria-invalid={findMissed || undefined}
              placeholder="Find table"
              value={findQuery}
              onChange={(event) => {
                setFindQuery(event.target.value);
                setFindMissed(false);
              }}
              disabled={!model || tableCount === 0}
              className="h-7 w-48 pl-7 text-xs"
            />
          </form>
        </div>
      </PanelHeader>

      <div className="relative min-h-0 flex-1">
        <DiagramBody
          loadState={loadState}
          isEmpty={tableCount === 0}
          onRetry={() => setRetryCount((count) => count + 1)}
        >
          {model ? (
            <DiagramCanvas
              ref={canvasRef}
              model={model}
              positions={positions}
              // Fit once the new scope's data is here, not when it is asked
              // for: fitting earlier would fit the previous diagram.
              fitKey={loadState.status === "ready" ? loadState.scopeKey : ""}
              showSchema={scope === ALL_SCHEMAS}
              selectedKey={effectiveSelectedKey}
              onSelect={setSelectedKey}
              onMoveTable={handleMoveTable}
              onOpenTable={handleOpenTable}
            />
          ) : null}
        </DiagramBody>
      </div>

      <PanelFooter className="flex-wrap gap-x-4 gap-y-1">
        <Legend />
        <span className="ml-auto">
          Drag to pan, scroll to zoom, double-click a table to open it.
        </span>
      </PanelFooter>
    </Panel>
  );
}

function formatCount(count: number, noun: string): string {
  const formatted = new Intl.NumberFormat().format(count);
  return `${formatted} ${noun}${count === 1 ? "" : "s"}`;
}

function DiagramBody({
  loadState,
  isEmpty,
  onRetry,
  children,
}: Readonly<{
  loadState: LoadState;
  isEmpty: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}>) {
  if (loadState.status === "loading") {
    return <LoadingState label="Loading diagram" />;
  }
  if (loadState.status === "error") {
    return (
      <EmptyState
        icon={<Network />}
        title="Couldn't load the diagram."
        description={loadState.message}
      >
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </EmptyState>
    );
  }
  if (isEmpty) {
    return <EmptyState icon={<Network />} title="No tables in this schema." />;
  }
  return children;
}

const LEGEND_ITEMS = [
  { icon: KeyRound, label: "Primary key" },
  { icon: Link2, label: "Foreign key" },
  { icon: Fingerprint, label: "Unique" },
  { icon: Diamond, label: "Nullable" },
] as const;

function Legend() {
  return (
    <ul aria-label="Legend" className="flex items-center gap-3">
      {LEGEND_ITEMS.map(({ icon: Icon, label }) => (
        <li key={label} className="flex items-center gap-1">
          <Icon aria-hidden className="size-3" />
          {label}
        </li>
      ))}
    </ul>
  );
}
