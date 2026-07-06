/**
 * Headless Marble Run board engine. Holds rules + state, emits one
 * TapChange descriptor per tap. Never touches Phaser, never animates —
 * the view paces all motion (see @fabrika/core/puzzle README traps).
 */
import {
  CHAR_TO_COLOR,
  gateMouthCell,
  type Cell,
  type CellContent,
  type GameStatus,
  type GateDef,
  type LevelDef,
  type MarbleRoutePreview,
  type MarbleState,
  type TapChange,
} from './types';

const DIRS: readonly Cell[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

interface PathNode {
  readonly cell: Cell;
  readonly dir: number; // index into DIRS, -1 for start
  readonly cost: number; // steps * 100 + turns (prefers straighter paths)
  readonly prev: PathNode | null;
}

export class BoardEngine {
  readonly level: LevelDef;
  readonly cols: number;
  readonly rows: number;

  private grid: CellContent[][]; // [y][x]
  private marbles = new Map<number, MarbleState>();
  private heartsLeft: number;
  private status: GameStatus = 'playing';
  private streakCount = 0;
  private readonly heartsTotal: number;

  constructor(level: LevelDef) {
    this.level = level;
    this.cols = level.cols;
    this.rows = level.rows;
    this.heartsTotal = level.hearts ?? 5;
    this.heartsLeft = this.heartsTotal;
    this.grid = [];

    let nextId = 1;
    for (let y = 0; y < level.rows; y += 1) {
      const rowStr = level.cells[y]!;
      const row: CellContent[] = [];
      for (let x = 0; x < level.cols; x += 1) {
        const ch = rowStr[x]!;
        if (ch === '.') {
          row.push({ kind: 'empty' });
        } else if (ch === '#') {
          row.push({ kind: 'void' });
        } else if (ch === 'X') {
          row.push({ kind: 'plug' });
        } else {
          const color = CHAR_TO_COLOR[ch];
          if (!color) throw new Error(`Level ${level.id}: bad cell char '${ch}' at ${x},${y}`);
          const id = nextId;
          nextId += 1;
          row.push({ kind: 'marble', id, color });
          this.marbles.set(id, { id, color, cell: { x, y } });
        }
      }
      this.grid.push(row);
    }
  }

  // ── Inspection ──────────────────────────────────────────────────

  contentAt(cell: Cell): CellContent {
    if (cell.x < 0 || cell.y < 0 || cell.x >= this.cols || cell.y >= this.rows) {
      return { kind: 'void' };
    }
    return this.grid[cell.y]![cell.x]!;
  }

  marbleAt(cell: Cell): MarbleState | null {
    const c = this.contentAt(cell);
    if (c.kind !== 'marble') return null;
    return this.marbles.get(c.id) ?? null;
  }

  allMarbles(): readonly MarbleState[] {
    return [...this.marbles.values()];
  }

  remainingCount(): number {
    return this.marbles.size;
  }

  hearts(): number {
    return this.heartsLeft;
  }

  totalHearts(): number {
    return this.heartsTotal;
  }

  gameStatus(): GameStatus {
    return this.status;
  }

  continueAfterFail(hearts: number = 1): boolean {
    if (this.status !== 'failed') return false;
    this.heartsLeft = Math.min(this.heartsTotal, Math.max(1, hearts));
    this.status = 'playing';
    this.streakCount = 0;
    return true;
  }

  currentStreak(): number {
    return this.streakCount;
  }

  /** Marbles that currently have an open path. Used by solver + hint. */
  movableMarbles(): readonly MarbleState[] {
    return this.allMarbles().filter((m) => this.findPath(m) !== null);
  }

  /**
   * Non-mutating route lookup for previews and hints. Returns null for
   * non-marble cells, blocked marbles, or non-playing boards.
   */
  previewTap(cell: Cell): MarbleRoutePreview | null {
    if (this.status !== 'playing') return null;
    const marble = this.marbleAt(cell);
    if (!marble) return null;
    const found = this.findPath(marble);
    if (!found) return null;
    return {
      marbleId: marble.id,
      color: marble.color,
      cell: marble.cell,
      path: found.path,
      gate: found.gate,
    };
  }

  // ── Mutation ────────────────────────────────────────────────────

  /**
   * Resolve a tap on `cell`. Returns null when the tap hits nothing
   * actionable (empty/void/plug cell, or game already over).
   */
  tap(cell: Cell): TapChange | null {
    if (this.status !== 'playing') return null;
    const marble = this.marbleAt(cell);
    if (!marble) return null;

    const found = this.findPath(marble);
    if (!found) {
      this.heartsLeft -= 1;
      this.streakCount = 0;
      const failed = this.heartsLeft <= 0;
      if (failed) this.status = 'failed';
      return {
        kind: 'blocked',
        marbleId: marble.id,
        color: marble.color,
        cell: marble.cell,
        heartsLeft: this.heartsLeft,
        failed,
      };
    }

    // Remove the marble from the board — it rolls out through the gate.
    this.grid[marble.cell.y]![marble.cell.x] = { kind: 'empty' };
    this.marbles.delete(marble.id);
    this.streakCount += 1;

    const won = this.marbles.size === 0;
    if (won) this.status = 'won';

    return {
      kind: 'rolled',
      marbleId: marble.id,
      color: marble.color,
      path: found.path,
      gate: found.gate,
      remaining: this.marbles.size,
      streak: this.streakCount,
      won,
      stars: won ? this.starsForHearts() : null,
    };
  }

  /** 3 stars = no hearts lost, 2 = lost one or two, 1 = anything else. */
  private starsForHearts(): number {
    const lost = this.heartsTotal - this.heartsLeft;
    if (lost === 0) return 3;
    if (lost <= 2) return 2;
    return 1;
  }

  // ── Pathfinding ─────────────────────────────────────────────────

  /**
   * Cheapest open path from the marble to any same-color gate mouth.
   * Cost = steps * 100 + turns, so among shortest paths the one with
   * fewest corners wins (straight runs animate + read better).
   * Returns path inclusive of start cell and mouth cell.
   */
  private findPath(marble: MarbleState): { path: Cell[]; gate: GateDef } | null {
    const targets = new Map<string, GateDef>();
    for (const gate of this.level.gates) {
      if (gate.color !== marble.color) continue;
      const mouth = gateMouthCell(gate, this.cols, this.rows);
      // The mouth must be enterable (empty) — unless the marble already sits on it.
      const content = this.contentAt(mouth);
      const isStart = mouth.x === marble.cell.x && mouth.y === marble.cell.y;
      if (isStart || content.kind === 'empty') {
        targets.set(`${mouth.x},${mouth.y}`, gate);
      }
    }
    if (targets.size === 0) return null;

    const startKey = `${marble.cell.x},${marble.cell.y}`;
    if (targets.has(startKey)) {
      return { path: [marble.cell], gate: targets.get(startKey)! };
    }

    // Dijkstra over (cell, incoming-dir) states. Grids are tiny
    // (≤ ~14×14), so a sorted-insert queue is plenty.
    const queue: PathNode[] = [{ cell: marble.cell, dir: -1, cost: 0, prev: null }];
    const seen = new Map<string, number>();

    while (queue.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < queue.length; i += 1) {
        if (queue[i]!.cost < queue[bestIdx]!.cost) bestIdx = i;
      }
      const node = queue.splice(bestIdx, 1)[0]!;
      const nodeKey = `${node.cell.x},${node.cell.y},${node.dir}`;
      const prevBest = seen.get(nodeKey);
      if (prevBest !== undefined && prevBest <= node.cost) continue;
      seen.set(nodeKey, node.cost);

      const targetGate = targets.get(`${node.cell.x},${node.cell.y}`);
      if (targetGate) {
        return { path: reconstruct(node), gate: targetGate };
      }

      for (let d = 0; d < DIRS.length; d += 1) {
        const dir = DIRS[d]!;
        const nx = node.cell.x + dir.x;
        const ny = node.cell.y + dir.y;
        const next: Cell = { x: nx, y: ny };
        if (this.contentAt(next).kind !== 'empty') continue;
        const turn = node.dir !== -1 && node.dir !== d ? 1 : 0;
        queue.push({ cell: next, dir: d, cost: node.cost + 100 + turn, prev: node });
      }
    }
    return null;
  }
}

function reconstruct(node: PathNode): Cell[] {
  const out: Cell[] = [];
  let cur: PathNode | null = node;
  while (cur) {
    out.push(cur.cell);
    cur = cur.prev;
  }
  out.reverse();
  return out;
}
