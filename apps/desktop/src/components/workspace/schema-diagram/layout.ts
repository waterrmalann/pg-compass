/**
 * Automatic layout for the ER diagram (see docs/decisions/ER_DIAGRAM_ADR.md).
 *
 * 1. Tables are split into groups connected by foreign keys.
 * 2. Inside a group, referenced tables are ranked left of the tables that
 *    reference them (longest path; cycles and self-references are ignored).
 * 3. Each rank is ordered by a few barycenter sweeps to reduce crossings,
 *    then stacked into one or more columns of bounded height. A group with
 *    very many ranks wraps into bands stacked top to bottom.
 * 4. Groups are packed into rows, largest first. Tables with no foreign keys
 *    form one compact block at the end.
 *
 * Everything is deterministic: the same model always gives the same layout.
 */

import {
  NODE_WIDTH,
  type DiagramEdge,
  type DiagramModel,
  type DiagramNode,
  type Point,
  type Rect,
} from "./diagram-model";

export const RANK_GAP = 96;
export const NODE_GAP = 32;
export const GROUP_GAP = 160;
const ORDERING_SWEEPS = 4;
/** Chains of up to this many ranks always stay on one band. */
const MIN_BAND_RANKS = 8;
const MIN_BAND_WIDTH = MIN_BAND_RANKS * (NODE_WIDTH + RANK_GAP);
/** Width-to-height ratio the packed canvas aims for. */
const TARGET_ASPECT = 1.6;

export interface DiagramLayout {
  positions: Map<string, Point>;
  bounds: Rect;
}

interface Block {
  /** Positions relative to the block's top-left corner. */
  positions: Map<string, Point>;
  width: number;
  height: number;
}

/** Largest value, or 0 for an empty list. Avoids spreading huge arrays. */
function maxOf(values: number[]): number {
  return values.reduce((max, value) => Math.max(max, value), 0);
}

interface Graph {
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
}

function buildGraph(nodes: DiagramNode[], edges: DiagramEdge[]): Graph {
  const parents = new Map<string, string[]>(nodes.map((n) => [n.key, []]));
  const children = new Map<string, string[]>(nodes.map((n) => [n.key, []]));

  for (const edge of edges) {
    const isSelfReference = edge.sourceKey === edge.targetKey;
    if (isSelfReference) continue;
    // The referenced (target) table is the parent of the referencing one.
    const sourceParents = parents.get(edge.sourceKey);
    const targetChildren = children.get(edge.targetKey);
    if (!sourceParents || !targetChildren) continue;
    if (!sourceParents.includes(edge.targetKey)) {
      sourceParents.push(edge.targetKey);
      targetChildren.push(edge.sourceKey);
    }
  }

  return { parents, children };
}

/** Connected groups of tables, each in model order, in order of first table. */
function findGroups(nodes: DiagramNode[], graph: Graph): string[][] {
  const groupOf = new Map<string, number>();
  const groups: string[][] = [];

  for (const node of nodes) {
    if (groupOf.has(node.key)) continue;
    const groupIndex = groups.length;
    const members: string[] = [];
    const stack = [node.key];
    groupOf.set(node.key, groupIndex);

    while (stack.length > 0) {
      const key = stack.pop()!;
      members.push(key);
      const neighbours = [
        ...(graph.parents.get(key) ?? []),
        ...(graph.children.get(key) ?? []),
      ];
      for (const neighbour of neighbours) {
        if (groupOf.has(neighbour)) continue;
        groupOf.set(neighbour, groupIndex);
        stack.push(neighbour);
      }
    }
    groups.push(members);
  }

  const modelOrder = new Map(nodes.map((node, index) => [node.key, index]));
  for (const members of groups) {
    members.sort((a, b) => modelOrder.get(a)! - modelOrder.get(b)!);
  }
  return groups;
}

/**
 * Longest-path ranks: a table sits one rank right of its right-most parent.
 * When only cycles remain, the first unranked table (in group order) is
 * ranked from the parents already placed, which breaks the cycle.
 */
