/**
 * Pure data types for the Wool Crush v0 gameplay kernel. NO rendering, NO DOM,
 * NO Phaser — this module (and every sibling in `src/game/`) stays headless so
 * the kernel and its tests run under Node/vitest. Same discipline as
 * marble_run's `puzzle/marble-board/types.ts`.
 *
 * Domain, per the binding product contract
 * (docs/plans/2026-07-09-006-…-gameplay-plan.md + docs/brief.md "Mechanics
 * resolution"): a thread board feeds a 4-slot spool buffer that unravels a
 * segmented yarn dragon sliding toward a cat.
 */

/**
 * Yarn colors. Level-defined content; the union is the palette the v0 levels
 * draw from (5 gameplay colors + `teal`, reserved for the teal-death scenario —
 * spools whose color lives only past the visibility window).
 */
export type Color = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'teal';

/** Slide direction; also fixes the thread's orientation on the grid. */
export type Direction = 'up' | 'down' | 'left' | 'right';

export type GameStatus = 'playing' | 'won' | 'failed';

/** Exactly 4 slots, always (v0 contract — discard/swap are later boosters). */
export const SLOT_COUNT = 4;

export interface GridPos {
  readonly x: number;
  readonly y: number;
}

/**
 * A straight yarn thread on the board. It occupies `length` contiguous cells
 * along its movement axis (horizontal for left/right, vertical for up/down)
 * starting at `gridPos` (its min-corner cell). Tapping slides it in `dir` off
 * the board — legal only if the corridor to that edge is clear of other
 * threads. Its `length` is also its conserved contribution to the dragon.
 */
export interface Thread {
  readonly id: number;
  readonly color: Color;
  readonly dir: Direction;
  readonly length: number;
  readonly gridPos: GridPos;
}

export interface Board {
  readonly cols: number;
  readonly rows: number;
  readonly threads: readonly Thread[];
}

/**
 * A released thread living in a slot. It pulls exactly `capacity` (== the
 * thread's length) matching dragon sections, one per pull, then completes and
 * frees its slot. `pulled` is progress so far.
 */
export interface Spool {
  readonly color: Color;
  readonly capacity: number;
  readonly pulled: number;
}

export interface DragonSection {
  readonly color: Color;
}

/**
 * The yarn dragon: an ordered section list with index 0 == the head (nearest
 * the cat / front-most, first pulled). The dragon is longer than the visible
 * track, so only the front `window` (K) sections are pullable — visibility is
 * the scarcity window (the render layer owns the real on-screen window later;
 * here K is a per-level constant). `headProgress` runs [0, trackLength]; the
 * head reaching `trackLength` is the fail condition. `pullAccumulator` carries
 * fractional pull-rounds across ticks so pulling stays rate-based yet
 * deterministic.
 */
export interface Dragon {
  readonly sections: readonly DragonSection[];
  readonly headProgress: number;
  readonly trackLength: number;
  readonly window: number;
  readonly pullAccumulator: number;
}

export interface GameState {
  readonly status: GameStatus;
  readonly levelId: number;
  readonly board: Board;
  /** Length-4; `null` is a free slot. */
  readonly slots: readonly (Spool | null)[];
  readonly dragon: Dragon;
  /** Dragon forward speed (track units / second) while no pull is active. */
  readonly speed: number;
  /** Pull rounds / second while a pull is active. */
  readonly pullRate: number;
}

/** Why a tap is (il)legal — a discriminated reason for testable legality. */
export type TapLegality = 'ok' | 'blocked' | 'slots-full' | 'not-found' | 'not-playing';
