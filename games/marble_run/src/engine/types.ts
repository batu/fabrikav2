/** Re-export shim: engine types live in the local marble-board puzzle module. */
export {
  ALL_MARBLE_COLORS,
  CHAR_TO_COLOR,
  COLOR_TO_CHAR,
  gateMouthCell,
} from '../puzzle/marble-board';
export type {
  Cell,
  CellContent,
  GameStatus,
  GateDef,
  LevelDef,
  MarbleColor,
  MarbleRoutePreview,
  MarbleState,
  Side,
  TapChange,
} from '../puzzle/marble-board';
