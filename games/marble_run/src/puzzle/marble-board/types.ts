/**
 * Pure data types for the Marble Run board engine. No Phaser imports —
 * this module must stay headless so the solver and tests run under Node.
 */

export type MarbleColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange';

export interface Cell {
  readonly x: number;
  readonly y: number;
}

/**
 * A gate sits OUTSIDE the grid on one border. `index` is the column
 * (top/bottom) or row (left/right) the gate is attached to. A marble
 * exits by reaching the gate's mouth cell (the in-grid cell the gate
 * touches) and then stepping out into the gate.
 */
export interface GateDef {
  readonly side: 'top' | 'bottom' | 'left' | 'right';
  readonly index: number;
  readonly color: MarbleColor;
}

/**
 * Cell legend for `LevelDef.cells` row strings:
 *   '.'  empty dimple (marbles can roll through)
 *   '#'  void — not part of the board (hole in the tray, impassable)
 *   'X'  wooden plug — occupies the dimple permanently, impassable
 *   'R' 'B' 'G' 'Y' 'P' 'O'  marble of that color
 */
export interface LevelDef {
  readonly id: number;
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly string[];
  readonly gates: readonly GateDef[];
  /** Hearts the player starts with. Default 5. */
  readonly hearts?: number;
}

export type CellContent =
  | { readonly kind: 'empty' }
  | { readonly kind: 'void' }
  | { readonly kind: 'plug' }
  | { readonly kind: 'marble'; readonly id: number; readonly color: MarbleColor };

export interface MarbleState {
  readonly id: number;
  readonly color: MarbleColor;
  readonly cell: Cell;
}

export type GameStatus = 'playing' | 'won' | 'failed';

export interface MarbleRoutePreview {
  readonly marbleId: number;
  readonly color: MarbleColor;
  readonly cell: Cell;
  readonly path: readonly Cell[];
  readonly gate: GateDef;
}

/**
 * One descriptor per tap, with every consequence embedded (never
 * multi-event chatter — view destructures what it needs).
 *
 * `path` runs from the marble's own cell to the gate's mouth cell,
 * inclusive. The view appends the gate's outside position for the exit
 * hop. `won`/`failed` are embedded consequences of this tap.
 */
export type TapChange =
  | {
      readonly kind: 'rolled';
      readonly marbleId: number;
      readonly color: MarbleColor;
      readonly path: readonly Cell[];
      readonly gate: GateDef;
      readonly remaining: number;
      readonly streak: number;
      readonly won: boolean;
      /** 1-3, present only when `won` is true. */
      readonly stars: number | null;
    }
  | {
      readonly kind: 'blocked';
      readonly marbleId: number;
      readonly color: MarbleColor;
      readonly cell: Cell;
      readonly heartsLeft: number;
      readonly failed: boolean;
    };

export const CHAR_TO_COLOR: Readonly<Record<string, MarbleColor>> = {
  R: 'red',
  B: 'blue',
  G: 'green',
  Y: 'yellow',
  P: 'purple',
  O: 'orange',
};

export const COLOR_TO_CHAR: Readonly<Record<MarbleColor, string>> = {
  red: 'R',
  blue: 'B',
  green: 'G',
  yellow: 'Y',
  purple: 'P',
  orange: 'O',
};

/** The in-grid cell a gate's mouth touches. */
export function gateMouthCell(gate: GateDef, cols: number, rows: number): Cell {
  switch (gate.side) {
    case 'top':
      return { x: gate.index, y: 0 };
    case 'bottom':
      return { x: gate.index, y: rows - 1 };
    case 'left':
      return { x: 0, y: gate.index };
    case 'right':
      return { x: cols - 1, y: gate.index };
  }
}
