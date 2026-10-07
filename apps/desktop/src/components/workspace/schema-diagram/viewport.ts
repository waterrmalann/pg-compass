import type { Point, Rect } from "./diagram-model";

/** Screen = canvas * zoom + (x, y). */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 1.5;
/** Below this zoom, cards show only their name. */
export const DETAIL_ZOOM = 0.45;
const FIT_PADDING = 48;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Zoom by `factor` while keeping the canvas point under `anchor` still. */
export function zoomAround(
  viewport: Viewport,
  factor: number,
  anchor: Point,
): Viewport {
  const zoom = clampZoom(viewport.zoom * factor);
  const canvasX = (anchor.x - viewport.x) / viewport.zoom;
  const canvasY = (anchor.y - viewport.y) / viewport.zoom;
  return { x: anchor.x - canvasX * zoom, y: anchor.y - canvasY * zoom, zoom };
}

/** Show all of `bounds`, centred, never zooming in past 100%. */
export function fitBounds(bounds: Rect, size: Size): Viewport {
  const availableWidth = Math.max(size.width - FIT_PADDING * 2, 1);
  const availableHeight = Math.max(size.height - FIT_PADDING * 2, 1);
  const fittedZoom = Math.min(
    availableWidth / Math.max(bounds.width, 1),
    availableHeight / Math.max(bounds.height, 1),
    1,
  );
  const zoom = clampZoom(fittedZoom);
  return centerOn(
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    size,
    zoom,
  );
}

/** Put the canvas point `center` in the middle of the screen. */
export function centerOn(center: Point, size: Size, zoom: number): Viewport {
  return {
    x: size.width / 2 - center.x * zoom,
    y: size.height / 2 - center.y * zoom,
    zoom,
  };
}

/** The canvas area on screen, grown by `margin` screen pixels on each side. */
export function visibleCanvasRect(
  viewport: Viewport,
  size: Size,
  margin: number,
): Rect {
  return {
    x: (-viewport.x - margin) / viewport.zoom,
    y: (-viewport.y - margin) / viewport.zoom,
    width: (size.width + margin * 2) / viewport.zoom,
    height: (size.height + margin * 2) / viewport.zoom,
  };
}

/**
 * Snap a rectangle outwards to a grid, so small pans give the same result
 * and the rendered tables only change when the view crosses a grid line.
 */
export function snapRect(rect: Rect, cell: number): Rect {
  const x = Math.floor(rect.x / cell) * cell;
  const y = Math.floor(rect.y / cell) * cell;
  const right = Math.ceil((rect.x + rect.width) / cell) * cell;
  const bottom = Math.ceil((rect.y + rect.height) / cell) * cell;
  return { x, y, width: right - x, height: bottom - y };
}
