import { describe, expect, it } from "vitest";
import {
  HEADER_HEIGHT,
  NODE_WIDTH,
  ROW_HEIGHT,
  buildDiagramModel,
  nodeHeight,
  tableKey,
  type DiagramModel,
  type Point,
} from "@/components/workspace/schema-diagram/diagram-model";
import {
  boundsOf,
  layoutDiagram,
} from "@/components/workspace/schema-diagram/layout";
import type {
  DiagramForeignKey,
  DiagramTable,
  SchemaDiagram,
} from "@/shared/types/schema-diagram";

function table(name: string, columns = ["id"], schema = "app"): DiagramTable {
  return {
    schema,
    name,
    columns: columns.map((column, index) => ({
      name: column,
      dataType: "integer",
      isNullable: index > 0,
      isPrimaryKey: index === 0,
      isUnique: false,
    })),
  };
}

function reference(
  source: string,
  target: string,
  sourceColumn = `${target}_id`,
  schema = "app",
): DiagramForeignKey {
  return {
    name: `${source}_${sourceColumn}_fkey`,
    sourceSchema: schema,
    sourceTable: source,
    sourceColumns: [sourceColumn],
    targetSchema: schema,
    targetTable: target,
    targetColumns: ["id"],
  };
}

function key(name: string, schema = "app") {
  return tableKey(schema, name);
}

function expectNoOverlaps(model: DiagramModel, positions: Map<string, Point>) {
  const rects = model.nodes.map((node) => ({
    key: node.key,
    ...positions.get(node.key)!,
    width: node.width,
    height: node.height,
  }));
  // Sweep by x so large layouts stay fast.
  rects.sort((a, b) => a.x - b.x);
  for (let i = 0; i < rects.length; i += 1) {
    const a = rects[i]!;
    for (let j = i + 1; j < rects.length; j += 1) {
      const b = rects[j]!;
      if (b.x >= a.x + a.width) break;
      const overlaps = a.y < b.y + b.height && b.y < a.y + a.height;
      if (overlaps) {
        throw new Error(`${a.key} overlaps ${b.key}`);
      }
    }
  }
}

/** A random-but-repeatable schema shaped like real databases. */
function generateDiagram(tableCount: number): SchemaDiagram {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const tables: DiagramTable[] = [];
  const foreignKeys: DiagramForeignKey[] = [];
  for (let index = 0; index < tableCount; index += 1) {
    const name = `t${index}`;
    const columns = ["id", "name"];
    if (index > 0 && index % 6 !== 0) {
      const target = Math.floor(random() * index);
      columns.push(`t${target}_id`);
      foreignKeys.push(reference(name, `t${target}`));
    }
    if (index % 23 === 0) {
      columns.push("parent_id");
      foreignKeys.push(reference(name, name, "parent_id"));
    }
    tables.push(table(name, columns));
  }
  return { tables, foreignKeys };
}

describe("diagram model", () => {
  it("builds keys that cannot collide on dotted names", () => {
    expect(tableKey("a.b", "c")).not.toBe(tableKey("a", "b.c"));
  });

  it("sizes cards from their column count, with one row for no columns", () => {
    expect(nodeHeight(table("t", ["a", "b", "c"]))).toBe(
      HEADER_HEIGHT + 3 * ROW_HEIGHT + 4,
    );
    expect(nodeHeight(table("t", []))).toBe(HEADER_HEIGHT + ROW_HEIGHT + 4);
  });

  it("turns foreign keys between shown tables into edges anchored on their columns", () => {
    const model = buildDiagramModel({
      tables: [
        table("users", ["id", "email"]),
        table("orders", ["id", "note", "users_id"]),
      ],
      foreignKeys: [reference("orders", "users")],
    });

    expect(model.edges).toHaveLength(1);
    expect(model.edges[0]).toMatchObject({
      sourceKey: key("orders"),
      targetKey: key("users"),
      sourceRow: 2,
      targetRow: 0,
    });
    expect(model.neighbourKeys.get(key("users"))).toEqual(
      new Set([key("orders")]),
    );
    expect(model.neighbourKeys.get(key("orders"))).toEqual(
      new Set([key("users")]),
    );
  });

  it("keeps the column marker but no edge for a key into another schema", () => {
    const outward = {
      ...reference("orders", "accounts"),
      targetSchema: "billing",
    };
    const model = buildDiagramModel({
      tables: [table("orders", ["id", "accounts_id"])],
      foreignKeys: [outward],
    });

    expect(model.edges).toEqual([]);
    expect(
      model.foreignKeysByColumn.get(key("orders"))?.get("accounts_id"),
    ).toBe(outward);
  });

  it("anchors to the header when a key column is not among the columns", () => {
    const model = buildDiagramModel({
      tables: [table("users"), table("orders", ["id"])],
      foreignKeys: [reference("orders", "users", "missing")],
    });
    expect(model.edges[0]?.sourceRow).toBe(-1);
  });
});

