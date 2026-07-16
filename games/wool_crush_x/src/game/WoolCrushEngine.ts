export type WoolColor = string;

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export interface Direction {
  readonly x: -1 | 0 | 1;
  readonly y: -1 | 0 | 1;
}

export interface ThreadDefinition {
  readonly id: string;
  readonly color: WoolColor;
  readonly cells: readonly Cell[];
  readonly exit: Direction;
}

export interface WoolCrushLevel {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly visibleSections: number;
  readonly catDistance: number;
  readonly threads: readonly ThreadDefinition[];
  /** Ordered from the head (closest to the cat) to the tail. */
  readonly dragon: readonly WoolColor[];
}

export interface ActiveSpool {
  readonly threadId: string;
  readonly color: WoolColor;
  readonly remaining: number;
}

export type GameStatus = "playing" | "won" | "failed";

export interface WoolCrushState {
  readonly level: WoolCrushLevel;
  readonly threads: readonly ThreadDefinition[];
  readonly spools: readonly (ActiveSpool | null)[];
  readonly dragon: readonly WoolColor[];
  readonly headDistance: number;
  readonly status: GameStatus;
  readonly turns: number;
}

export type ReleaseResult =
  | { readonly ok: true; readonly state: WoolCrushState; readonly slot: number }
  | { readonly ok: false; readonly state: WoolCrushState; readonly reason: "not-playing" | "unknown-thread" | "blocked" | "slots-full" };

const SLOT_COUNT = 4;

function key(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function assertLevel(level: WoolCrushLevel): void {
  if (level.width <= 0 || level.height <= 0 || level.visibleSections <= 0 || level.catDistance <= 0) {
    throw new Error(`Level ${level.id} has invalid dimensions or timing`);
  }

  const occupied = new Set<string>();
  const threadIds = new Set<string>();
  for (const thread of level.threads) {
    if (threadIds.has(thread.id) || thread.cells.length === 0) {
      throw new Error(`Level ${level.id} has an invalid thread ${thread.id}`);
    }
    threadIds.add(thread.id);
    if (Math.abs(thread.exit.x) + Math.abs(thread.exit.y) !== 1) {
      throw new Error(`Thread ${thread.id} must have a cardinal exit direction`);
    }
    for (const cell of thread.cells) {
      if (cell.x < 0 || cell.x >= level.width || cell.y < 0 || cell.y >= level.height || occupied.has(key(cell))) {
        throw new Error(`Thread ${thread.id} has an out-of-bounds or overlapping cell`);
      }
      occupied.add(key(cell));
    }
  }

  const boardCounts = colorCounts(level.threads.flatMap((thread) => Array(thread.cells.length).fill(thread.color) as string[]));
  const dragonCounts = colorCounts(level.dragon);
  if (!sameCounts(boardCounts, dragonCounts)) {
    throw new Error(`Level ${level.id} violates yarn conservation`);
  }
}

export function createGame(level: WoolCrushLevel): WoolCrushState {
  assertLevel(level);
  return {
    level,
    threads: [...level.threads],
    spools: Array<null>(SLOT_COUNT).fill(null),
    dragon: [...level.dragon],
    headDistance: level.catDistance,
    status: "playing",
    turns: 0,
  };
}

export function isThreadClear(state: WoolCrushState, threadId: string): boolean {
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread) return false;

  const own = new Set(thread.cells.map(key));
  const occupied = new Set(
    state.threads.flatMap((candidate) => candidate.cells.map(key)).filter((cellKey) => !own.has(cellKey)),
  );
  const projection = (cell: Cell) => cell.x * thread.exit.x + cell.y * thread.exit.y;
  const leading = thread.cells.reduce((best, cell) => projection(cell) > projection(best) ? cell : best);

  let x = leading.x + thread.exit.x;
  let y = leading.y + thread.exit.y;
  while (x >= 0 && x < state.level.width && y >= 0 && y < state.level.height) {
    if (occupied.has(`${x},${y}`)) return false;
    x += thread.exit.x;
    y += thread.exit.y;
  }
  return true;
}

export function releaseThread(state: WoolCrushState, threadId: string): ReleaseResult {
  if (state.status !== "playing") return { ok: false, state, reason: "not-playing" };
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread) return { ok: false, state, reason: "unknown-thread" };
  if (!isThreadClear(state, threadId)) return { ok: false, state, reason: "blocked" };
  const slot = state.spools.findIndex((spool) => spool === null);
  if (slot < 0) return { ok: false, state, reason: "slots-full" };

  const spools = [...state.spools];
  spools[slot] = { threadId, color: thread.color, remaining: thread.cells.length };
  const next = withTerminalStatus({
    ...state,
    threads: state.threads.filter((candidate) => candidate.id !== threadId),
    spools,
  });
  assertConservation(next);
  return { ok: true, state: next, slot };
}

export function advance(state: WoolCrushState): WoolCrushState {
  if (state.status !== "playing") return state;
  const visible = state.dragon.slice(0, state.level.visibleSections);
  const eligible = state.spools
    .map((spool, slot) => ({ spool, slot }))
    .filter((entry): entry is { spool: ActiveSpool; slot: number } => entry.spool !== null && visible.includes(entry.spool.color))
    .sort((a, b) => a.spool.remaining - b.spool.remaining || a.slot - b.slot);

  let next: WoolCrushState;
  if (eligible.length > 0) {
    const winner = eligible[0];
    const sectionIndex = visible.indexOf(winner.spool.color);
    const dragon = [...state.dragon];
    dragon.splice(sectionIndex, 1);
    const spools = [...state.spools];
    const remaining = winner.spool.remaining - 1;
    spools[winner.slot] = remaining === 0 ? null : { ...winner.spool, remaining };
    next = { ...state, dragon, spools, turns: state.turns + 1 };
  } else {
    next = { ...state, headDistance: state.headDistance - 1, turns: state.turns + 1 };
  }

  next = withTerminalStatus(next);
  assertConservation(next);
  return next;
}

function withTerminalStatus(state: WoolCrushState): WoolCrushState {
  const allSpoolsDone = state.spools.every((spool) => spool === null);
  if (state.threads.length === 0 && state.dragon.length === 0 && allSpoolsDone) {
    return { ...state, status: "won" };
  }
  if (state.headDistance <= 0) return { ...state, status: "failed", headDistance: 0 };
  return state;
}

export function yarnInventory(state: WoolCrushState): { boardAndSpools: Readonly<Record<string, number>>; dragon: Readonly<Record<string, number>> } {
  const board = state.threads.flatMap((thread) => Array(thread.cells.length).fill(thread.color) as string[]);
  const spools = state.spools.flatMap((spool) => spool ? Array(spool.remaining).fill(spool.color) as string[] : []);
  return { boardAndSpools: colorCounts([...board, ...spools]), dragon: colorCounts(state.dragon) };
}

export function assertConservation(state: WoolCrushState): void {
  const inventory = yarnInventory(state);
  if (!sameCounts(inventory.boardAndSpools, inventory.dragon)) {
    throw new Error("Wool conservation invariant violated");
  }
}

function colorCounts(colors: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const color of colors) counts[color] = (counts[color] ?? 0) + 1;
  return counts;
}

function sameCounts(left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): boolean {
  const colors = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...colors].every((color) => (left[color] ?? 0) === (right[color] ?? 0));
}
