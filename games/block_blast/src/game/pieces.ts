import type { CellOffset, PieceDefinition } from "./types.ts";

function piece(
  id: string,
  tier: PieceDefinition["tier"],
  colorIndex: number,
  cells: Array<[number, number]>,
): PieceDefinition {
  return {
    id,
    tier,
    colorIndex,
    cells: cells.map(([x, y]) => ({ x, y })),
  };
}

function rotateCells(cells: readonly CellOffset[]): CellOffset[] {
  const rotated = cells.map((cell) => ({ x: -cell.y, y: cell.x }));
  const minX = Math.min(...rotated.map((cell) => cell.x));
  const minY = Math.min(...rotated.map((cell) => cell.y));
  return rotated.map((cell) => ({ x: cell.x - minX, y: cell.y - minY }));
}

function cellsKey(cells: readonly CellOffset[]): string {
  return cells
    .map((cell) => `${cell.x},${cell.y}`)
    .sort()
    .join("|");
}

function clonePiece(definition: PieceDefinition): PieceDefinition {
  return {
    ...definition,
    cells: definition.cells.map((cell) => ({ x: cell.x, y: cell.y })),
  };
}

function withRotations(base: PieceDefinition): PieceDefinition[] {
  const results: PieceDefinition[] = [base];
  const seen = new Set<string>([cellsKey(base.cells)]);
  let current = base.cells;

  for (let rotation = 1; rotation <= 3; rotation += 1) {
    current = rotateCells(current);
    const key = cellsKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      id: `${base.id}_r${rotation}`,
      tier: base.tier,
      colorIndex: base.colorIndex,
      cells: current.map((cell) => ({ ...cell })),
    });
  }

  return results;
}

const BASE_PIECES: readonly PieceDefinition[] = [
  piece("single", "simple", 0, [[0, 0]]),
  piece("line2_h", "simple", 1, [[0, 0], [1, 0]]),
  piece("line3_h", "simple", 3, [[0, 0], [1, 0], [2, 0]]),
  piece("square2", "simple", 5, [[0, 0], [1, 0], [0, 1], [1, 1]]),
  piece("l3", "mid", 6, [[0, 0], [0, 1], [1, 1]]),
  piece("l4", "mid", 1, [[0, 0], [0, 1], [0, 2], [1, 2]]),
  piece("j4", "mid", 2, [[1, 0], [1, 1], [1, 2], [0, 2]]),
  piece("t4", "mid", 3, [[0, 0], [1, 0], [2, 0], [1, 1]]),
  piece("line4_h", "mid", 4, [[0, 0], [1, 0], [2, 0], [3, 0]]),
  piece("square3", "mid", 6, [
    [0, 0], [1, 0], [2, 0],
    [0, 1], [1, 1], [2, 1],
    [0, 2], [1, 2], [2, 2],
  ]),
  piece("s4", "awkward", 0, [[1, 0], [2, 0], [0, 1], [1, 1]]),
  piece("z4", "awkward", 1, [[0, 0], [1, 0], [1, 1], [2, 1]]),
  piece("plus5", "awkward", 2, [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]),
  piece("u5", "awkward", 3, [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]]),
  piece("big_l5", "awkward", 4, [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]),
];

export const PIECE_LIBRARY: readonly PieceDefinition[] = BASE_PIECES.flatMap(withRotations);

export function getPieceById(pieceId: string): PieceDefinition | null {
  const found = PIECE_LIBRARY.find((definition) => definition.id === pieceId);
  return found ? clonePiece(found) : null;
}

export function clonePieceDefinition(pieceDefinition: PieceDefinition): PieceDefinition {
  return clonePiece(pieceDefinition);
}
