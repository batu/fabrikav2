/**
 * Wool Crush v0 gameplay kernel — pure, deterministic reducers over GameState.
 * No rendering, no DOM, no time-of-day: `tapThread` and `tick` take a state
 * (treated as immutable) and return the next state. Every rule here is ruled by
 * the binding contract (brief.md "Mechanics resolution"); do not reinterpret.
 *
 * House pattern note (prior art = marble_run/src/puzzle/marble-board): marble
 * uses a *mutable* engine CLASS emitting per-tap change descriptors, because its
 * view animates one tap at a time. Wool Crush instead needs a real-time `tick`
 * (the dragon advances/holds continuously) and a determinism guarantee over a
 * (taps, dt) sequence, so a pure reducer over an immutable state reads cleaner
 * and makes the determinism test a plain deep-equal. We reuse marble's headless
 * discipline (no Phaser in the logic) and its grid/corridor reasoning, and
 * reject its class+descriptor shape as a poor fit for a ticking sim.
 */

import type {
  Board,
  Color,
  DragonSection,
  GameState,
  GameStatus,
  Spool,
  TapLegality,
  Thread,
} from './types.ts';

// ── Board geometry ──────────────────────────────────────────────────

/** Cells a thread occupies, along its movement axis from its min-corner. */
export function cellsOf(thread: Thread): { x: number; y: number }[] {
  const horizontal = thread.dir === 'left' || thread.dir === 'right';
  const cells: { x: number; y: number }[] = [];
  for (let k = 0; k < thread.length; k += 1) {
    cells.push(
      horizontal
        ? { x: thread.gridPos.x + k, y: thread.gridPos.y }
        : { x: thread.gridPos.x, y: thread.gridPos.y + k },
    );
  }
  return cells;
}

/** Cells the thread would sweep to exit, from just past its leading edge to the board edge. */
function corridorCells(board: Board, thread: Thread): { x: number; y: number }[] {
  const { x, y } = thread.gridPos;
  const cells: { x: number; y: number }[] = [];
  switch (thread.dir) {
    case 'right':
      for (let cx = x + thread.length; cx < board.cols; cx += 1) cells.push({ x: cx, y });
      break;
    case 'left':
      for (let cx = 0; cx < x; cx += 1) cells.push({ x: cx, y });
      break;
    case 'down':
      for (let cy = y + thread.length; cy < board.rows; cy += 1) cells.push({ x, y: cy });
      break;
    case 'up':
      for (let cy = 0; cy < y; cy += 1) cells.push({ x, y: cy });
      break;
  }
  return cells;
}

/** True iff the corridor from `thread` to its exit edge holds no other thread. */
export function pathClear(board: Board, thread: Thread): boolean {
  const occupied = new Set<string>();
  for (const other of board.threads) {
    if (other.id === thread.id) continue;
    for (const c of cellsOf(other)) occupied.add(`${c.x},${c.y}`);
  }
  return corridorCells(board, thread).every((c) => !occupied.has(`${c.x},${c.y}`));
}

// ── Tap ─────────────────────────────────────────────────────────────

/** Legality of tapping thread `threadId`, with a reason. */
export function tapLegality(state: GameState, threadId: number): TapLegality {
  if (state.status !== 'playing') return 'not-playing';
  const thread = state.board.threads.find((t) => t.id === threadId);
  if (!thread) return 'not-found';
  if (!pathClear(state.board, thread)) return 'blocked';
  if (state.slots.every((s) => s !== null)) return 'slots-full';
  return 'ok';
}

export function canTapThread(state: GameState, threadId: number): boolean {
  return tapLegality(state, threadId) === 'ok';
}

/**
 * Tap a thread: on a legal tap the thread leaves the board and becomes a spool
 * in the LEFTMOST free slot. Illegal taps (blocked path, full slots, unknown
 * thread, game over) are a no-op — the SAME state reference is returned, so
 * callers/tests can detect illegality by identity. Never wins on its own: a
 * fresh spool is incomplete, so a win can only land in `tick`.
 */
export function tapThread(state: GameState, threadId: number): GameState {
  if (tapLegality(state, threadId) !== 'ok') return state;
  const thread = state.board.threads.find((t) => t.id === threadId)!;
  const slotIndex = state.slots.findIndex((s) => s === null);

  const slots = state.slots.slice();
  slots[slotIndex] = { color: thread.color, capacity: thread.length, pulled: 0 };

  return {
    ...state,
    board: { ...state.board, threads: state.board.threads.filter((t) => t.id !== threadId) },
    slots,
  };
}

