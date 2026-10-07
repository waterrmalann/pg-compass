import type {
  DiagramForeignKey,
  DiagramTable,
  SchemaDiagram,
} from "@/shared/types/schema-diagram";

// Card metrics in canvas pixels. The card renders with these exact sizes so
// relationship lines can be anchored to a column row without measuring the DOM.
export const NODE_WIDTH = 264;
export const HEADER_HEIGHT = 36;
export const ROW_HEIGHT = 24;
export const NODE_BOTTOM_PADDING = 4;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramNode {
  key: string;
  table: DiagramTable;
  width: number;
  height: number;
}

export interface DiagramEdge {
  key: string;
  foreignKey: DiagramForeignKey;
  sourceKey: string;
  targetKey: string;
  /** Row of the first referencing column, or -1 to anchor at the header. */
  sourceRow: number;
  /** Row of the first referenced column, or -1 to anchor at the header. */
  targetRow: number;
}

export interface DiagramModel {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  nodeByKey: Map<string, DiagramNode>;
  /** Keys of the tables each table is directly related to (both directions). */
  neighbourKeys: Map<string, Set<string>>;
  /**
   * Per table, the foreign key each referencing column belongs to, including
   * keys whose referenced table is outside the snapshot.
   */
  foreignKeysByColumn: Map<string, Map<string, DiagramForeignKey>>;
}

/** Identity of a table on the canvas. Collision-free for any names. */
export function tableKey(schema: string, name: string): string {
  return JSON.stringify([schema, name]);
}

export function nodeHeight(table: DiagramTable): number {
  // A table without columns still shows one "No columns" row.
  const rowCount = Math.max(table.columns.length, 1);
  return HEADER_HEIGHT + rowCount * ROW_HEIGHT + NODE_BOTTOM_PADDING;
}

function columnRow(
  table: DiagramTable,
  columnName: string | undefined,
): number {
  if (columnName === undefined) return -1;
  return table.columns.findIndex((column) => column.name === columnName);
}

/**
 * Turn a catalog snapshot into canvas nodes and edges. A foreign key becomes
 * an edge only when both of its tables are in the snapshot; one that points
 * at another schema stays visible as the column's foreign-key marker.
 */
export function buildDiagramModel(diagram: SchemaDiagram): DiagramModel {
  const nodes: DiagramNode[] = diagram.tables.map((table) => ({
    key: tableKey(table.schema, table.name),
    table,
    width: NODE_WIDTH,
    height: nodeHeight(table),
  }));
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const neighbourKeys = new Map<string, Set<string>>(
    nodes.map((node) => [node.key, new Set<string>()]),
  );

  const foreignKeysByColumn = new Map<string, Map<string, DiagramForeignKey>>();
  const edges: DiagramEdge[] = [];
  for (const foreignKey of diagram.foreignKeys) {
    const sourceKey = tableKey(foreignKey.sourceSchema, foreignKey.sourceTable);
    const targetKey = tableKey(foreignKey.targetSchema, foreignKey.targetTable);
    const columnKeys = foreignKeysByColumn.get(sourceKey) ?? new Map();
    for (const column of foreignKey.sourceColumns) {
      if (!columnKeys.has(column)) columnKeys.set(column, foreignKey);
    }
    foreignKeysByColumn.set(sourceKey, columnKeys);

    const source = nodeByKey.get(sourceKey);
    const target = nodeByKey.get(targetKey);
    if (!source || !target) continue;

    edges.push({
      key: JSON.stringify([sourceKey, foreignKey.name]),
      foreignKey,
      sourceKey,
      targetKey,
      sourceRow: columnRow(source.table, foreignKey.sourceColumns[0]),
      targetRow: columnRow(target.table, foreignKey.targetColumns[0]),
    });
    neighbourKeys.get(sourceKey)?.add(targetKey);
    neighbourKeys.get(targetKey)?.add(sourceKey);
  }

  return { nodes, edges, nodeByKey, neighbourKeys, foreignKeysByColumn };
}
