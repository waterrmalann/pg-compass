import { describe, expect, it } from "vitest";
import {
  HEADER_HEIGHT,
  NODE_WIDTH,
  ROW_HEIGHT,
  type DiagramEdge,
  type DiagramNode,
} from "@/components/workspace/schema-diagram/diagram-model";
import {
  edgeGeometry,
  intersects,
  rowCenterY,
} from "@/components/workspace/schema-diagram/geometry";
import { shortTypeName } from "@/components/workspace/schema-diagram/short-type-name";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitBounds,
  snapRect,
  visibleCanvasRect,
  zoomAround,
} from "@/components/workspace/schema-diagram/viewport";

function node(key: string): DiagramNode {
  return {
    key,
    table: { schema: "app", name: key, columns: [] },
    width: NODE_WIDTH,
    height: 200,
  };
}

function edge(sourceKey: string, targetKey: string): DiagramEdge {
  return {
    key: `${sourceKey}->${targetKey}`,
    foreignKey: {
      name: "fk",
      sourceSchema: "app",
      sourceTable: sourceKey,
      sourceColumns: ["x"],
      targetSchema: "app",
      targetTable: targetKey,
      targetColumns: ["id"],
    },
    sourceKey,
    targetKey,
    sourceRow: 2,
    targetRow: 0,
  };
}

describe("edgeGeometry", () => {
  const source = node("orders");
  const target = node("users");

  it("anchors on the middle of the column rows, or the header for row -1", () => {
    const position = { x: 0, y: 100 };
    expect(rowCenterY(position, 0)).toBe(100 + HEADER_HEIGHT + ROW_HEIGHT / 2);
    expect(rowCenterY(position, 2)).toBe(
      100 + HEADER_HEIGHT + 2 * ROW_HEIGHT + ROW_HEIGHT / 2,
    );
    expect(rowCenterY(position, -1)).toBe(100 + HEADER_HEIGHT / 2);
  });

  it("runs from the facing sides when the target is to the right", () => {
    const geometry = edgeGeometry(
      edge("orders", "users"),
      source,
      { x: 0, y: 0 },
      target,
      { x: 600, y: 300 },
    );
    expect(geometry.start).toEqual({
      x: NODE_WIDTH,
      y: rowCenterY({ x: 0, y: 0 }, 2),
    });
    expect(geometry.end).toEqual({
      x: 600,
      y: rowCenterY({ x: 600, y: 300 }, 0),
    });
    expect(geometry.path.startsWith(`M ${NODE_WIDTH} `)).toBe(true);
  });

  it("runs from the facing sides when the target is to the left", () => {
    const geometry = edgeGeometry(
      edge("orders", "users"),
      source,
      { x: 600, y: 0 },
      target,
      { x: 0, y: 0 },
    );
    expect(geometry.start.x).toBe(600);
    expect(geometry.end.x).toBe(NODE_WIDTH);
  });

  it("loops out on the right when the cards are stacked", () => {
    const geometry = edgeGeometry(
      edge("orders", "users"),
      source,
      { x: 0, y: 400 },
      target,
      { x: 100, y: 0 },
    );
    expect(geometry.start.x).toBe(NODE_WIDTH);
    expect(geometry.end.x).toBe(100 + NODE_WIDTH);
    // The loop reaches past both right edges, and the bounds cover it.
    expect(geometry.bounds.x + geometry.bounds.width).toBeGreaterThan(
      100 + NODE_WIDTH + 40,
    );
  });

  it("draws a self-reference as a loop on the card's right", () => {
    const employees = node("employees");
    const selfEdge = { ...edge("employees", "employees"), sourceRow: 3 };
    const geometry = edgeGeometry(
      selfEdge,
      employees,
      { x: 0, y: 0 },
      employees,
      { x: 0, y: 0 },
    );
    expect(geometry.start.x).toBe(NODE_WIDTH);
    expect(geometry.end.x).toBe(NODE_WIDTH);
    expect(geometry.start.y).toBeGreaterThan(geometry.end.y);
  });
});

describe("intersects", () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  it("detects overlap and treats touching edges as apart", () => {
    expect(intersects(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(intersects(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(intersects(a, { x: 0, y: 20, width: 10, height: 10 })).toBe(false);
  });
});

describe("viewport", () => {
  it("keeps the point under the anchor still while zooming", () => {
    const viewport = { x: 30, y: -40, zoom: 0.8 };
    const anchor = { x: 200, y: 150 };
    const before = {
      x: (anchor.x - viewport.x) / viewport.zoom,
      y: (anchor.y - viewport.y) / viewport.zoom,
    };

    const zoomed = zoomAround(viewport, 1.5, anchor);

    expect(zoomed.zoom).toBeCloseTo(1.2);
    expect((anchor.x - zoomed.x) / zoomed.zoom).toBeCloseTo(before.x);
    expect((anchor.y - zoomed.y) / zoomed.zoom).toBeCloseTo(before.y);
  });

  it("clamps zoom to its limits", () => {
    const anchor = { x: 0, y: 0 };
    expect(zoomAround({ x: 0, y: 0, zoom: 1 }, 100, anchor).zoom).toBe(
      MAX_ZOOM,
    );
    expect(zoomAround({ x: 0, y: 0, zoom: 1 }, 0.0001, anchor).zoom).toBe(
      MIN_ZOOM,
    );
  });

  it("fits and centres the diagram without zooming in past 100%", () => {
    const size = { width: 1000, height: 600 };

    const small = fitBounds({ x: 0, y: 0, width: 100, height: 100 }, size);
    expect(small.zoom).toBe(1);
    expect(small.x + 50 * small.zoom).toBe(500);
    expect(small.y + 50 * small.zoom).toBe(300);

    const wide = fitBounds({ x: 0, y: 0, width: 9040, height: 100 }, size);
    expect(wide.zoom).toBeCloseTo((1000 - 96) / 9040);

    const huge = fitBounds({ x: 0, y: 0, width: 1e7, height: 1e7 }, size);
    expect(huge.zoom).toBe(MIN_ZOOM);
  });

  it("maps the screen back to a canvas rectangle with a margin", () => {
    const rect = visibleCanvasRect(
      { x: -200, y: 100, zoom: 0.5 },
      { width: 800, height: 400 },
      40,
    );
    expect(rect).toEqual({ x: 320, y: -280, width: 1760, height: 960 });
  });

  it("snaps a rectangle outward to the grid", () => {
    const snapped = snapRect({ x: 130, y: -20, width: 100, height: 50 }, 100);
    expect(snapped).toEqual({ x: 100, y: -100, width: 200, height: 200 });
  });
});

describe("shortTypeName", () => {
  it.each([
    ["timestamp with time zone", "timestamptz"],
    ["timestamp without time zone", "timestamp"],
    ["timestamp(3) with time zone", "timestamptz(3)"],
    ["time(6) without time zone[]", "time(6)[]"],
    ["character varying(255)", "varchar(255)"],
    ["character varying[]", "varchar[]"],
    ["character(2)", "char(2)"],
    ["double precision", "float8"],
    ["bit varying(8)", "varbit(8)"],
  ])("shortens %s to %s", (input, expected) => {
    expect(shortTypeName(input)).toBe(expected);
  });

  it.each(["integer", "numeric(12,2)", "app.user_role[]", "characteristic"])(
    "leaves %s unchanged",
    (input) => {
      expect(shortTypeName(input)).toBe(input);
    },
  );
});
