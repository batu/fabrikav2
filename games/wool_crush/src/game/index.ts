/** Wool Crush v0 gameplay kernel — public surface (pure, headless). */

export type {
  Board,
  Color,
  Direction,
  Dragon,
  DragonSection,
  GameState,
  GameStatus,
  GridPos,
  Spool,
  TapLegality,
  Thread,
} from './types.ts';
export { SLOT_COUNT } from './types.ts';

export {
  activeSlots,
  canTapThread,
  cellsOf,
  hasActivePull,
  pathClear,
  tapLegality,
  tapThread,
  tick,
  visibleSections,
} from './engine.ts';

export {
  buildDragon,
  colorTotals,
  createLevelState,
  LEVELS,
  type LevelDef,
  type ThreadSpec,
} from './levels.ts';

export { mulberry32, shuffle } from './rng.ts';
