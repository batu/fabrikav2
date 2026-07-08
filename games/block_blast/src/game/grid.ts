import { GRID_SIZE } from "./rules.ts";
import type { ClearedLines, GridBoard, MutableGridBoard, PieceDefinition } from "./types.ts";

export function createEmptyBoard(): MutableGridBoard {
  return Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, () => null));
}

export function cloneBoard(board: GridBoard): MutableGridBoard {
  return board.map((row) => [...row]);
}

export function canPlacePiece(
  board: GridBoard,
  piece: PieceDefinition,
  anchorX: number,
  anchorY: number,
): boolean {
  for (const cell of piece.cells) {
    const boardX = anchorX + cell.x;
    const boardY = anchorY + cell.y;
    if (boardX < 0 || boardX >= GRID_SIZE || boardY < 0 || boardY >= GRID_SIZE) return false;
    if (board[boardY]![boardX] !== null) return false;
  }
  return true;
}

export function applyPiece(
  board: GridBoard,
  piece: PieceDefinition,
  anchorX: number,
  anchorY: number,
): MutableGridBoard {
  const nextBoard = cloneBoard(board);
  for (const cell of piece.cells) {
    nextBoard[anchorY + cell.y]![anchorX + cell.x] = piece.colorIndex;
  }
  return nextBoard;
}

export function detectClearedLines(board: GridBoard): ClearedLines {
  const rows: number[] = [];
  const cols: number[] = [];

  for (let y = 0; y < GRID_SIZE; y += 1) {
    if (board[y]!.every((value) => value !== null)) rows.push(y);
  }

  for (let x = 0; x < GRID_SIZE; x += 1) {
    let full = true;
    for (let y = 0; y < GRID_SIZE; y += 1) {
      if (board[y]![x] === null) {
        full = false;
        break;
      }
    }
    if (full) cols.push(x);
  }

  return { rows, cols };
}

export function clearLines(board: GridBoard, lines: ClearedLines): MutableGridBoard {
  const nextBoard = cloneBoard(board);
  for (const rowIndex of lines.rows) {
    for (let x = 0; x < GRID_SIZE; x += 1) nextBoard[rowIndex]![x] = null;
  }
  for (const colIndex of lines.cols) {
    for (let y = 0; y < GRID_SIZE; y += 1) nextBoard[y]![colIndex] = null;
  }
  return nextBoard;
}

export function getBoardFillRatio(board: GridBoard): number {
  let occupied = 0;
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (board[y]![x] !== null) occupied += 1;
    }
  }
  return occupied / (GRID_SIZE * GRID_SIZE);
}

export function validPlacements(board: GridBoard, piece: PieceDefinition): Array<{ anchorX: number; anchorY: number }> {
  const placements: Array<{ anchorX: number; anchorY: number }> = [];
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (canPlacePiece(board, piece, x, y)) placements.push({ anchorX: x, anchorY: y });
    }
  }
  return placements;
}

export function canAnyPieceFit(board: GridBoard, pieces: readonly PieceDefinition[]): boolean {
  return pieces.some((piece) => validPlacements(board, piece).length > 0);
}
