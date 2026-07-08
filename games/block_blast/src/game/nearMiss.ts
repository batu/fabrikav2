import { GRID_SIZE } from "./rules.ts";
import type { GridBoard, NearMissInfo, PieceDefinition } from "./types.ts";

export function scanNearMisses(board: GridBoard, maxEmpty: number): NearMissInfo[] {
  const results: NearMissInfo[] = [];

  for (let y = 0; y < GRID_SIZE; y += 1) {
    const emptyCells = [];
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (board[y]![x] === null) emptyCells.push({ x, y });
    }
    if (emptyCells.length >= 1 && emptyCells.length <= maxEmpty) {
      results.push({ type: "row", index: y, emptyCells });
    }
  }

  for (let x = 0; x < GRID_SIZE; x += 1) {
    const emptyCells = [];
    for (let y = 0; y < GRID_SIZE; y += 1) {
      if (board[y]![x] === null) emptyCells.push({ x, y });
    }
    if (emptyCells.length >= 1 && emptyCells.length <= maxEmpty) {
      results.push({ type: "col", index: x, emptyCells });
    }
  }

  return results;
}

export function findCompleters(
  piece: PieceDefinition,
  nearMisses: readonly NearMissInfo[],
  board: GridBoard,
): number {
  let count = 0;

  for (const miss of nearMisses) {
    let canComplete = false;
    for (let anchorY = 0; anchorY < GRID_SIZE && !canComplete; anchorY += 1) {
      for (let anchorX = 0; anchorX < GRID_SIZE && !canComplete; anchorX += 1) {
        let fits = true;
        for (const cell of piece.cells) {
          const bx = anchorX + cell.x;
          const by = anchorY + cell.y;
          if (bx < 0 || bx >= GRID_SIZE || by < 0 || by >= GRID_SIZE) {
            fits = false;
            break;
          }
          if (board[by]![bx] !== null) {
            fits = false;
            break;
          }
        }
        if (!fits) continue;

        const pieceCells = new Set(piece.cells.map((cell) => `${anchorX + cell.x},${anchorY + cell.y}`));
        if (miss.emptyCells.every((cell) => pieceCells.has(`${cell.x},${cell.y}`))) {
          canComplete = true;
        }
      }
    }
    if (canComplete) count += 1;
  }

  return count;
}
