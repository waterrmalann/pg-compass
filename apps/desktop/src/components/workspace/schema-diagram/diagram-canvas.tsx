import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  DiagramEdge,
  DiagramModel,
  DiagramNode,
  Point,
} from "./diagram-model";
import { edgeGeometry, intersects, type EdgeGeometry } from "./geometry";
import { boundsOf } from "./layout";
import { TableNode, type TableNodeEmphasis } from "./table-node";
import {
  DETAIL_ZOOM,
  centerOn,
  fitBounds,
  snapRect,
  visibleCanvasRect,
  zoomAround,
  type Size,
  type Viewport,
} from "./viewport";

/** Screen pixels rendered beyond each edge of the view. */
const RENDER_MARGIN = 240;
/** Rendered tables only change when the view crosses this canvas grid. */
const RENDER_CELL = 1024;
/** Pointer travel (screen pixels) before a press becomes a drag. */
const DRAG_THRESHOLD = 3;
const BUTTON_ZOOM_STEP = 1.25;
const KEYBOARD_PAN_STEP = 64;
/** Zoom used when jumping to a table, unless already closer. */
const FOCUS_ZOOM = 0.9;
/** Dots are hidden below this zoom, where they would blur into a wash. */
const GRID_MIN_ZOOM = 0.3;
const GRID_SPACING = 20;

export interface DiagramCanvasHandle {
  fitView: () => void;
  /** Centre the view on a table. */
  focusTable: (key: string) => void;
}

interface DiagramCanvasProps {
  model: DiagramModel;
  positions: Map<string, Point>;
  /** The view fits the diagram whenever this changes (e.g. a new scope). */
  fitKey: string;
  showSchema: boolean;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onMoveTable: (key: string, position: Point) => void;
  onOpenTable: (node: DiagramNode) => void;
  ref?: Ref<DiagramCanvasHandle>;
}

type Gesture =
  | {
      kind: "pan";
      startPointer: Point;
      startViewport: Viewport;
      moved: boolean;
    }
  | {
      kind: "move";
      key: string;
      startPointer: Point;
      startPosition: Point;
      moved: boolean;
    };

interface PlacedEdge {
  edge: DiagramEdge;
  geometry: EdgeGeometry;
}

