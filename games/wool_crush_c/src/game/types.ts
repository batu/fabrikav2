/**
 * Wool Crush gameplay types — designed from games/wool_crush/docs/brief.md and
 * docs/plans/2026-07-09-006 (Batu's grilled mechanics resolution, 2026-07-09).
 *
 * Pure data. No Phaser, no DOM, no shell imports — the engine is a headless
 * kernel the renderer drives (autonomy lives in the caller, per repo law).
 */

/** Yarn colors. v0 levels use the first 3–5. */
export type YarnColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple';

export type Direction = 'up' | 'down' | 'left' | 'right';

/** A straight thread on the board grid. Occupies `length` consecutive cells
 *  starting at (x, y) extending along its AXIS; `dir` is the way it slides
 *  out. For horizontal dirs the cells run to the right of (x, y); for
 *  vertical dirs they run downward. */
export interface ThreadDef {
  id: string;
  color: YarnColor;
  x: number;
  y: number;
  length: number;
  dir: Direction;
}

/** A level is its thread map alone (level-as-data). The dragon is DERIVED:
 *  sections per color == total thread length per color (conservation). */
export interface WoolLevelDef {
  /** Board grid size in cells. */
  cols: number;
  rows: number;
  threads: ThreadDef[];
  /** Front-of-dragon visibility window in sections (the scarcity dial). */
  visibleWindow: number;
  /** Dragon forward speed, sections per second. */
  dragonSpeed: number;
  /** Pull rate, sections per second (shared by all pulling spools). */
  pullRate: number;
  /** Track length in section-units from spawn to the cat. */
  trackLength: number;
  /** Seed for the deterministic dragon shuffle. */
  seed: number;
}

/** A released thread occupying one of the 4 slots. */
export interface Spool {
  color: YarnColor;
  /** Sections still to pull before completing. */
  remaining: number;
  /** Total length (for progress display). */
  total: number;
}

export const SLOT_COUNT = 4;

export interface WoolState {
  def: WoolLevelDef;
  /** Threads still on the board. */
  threads: ThreadDef[];
  /** 4 slots; null = free. */
  slots: (Spool | null)[];
  /** Dragon body colors, index 0 = head, spliced as sections are pulled. */
  dragon: YarnColor[];
  /** Head's distance travelled along the track, in section-units.
   *  >= trackLength → the head has reached the cat (fail). */
  headProgress: number;
  /** Accumulated fractional pull progress toward the next section pull. */
  pullAccum: number;
  status: 'playing' | 'won' | 'failed';
}

/** Events emitted by a tick/tap for the renderer to animate. */
export type WoolEvent =
  | { kind: 'released'; threadId: string; slot: number }
  | { kind: 'blocked'; threadId: string }
  | { kind: 'sectionPulled'; slot: number; dragonIndex: number; color: YarnColor }
  | { kind: 'spoolCompleted'; slot: number; color: YarnColor }
  | { kind: 'won' }
  | { kind: 'failed' };