function rankGroup(members: string[], graph: Graph): Map<string, number> {
  const memberSet = new Set(members);
  const ranks = new Map<string, number>();
  const remainingParents = new Map<string, number>();
  for (const key of members) {
    const parents = graph.parents.get(key) ?? [];
    remainingParents.set(key, parents.filter((p) => memberSet.has(p)).length);
  }

  const ready = members.filter((key) => remainingParents.get(key) === 0);
  let nextReadyIndex = 0;
  let nextUnrankedIndex = 0;

  while (ranks.size < members.length) {
    let key = ready[nextReadyIndex];
    nextReadyIndex += 1;
    if (key === undefined) {
      while (ranks.has(members[nextUnrankedIndex]!)) nextUnrankedIndex += 1;
      key = members[nextUnrankedIndex]!;
    }
    if (ranks.has(key)) continue;

    const placedParentRanks = (graph.parents.get(key) ?? [])
      .map((parent) => ranks.get(parent))
      .filter((rank): rank is number => rank !== undefined);
    const rank =
      placedParentRanks.length === 0 ? 0 : maxOf(placedParentRanks) + 1;
    ranks.set(key, rank);

    for (const child of graph.children.get(key) ?? []) {
      if (ranks.has(child)) continue;
      const remaining = (remainingParents.get(child) ?? 0) - 1;
      remainingParents.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }

  return ranks;
}

function neighboursOf(key: string, graph: Graph): string[] {
  return [
    ...(graph.parents.get(key) ?? []),
    ...(graph.children.get(key) ?? []),
  ];
}

/**
 * Reorder each rank by the average relative position of its neighbours in
 * the ranks already swept, alternating left-to-right and right-to-left.
 */
function orderRanks(rankLists: string[][], graph: Graph): void {
  const rankOf = new Map<string, number>();
  const relativePosition = new Map<string, number>();

  function recordPositions(rankIndex: number) {
    const list = rankLists[rankIndex]!;
    list.forEach((key, index) => {
      rankOf.set(key, rankIndex);
      relativePosition.set(key, (index + 0.5) / list.length);
    });
  }
  rankLists.forEach((_, rankIndex) => recordPositions(rankIndex));

  function sortRank(rankIndex: number, useLowerRanks: boolean) {
    const list = rankLists[rankIndex]!;
    const barycenters = new Map<string, number>();
    for (const key of list) {
      const positions = neighboursOf(key, graph)
        .filter((neighbour) => {
          const neighbourRank = rankOf.get(neighbour);
          if (neighbourRank === undefined) return false;
          return useLowerRanks
            ? neighbourRank < rankIndex
            : neighbourRank > rankIndex;
        })
        .map((neighbour) => relativePosition.get(neighbour)!);
      const hasNeighbours = positions.length > 0;
      const barycenter = hasNeighbours
        ? positions.reduce((sum, value) => sum + value, 0) / positions.length
        : relativePosition.get(key)!;
      barycenters.set(key, barycenter);
    }
    // Array.prototype.sort is stable, so ties keep their current order.
    list.sort((a, b) => barycenters.get(a)! - barycenters.get(b)!);
    recordPositions(rankIndex);
  }

  for (let sweep = 0; sweep < ORDERING_SWEEPS; sweep += 1) {
    const isLeftToRight = sweep % 2 === 0;
    if (isLeftToRight) {
      for (let rank = 1; rank < rankLists.length; rank += 1) {
        sortRank(rank, true);
      }
    } else {
      for (let rank = rankLists.length - 2; rank >= 0; rank -= 1) {
        sortRank(rank, false);
      }
    }
  }
}

/** Split an ordered list into columns no taller than `maxHeight`. */
function splitIntoColumns(
  keys: string[],
  heightOf: (key: string) => number,
  maxHeight: number,
): string[][] {
  const columns: string[][] = [];
  let column: string[] = [];
  let columnHeight = 0;

  for (const key of keys) {
    const height = heightOf(key);
    const wouldOverflow =
      column.length > 0 && columnHeight + NODE_GAP + height > maxHeight;
    if (wouldOverflow) {
      columns.push(column);
      column = [];
      columnHeight = 0;
    }
    columnHeight += (column.length > 0 ? NODE_GAP : 0) + height;
    column.push(key);
  }
  if (column.length > 0) columns.push(column);
  return columns;
}

function columnHeight(keys: string[], heightOf: (key: string) => number) {
  const nodesHeight = keys.reduce((sum, key) => sum + heightOf(key), 0);
  return nodesHeight + NODE_GAP * Math.max(keys.length - 1, 0);
}

/**
 * Place columns left to right, each centred vertically on the tallest one.
 * `gapAfter[i]` is the horizontal gap after column `i`.
 */
function placeColumns(
  columns: string[][],
  nodeByKey: Map<string, DiagramNode>,
  gapAfter: number[],
): Block {
  const heightOf = (key: string) => nodeByKey.get(key)!.height;
  const widthOf = (key: string) => nodeByKey.get(key)!.width;
  const heights = columns.map((keys) => columnHeight(keys, heightOf));
  const blockHeight = maxOf(heights);
  const positions = new Map<string, Point>();

  let x = 0;
  columns.forEach((keys, index) => {
    const columnWidth = maxOf(keys.map(widthOf));
    let y = (blockHeight - heights[index]!) / 2;
    for (const key of keys) {
      positions.set(key, { x, y });
      y += heightOf(key) + NODE_GAP;
    }
    const isLast = index === columns.length - 1;
    x += columnWidth + (isLast ? 0 : gapAfter[index]!);
  });

  return { positions, width: x, height: blockHeight };
}

function totalArea(keys: string[], nodeByKey: Map<string, DiagramNode>) {
  return keys.reduce((sum, key) => {
    const node = nodeByKey.get(key)!;
    return sum + (node.width + RANK_GAP) * (node.height + NODE_GAP);
  }, 0);
}

/** Tallest a column may grow before it wraps, so blocks stay roughly square. */
function maxColumnHeight(
  keys: string[],
  nodeByKey: Map<string, DiagramNode>,
): number {
  const tallestNode = maxOf(keys.map((key) => nodeByKey.get(key)!.height));
  return Math.max(tallestNode, Math.sqrt(totalArea(keys, nodeByKey)) * 1.2);
}

function layoutRelatedGroup(
  members: string[],
  graph: Graph,
  nodeByKey: Map<string, DiagramNode>,
): Block {
  const ranks = rankGroup(members, graph);
  const rankCount = maxOf([...ranks.values()]) + 1;
  const rankLists: string[][] = Array.from({ length: rankCount }, () => []);
  for (const key of members) rankLists[ranks.get(key)!]!.push(key);

  orderRanks(rankLists, graph);

  const heightOf = (key: string) => nodeByKey.get(key)!.height;
  const maxHeight = maxColumnHeight(members, nodeByKey);
  const columns: string[][] = [];
  const gapAfter: number[] = [];
  for (const rankList of rankLists) {
    const rankColumns = splitIntoColumns(rankList, heightOf, maxHeight);
    rankColumns.forEach((column, index) => {
      columns.push(column);
      // Wrapped columns of one rank sit closer than separate ranks.
      const isLastOfRank = index === rankColumns.length - 1;
      gapAfter.push(isLastOfRank ? RANK_GAP : NODE_GAP);
    });
  }
  const bandWidthLimit = Math.max(
    MIN_BAND_WIDTH,
    Math.sqrt(totalArea(members, nodeByKey) * TARGET_ASPECT),
  );
  return placeInBands(columns, gapAfter, nodeByKey, bandWidthLimit);
}

/**
 * Long chains of foreign keys give many ranks and a very wide, flat group.
 * Wrap the columns into bands no wider than `bandWidthLimit`, stacked top to
 * bottom, so the group stays roughly landscape. Flow stays left to right
 * inside each band.
 */
function placeInBands(
  columns: string[][],
  gapAfter: number[],
  nodeByKey: Map<string, DiagramNode>,
  bandWidthLimit: number,
): Block {
  const widthOf = (key: string) => nodeByKey.get(key)!.width;
  const bands: Array<{ columns: string[][]; gapAfter: number[] }> = [];
  let band = { columns: [] as string[][], gapAfter: [] as number[] };
  let bandWidth = 0;

  columns.forEach((column, index) => {
    const columnWidth = maxOf(column.map(widthOf));
    const wouldOverflow =
      band.columns.length > 0 && bandWidth + columnWidth > bandWidthLimit;
    if (wouldOverflow) {
      bands.push(band);
      band = { columns: [], gapAfter: [] };
      bandWidth = 0;
    }
    band.columns.push(column);
    band.gapAfter.push(gapAfter[index]!);
    bandWidth += columnWidth + gapAfter[index]!;
  });
  bands.push(band);

  const positions = new Map<string, Point>();
  let y = 0;
  let width = 0;
  bands.forEach((current, index) => {
    const placed = placeColumns(current.columns, nodeByKey, current.gapAfter);
    for (const [key, point] of placed.positions) {
      positions.set(key, { x: point.x, y: y + point.y });
    }
    width = Math.max(width, placed.width);
    const isLast = index === bands.length - 1;
    y += placed.height + (isLast ? 0 : GROUP_GAP);
  });

  return { positions, width, height: y };
}

function layoutUnrelatedTables(
  keys: string[],
  nodeByKey: Map<string, DiagramNode>,
): Block {
  const heightOf = (key: string) => nodeByKey.get(key)!.height;
  const columns = splitIntoColumns(
    keys,
    heightOf,
    maxColumnHeight(keys, nodeByKey),
  );
  return placeColumns(
    columns,
    nodeByKey,
    columns.map(() => NODE_GAP),
  );
}

/** Shelf-pack blocks into rows of roughly `TARGET_ASPECT` overall shape. */
function packBlocks(blocks: Block[]): DiagramLayout {
  const area = blocks.reduce(
    (sum, block) =>
      sum + (block.width + GROUP_GAP) * (block.height + GROUP_GAP),
    0,
  );
  const widestBlock = maxOf(blocks.map((block) => block.width));
  const rowWidthLimit = Math.max(widestBlock, Math.sqrt(area * TARGET_ASPECT));

  const positions = new Map<string, Point>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;

  for (const block of blocks) {
    const startsNewRow = x > 0 && x + block.width > rowWidthLimit;
    if (startsNewRow) {
      y += rowHeight + GROUP_GAP;
      x = 0;
      rowHeight = 0;
    }
    for (const [key, point] of block.positions) {
      positions.set(key, { x: x + point.x, y: y + point.y });
    }
    width = Math.max(width, x + block.width);
    rowHeight = Math.max(rowHeight, block.height);
    x += block.width + GROUP_GAP;
  }

  return {
    positions,
    bounds: { x: 0, y: 0, width, height: y + rowHeight },
  };
}

export function layoutDiagram(model: DiagramModel): DiagramLayout {
  const graph = buildGraph(model.nodes, model.edges);
  const groups = findGroups(model.nodes, graph);

  const relatedGroups = groups.filter((members) => members.length > 1);
  const unrelatedKeys = groups
    .filter((members) => members.length === 1)
    .map((members) => members[0]!);

  const relatedBlocks = relatedGroups
    .map((members) => layoutRelatedGroup(members, graph, model.nodeByKey))
    // Largest first; the sort is stable, so equal blocks keep model order.
    .sort((a, b) => b.width * b.height - a.width * a.height);

  const blocks =
    unrelatedKeys.length > 0
      ? [
          ...relatedBlocks,
          layoutUnrelatedTables(unrelatedKeys, model.nodeByKey),
        ]
      : relatedBlocks;

  return packBlocks(blocks);
}

/** Smallest rectangle around every table at the given positions. */
export function boundsOf(
  nodes: DiagramNode[],
  positions: Map<string, Point>,
): Rect {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const point = positions.get(node.key);
    if (!point) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x + node.width);
    maxY = Math.max(maxY, point.y + node.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