function useElementSize(ref: React.RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function emphasisFor(
  key: string,
  selectedKey: string | null,
  model: DiagramModel,
): TableNodeEmphasis {
  if (selectedKey === null) return "none";
  if (key === selectedKey) return "selected";
  const isRelated = model.neighbourKeys.get(selectedKey)?.has(key) ?? false;
  return isRelated ? "related" : "dimmed";
}

/**
 * Pan/zoom surface for the ER diagram. Only the tables and lines near the
 * view are rendered, so the DOM stays small however large the database is.
 */
export function DiagramCanvas({
  model,
  positions,
  fitKey,
  showSchema,
  selectedKey,
  onSelect,
  onMoveTable,
  onOpenTable,
  ref,
}: Readonly<DiagramCanvasProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const gestureRef = useRef<Gesture | null>(null);
  const fittedKeyRef = useRef<string | null>(null);
  // Read through a ref so the card handler stays stable while a card is
  // dragged; otherwise every memoised card would re-render on each move.
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const isMeasured = size.width > 0 && size.height > 0;

  const fitView = useCallback(() => {
    if (!isMeasured) return;
    setViewport(fitBounds(boundsOf(model.nodes, positions), size));
  }, [isMeasured, model.nodes, positions, size]);

  const focusTable = useCallback(
    (key: string) => {
      const node = model.nodeByKey.get(key);
      const position = positions.get(key);
      if (!node || !position || !isMeasured) return;
      const center = {
        x: position.x + node.width / 2,
        y: position.y + node.height / 2,
      };
      setViewport((current) =>
        centerOn(center, size, Math.max(current.zoom, FOCUS_ZOOM)),
      );
    },
    [isMeasured, model.nodeByKey, positions, size],
  );

  useImperativeHandle(ref, () => ({ fitView, focusTable }), [
    fitView,
    focusTable,
  ]);

  useEffect(
    function fitWhenScopeChanges() {
      if (!isMeasured || fittedKeyRef.current === fitKey) return;
      fittedKeyRef.current = fitKey;
      fitView();
    },
    [fitKey, fitView, isMeasured],
  );

  useEffect(function zoomWithWheel() {
    const container = containerRef.current;
    if (!container) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      // Pinch gestures arrive as ctrl+wheel with small deltas.
      const sensitivity = event.ctrlKey ? 0.01 : 0.0015;
      const factor = Math.exp(-event.deltaY * sensitivity);
      const rect = container!.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      setViewport((current) => zoomAround(current, factor, anchor));
    }
    // Non-passive so the page itself does not scroll.
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  function zoomFromCenter(factor: number) {
    const anchor = { x: size.width / 2, y: size.height / 2 };
    setViewport((current) => zoomAround(current, factor, anchor));
  }

  const handleTablePointerDown = useCallback(
    (key: string, event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const position = positionsRef.current.get(key);
      if (!position) return;
      gestureRef.current = {
        kind: "move",
        key,
        startPointer: { x: event.clientX, y: event.clientY },
        startPosition: position,
        moved: false,
      };
    },
    [],
  );

  function handleBackgroundPointerDown(event: ReactPointerEvent) {
    if (event.button !== 0) return;
    gestureRef.current = {
      kind: "pan",
      startPointer: { x: event.clientX, y: event.clientY },
      startViewport: viewport,
      moved: false,
    };
  }

  function handlePointerMove(event: ReactPointerEvent) {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const dx = event.clientX - gesture.startPointer.x;
    const dy = event.clientY - gesture.startPointer.y;
    if (!gesture.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      gesture.moved = true;
      // Capture only once dragging, so a plain click or double-click still
      // reaches the card under the pointer.
      containerRef.current?.setPointerCapture?.(event.pointerId);
    }

    if (gesture.kind === "pan") {
      const start = gesture.startViewport;
      setViewport({ ...start, x: start.x + dx, y: start.y + dy });
      return;
    }
    onMoveTable(gesture.key, {
      x: gesture.startPosition.x + dx / viewport.zoom,
      y: gesture.startPosition.y + dy / viewport.zoom,
    });
  }

  function handlePointerUp() {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || gesture.moved) return;
    // A press without a drag is a click.
    onSelect(gesture.kind === "move" ? gesture.key : null);
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    const pan = (dx: number, dy: number) =>
      setViewport((current) => ({
        ...current,
        x: current.x + dx,
        y: current.y + dy,
      }));
    const actions: Record<string, () => void> = {
      ArrowLeft: () => pan(KEYBOARD_PAN_STEP, 0),
      ArrowRight: () => pan(-KEYBOARD_PAN_STEP, 0),
      ArrowUp: () => pan(0, KEYBOARD_PAN_STEP),
      ArrowDown: () => pan(0, -KEYBOARD_PAN_STEP),
      "+": () => zoomFromCenter(BUTTON_ZOOM_STEP),
      "=": () => zoomFromCenter(BUTTON_ZOOM_STEP),
      "-": () => zoomFromCenter(1 / BUTTON_ZOOM_STEP),
      "0": fitView,
      Escape: () => onSelect(null),
      Enter: () => {
        const node = selectedKey ? model.nodeByKey.get(selectedKey) : undefined;
        if (node) onOpenTable(node);
      },
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  const renderRect = snapRect(
    visibleCanvasRect(viewport, size, RENDER_MARGIN),
    RENDER_CELL,
  );
  const {
    x: rectX,
    y: rectY,
    width: rectWidth,
    height: rectHeight,
  } = renderRect;

  const visibleNodes = useMemo(() => {
    if (!isMeasured) return [];
    const area = { x: rectX, y: rectY, width: rectWidth, height: rectHeight };
    return model.nodes.filter((node) => {
      const position = positions.get(node.key);
      if (!position) return false;
      const nodeRect = { ...position, width: node.width, height: node.height };
      return intersects(nodeRect, area);
    });
  }, [isMeasured, model.nodes, positions, rectX, rectY, rectWidth, rectHeight]);

  const placedEdges = useMemo<PlacedEdge[]>(() => {
    const placed: PlacedEdge[] = [];
    for (const edge of model.edges) {
      const source = model.nodeByKey.get(edge.sourceKey);
      const target = model.nodeByKey.get(edge.targetKey);
      const sourcePosition = positions.get(edge.sourceKey);
      const targetPosition = positions.get(edge.targetKey);
      if (!source || !target || !sourcePosition || !targetPosition) continue;
      const geometry = edgeGeometry(
        edge,
        source,
        sourcePosition,
        target,
        targetPosition,
      );
      placed.push({ edge, geometry });
    }
    return placed;
  }, [model.edges, model.nodeByKey, positions]);

  const visibleEdges = useMemo(() => {
    if (!isMeasured) return [];
    const area = { x: rectX, y: rectY, width: rectWidth, height: rectHeight };
    return placedEdges.filter((placed) =>
      intersects(placed.geometry.bounds, area),
    );
  }, [isMeasured, placedEdges, rectX, rectY, rectWidth, rectHeight]);

  const detailed = viewport.zoom >= DETAIL_ZOOM;
  const showGrid = viewport.zoom >= GRID_MIN_ZOOM;
  const gridSpacing = GRID_SPACING * viewport.zoom;

  return (
    // The canvas is a focusable pan/zoom surface driven by pointer and keys
    // (arrows, +/-, 0, Enter, Escape); `application` tells assistive tech
    // those keys belong to it, though jsx-a11y counts it as non-interactive.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={containerRef}
      role="application"
      aria-label="Schema diagram"
      aria-roledescription="diagram"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      data-zoom={viewport.zoom.toFixed(3)}
      className="relative h-full w-full cursor-default bg-background touch-none overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:cursor-grabbing"
      style={
        showGrid
          ? {
              backgroundImage:
                "radial-gradient(circle, var(--border) 1px, transparent 1px)",
              backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
              backgroundPosition: `${viewport.x}px ${viewport.y}px`,
            }
          : undefined
      }
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        <EdgeLayer edges={visibleEdges} selectedKey={selectedKey} />
        {visibleNodes.map((node) => (
          <TableNode
            key={node.key}
            node={node}
            position={positions.get(node.key)!}
            showSchema={showSchema}
            detailed={detailed}
            emphasis={emphasisFor(node.key, selectedKey, model)}
            foreignKeysByColumn={model.foreignKeysByColumn.get(node.key)}
            onPointerDown={handleTablePointerDown}
            onOpen={onOpenTable}
          />
        ))}
      </div>

      <ZoomControls
        zoom={viewport.zoom}
        onZoomIn={() => zoomFromCenter(BUTTON_ZOOM_STEP)}
        onZoomOut={() => zoomFromCenter(1 / BUTTON_ZOOM_STEP)}
        onFit={fitView}
      />
    </div>
  );
}

function EdgeLayer({
  edges,
  selectedKey,
}: Readonly<{ edges: PlacedEdge[]; selectedKey: string | null }>) {
  const isConnected = (edge: DiagramEdge) =>
    edge.sourceKey === selectedKey || edge.targetKey === selectedKey;
  // Highlighted lines are drawn last so they sit on top.
  const quiet = edges.filter((placed) => !isConnected(placed.edge));
  const highlighted = edges.filter((placed) => isConnected(placed.edge));
  const hasSelection = selectedKey !== null;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={1}
      height={1}
    >
      {quiet.map((placed) => (
        <EdgePath
          key={placed.edge.key}
          placed={placed}
          className={cn(
            "text-muted-foreground",
            hasSelection ? "opacity-15" : "opacity-50",
          )}
          strokeWidth={1.25}
        />
      ))}
      {highlighted.map((placed) => (
        <EdgePath
          key={placed.edge.key}
          placed={placed}
          className="text-foreground"
          strokeWidth={1.75}
        />
      ))}
    </svg>
  );
}

function EdgePath({
  placed,
  className,
  strokeWidth,
}: Readonly<{ placed: PlacedEdge; className: string; strokeWidth: number }>) {
  const { geometry, edge } = placed;
  return (
    <g className={className} data-diagram-edge={edge.foreignKey.name}>
      <path
        d={geometry.path}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={geometry.start.x}
        cy={geometry.start.y}
        r={3}
        fill="currentColor"
      />
      <circle
        cx={geometry.end.x}
        cy={geometry.end.y}
        r={3}
        fill="currentColor"
      />
    </g>
  );
}

function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
}: Readonly<{
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}>) {
  return (
    <div
      className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-xs/5"
      // Keep presses on the controls from starting a pan.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Zoom out"
        title="Zoom out (-)"
        onClick={onZoomOut}
      >
        <ZoomOut />
      </Button>
      <span className="w-10 text-center font-mono text-[11px] text-subtle-foreground tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Zoom in"
        title="Zoom in (+)"
        onClick={onZoomIn}
      >
        <ZoomIn />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Fit diagram to view"
        title="Fit to view (0)"
        onClick={onFit}
      >
        <Maximize />
      </Button>
    </div>
  );
}