// ── Dragon visibility & pulling ─────────────────────────────────────

/** The front K sections — the pullable / on-screen window. */
export function visibleSections(state: GameState): readonly DragonSection[] {
  return state.dragon.sections.slice(0, state.dragon.window);
}

/**
 * Index of the closest visible matching section for `color`, or -1. "Closest"
 * == front-most (nearest the head), the section most advanced toward the cat.
 */
function frontMostMatchIndex(
  sections: readonly DragonSection[],
  color: Color,
  window: number,
): number {
  const limit = Math.min(window, sections.length);
  for (let i = 0; i < limit; i += 1) {
    if (sections[i]!.color === color) return i;
  }
  return -1;
}

/** True iff any slotted spool has a visible matching section (a pull is active). */
export function hasActivePull(state: GameState): boolean {
  return state.slots.some(
    (s) => s !== null && frontMostMatchIndex(state.dragon.sections, s.color, state.dragon.window) >= 0,
  );
}

/** Slot indices whose spool currently has a visible match (pulling this instant). */
export function activeSlots(state: GameState): number[] {
  const out: number[] = [];
  state.slots.forEach((s, i) => {
    if (s !== null && frontMostMatchIndex(state.dragon.sections, s.color, state.dragon.window) >= 0) {
      out.push(i);
    }
  });
  return out;
}

// ── Tick ────────────────────────────────────────────────────────────

/**
 * Advance the sim by `dt` seconds.
 *   - No pull active  → the dragon advances (headProgress += speed·dt).
 *   - A pull active   → the dragon HOLDS (no advance) and shortens instead:
 *     `pullRate·dt` accumulates into whole pull-rounds. Each round, every
 *     active spool pulls one section — processed closest-to-finish first
 *     (fewest remaining), so simultaneous completions resolve in that order.
 *     Pulling a middle section closes the gap (splice) → adjacencies change,
 *     which can reveal a new tail section into the window.
 * A spool with no visible match idles, keeping its progress and its slot.
 * Win: board empty AND all spools completed (dragon consumed, by conservation).
 * Fail: the head reaches the cat (headProgress ≥ trackLength).
 */
export function tick(state: GameState, dt: number): GameState {
  if (state.status !== 'playing') return state;

  const sections: DragonSection[] = state.dragon.sections.slice();
  const slots: (Spool | null)[] = state.slots.map((s) => (s ? { ...s } : null));
  const window = state.dragon.window;
  let headProgress = state.dragon.headProgress;
  let pullAccumulator = state.dragon.pullAccumulator;

  const anyActive = () =>
    slots.some((s) => s !== null && frontMostMatchIndex(sections, s.color, window) >= 0);

  if (!anyActive()) {
    headProgress += state.speed * dt;
  } else {
    pullAccumulator += state.pullRate * dt;
    while (pullAccumulator >= 1 && sections.length > 0) {
      pullAccumulator -= 1;
      // One round: closest-to-finish spools pull first; re-evaluate matches
      // per spool since the dragon shrinks as earlier spools pull this round.
      const order = slots
        .map((s, i) => ({ s, i }))
        .filter((e): e is { s: Spool; i: number } => e.s !== null)
        .sort((a, b) => a.s.capacity - a.s.pulled - (b.s.capacity - b.s.pulled) || a.i - b.i);

      let pulledThisRound = false;
      for (const { i } of order) {
        const spool = slots[i];
        if (spool === null) continue;
        const idx = frontMostMatchIndex(sections, spool.color, window);
        if (idx < 0) continue;
        sections.splice(idx, 1);
        const pulled = spool.pulled + 1;
        slots[i] = pulled >= spool.capacity ? null : { ...spool, pulled };
        pulledThisRound = true;
      }
      if (!pulledThisRound) break;
    }
  }

  let status: GameStatus = state.status;
  const boardEmpty = state.board.threads.length === 0;
  const slotsEmpty = slots.every((s) => s === null);
  if (boardEmpty && slotsEmpty && sections.length === 0) {
    status = 'won';
  } else if (headProgress >= state.dragon.trackLength) {
    status = 'failed';
  }

  return {
    ...state,
    status,
    slots,
    dragon: { ...state.dragon, sections, headProgress, pullAccumulator },
  };
}
