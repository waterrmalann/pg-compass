import {
  HEADER_HEIGHT,
  ROW_HEIGHT,
  type DiagramEdge,
  type DiagramNode,
  type Point,
  type Rect,
} from "./diagram-model";

/** How far a line runs straight out of a card before it starts to bend. */
const MIN_CURVE_OFFSET = 40;
/** Extra room around a line's end points that its curve can reach. */
const CURVE_REACH = 64;

export interface EdgeGeometry {
  path: string;
  start: Point;
  end: Point;
  /** Area the curve can cover, for viewport culling. */
  bounds: Rect;
}

/** Vertical centre of a column row, or of the header for row -1. */
export function rowCenterY(position: Point, row: number): number {
  if (row < 0) return position.y + HEADER_HEIGHT / 2;
  return position.y + HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function horizontalCurve(start: Point, end: Point, offset: number): string {
  const startControl = start.x + offset * Math.sign(end.x - start.x || 1);
  const endControl = end.x - offset * Math.sign(end.x - start.x || 1);
  return `M ${start.x} ${start.y} C ${startControl} ${start.y}, ${endControl} ${end.y}, ${end.x} ${end.y}`;
}

/** Both ends leave to the right and the curve bulges out past `outerX`. */
function rightLoop(start: Point, end: Point, outerX: number): string {
  return `M ${start.x} ${start.y} C ${outerX} ${start.y}, ${outerX} ${end.y}, ${end.x} ${end.y}`;
}

function boundsAround(start: Point, end: Point, extraX: number): Rect {
  const minX = Math.min(start.x, end.x) - CURVE_REACH;
  const maxX = Math.max(start.x, end.x) + Math.max(extraX, CURVE_REACH);
  const minY = Math.min(start.y, end.y) - CURVE_REACH;
  const maxY = Math.max(start.y, end.y) + CURVE_REACH;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * A line from the referencing column to the referenced column. It leaves the
 * side of each card that faces the other card. Cards that overlap
 * horizontally (one above the other, or the same card for a self-reference)
 * are joined by a loop on their right.
 */
export function edgeGeometry(
  edge: DiagramEdge,
  source: DiagramNode,
  sourcePosition: Point,
  target: DiagramNode,
  targetPosition: Point,
): EdgeGeometry {
  const sourceY = rowCenterY(sourcePosition, edge.sourceRow);
  const targetY = rowCenterY(targetPosition, edge.targetRow);
  const sourceRight = sourcePosition.x + source.width;
  const targetRight = targetPosition.x + target.width;

  const targetIsRight = targetPosition.x >= sourceRight;
  const targetIsLeft = targetRight <= sourcePosition.x;

  if (targetIsRight || targetIsLeft) {
    const start = {
      x: targetIsRight ? sourceRight : sourcePosition.x,
      y: sourceY,
    };
    const end = {
      x: targetIsRight ? targetPosition.x : targetRight,
      y: targetY,
    };
    const offset = Math.max(MIN_CURVE_OFFSET, Math.abs(end.x - start.x) / 2);
    return {
      path: horizontalCurve(start, end, offset),
      start,
      end,
      bounds: boundsAround(start, end, 0),
    };
  }

  const start = { x: sourceRight, y: sourceY };
  const end = { x: targetRight, y: targetY };
  const outerX = Math.max(sourceRight, targetRight) + MIN_CURVE_OFFSET;
  return {
    path: rightLoop(start, end, outerX),
    start,
    end,
    bounds: boundsAround(start, end, MIN_CURVE_OFFSET),
  };
}

export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}