describe("layoutDiagram", () => {
  it("places referenced tables left of the tables that reference them", () => {
    const model = buildDiagramModel({
      tables: [
        table("order_items", ["id", "orders_id", "products_id"]),
        table("orders", ["id", "users_id"]),
        table("products"),
        table("users"),
      ],
      foreignKeys: [
        reference("order_items", "orders"),
        reference("order_items", "products"),
        reference("orders", "users"),
      ],
    });
    const { positions } = layoutDiagram(model);
    const x = (name: string) => positions.get(key(name))!.x;

    expect(x("users")).toBeLessThan(x("orders"));
    expect(x("orders")).toBeLessThan(x("order_items"));
    expect(x("products")).toBeLessThan(x("order_items"));
    expectNoOverlaps(model, positions);
  });

  it("places every table when foreign keys form cycles and self-references", () => {
    const model = buildDiagramModel({
      tables: [
        table("a", ["id", "c_id"]),
        table("b", ["id", "a_id"]),
        table("c", ["id", "b_id"]),
        table("employees", ["id", "parent_id"]),
      ],
      foreignKeys: [
        reference("b", "a"),
        reference("c", "b"),
        reference("a", "c"),
        reference("employees", "employees", "parent_id"),
      ],
    });
    const { positions } = layoutDiagram(model);

    expect(positions.size).toBe(4);
    expectNoOverlaps(model, positions);
  });

  it("gives the same layout for the same input", () => {
    const diagram = generateDiagram(120);
    const first = layoutDiagram(buildDiagramModel(diagram));
    const second = layoutDiagram(buildDiagramModel(diagram));
    expect([...second.positions]).toEqual([...first.positions]);
  });

  it("wraps a long chain of references instead of laying it out in one row", () => {
    const tables = Array.from({ length: 80 }, (_, index) =>
      table(`t${index}`, ["id", `t${index - 1}_id`]),
    );
    const foreignKeys = tables
      .slice(1)
      .map((_, index) => reference(`t${index + 1}`, `t${index}`));
    const model = buildDiagramModel({ tables, foreignKeys });

    const { bounds, positions } = layoutDiagram(model);

    const unwrappedWidth = 80 * NODE_WIDTH;
    expect(bounds.width).toBeLessThan(unwrappedWidth / 3);
    expect(bounds.width / bounds.height).toBeLessThan(6);
    expectNoOverlaps(model, positions);
  });

  it("wraps a heavily referenced table's children into several columns", () => {
    const children = Array.from({ length: 300 }, (_, index) =>
      table(`child_${index}`, ["id", "hub_id"]),
    );
    const model = buildDiagramModel({
      tables: [table("hub"), ...children],
      foreignKeys: children.map((child) => reference(child.name, "hub")),
    });

    const { bounds, positions } = layoutDiagram(model);

    const childXs = new Set(
      children.map((child) => positions.get(key(child.name))!.x),
    );
    expect(childXs.size).toBeGreaterThan(3);
    expect(bounds.height).toBeLessThan((300 * nodeHeight(children[0]!)) / 3);
    expectNoOverlaps(model, positions);
  });

  it("packs unrelated tables into a compact block", () => {
    const tables = Array.from({ length: 100 }, (_, index) =>
      table(`lonely_${index}`),
    );
    const model = buildDiagramModel({ tables, foreignKeys: [] });

    const { bounds, positions } = layoutDiagram(model);

    expect(bounds.width / bounds.height).toBeLessThan(4);
    expect(bounds.height / bounds.width).toBeLessThan(4);
    expectNoOverlaps(model, positions);
  });

  it("lays out thousands of tables quickly and without overlaps", () => {
    const model = buildDiagramModel(generateDiagram(3000));

    const started = performance.now();
    const { positions, bounds } = layoutDiagram(model);
    const elapsed = performance.now() - started;

    expect(positions.size).toBe(3000);
    expect(elapsed).toBeLessThan(2000);
    expect(boundsOf(model.nodes, positions)).toEqual(bounds);
    expectNoOverlaps(model, positions);
  });

  it("returns empty bounds for an empty diagram", () => {
    const layout = layoutDiagram(
      buildDiagramModel({ tables: [], foreignKeys: [] }),
    );
    expect(layout.positions.size).toBe(0);
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
