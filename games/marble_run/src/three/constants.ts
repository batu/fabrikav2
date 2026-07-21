/**
 * Marble Run 3D renderer constants — ported verbatim from Sugar3D v1
 * (`src/core/Constants.ts`). Lives beside the renderer to avoid a collision
 * with the Phaser shell's `src/core/Constants.ts`. Only the renderer/gameplay
 * values the ported three.js stack needs are carried here.
 */
export const LEVEL_COUNT = 110;
export const GAMEPLAY_CAMERA_GROUND_ANGLE_DEG = 60;
export type CameraMode = 'perspective' | 'dimetric' | 'isometric' | 'trimetric';
/** DPR 3 nearly triples canvas pixels versus DPR 2 on modern phones; cap the
 * renderer to keep mobile GPU cost predictable. */
export const MAX_RENDER_DPR = 2;
export const LONG_PRESS_ROUTE_MS = 1200;
export const LEVEL_COIN_REWARD = 25;
export const HINT_COIN_COST = 125;

/** World units: 1 = one grid cell. */
export const W3D = {
  CELL: 1,
  MARBLE_R: 0.36,
  TRAY_PAD: 0.85,
  TRAY_DEPTH: 0.55,
  DIMPLE_R: 0.4,
  DIMPLE_DEPTH: 0.1,
  /** Roll speed in cells/sec (v3 energy). */
  ROLL_SPEED: 9,
  ROLL_MIN_S: 0.2,
  SPAWN_STAGGER_S: 0.016,
  DROP_HEIGHT: 2.4,
  TRAIL_EMIT_S: 0.035,
} as const;

export const COLORS3D = {
  // Vivid palette (locked in 2026-07-16): the original candy hues pushed +35%
  // saturation / -8% lightness so marbles dominate the pale board. Single
  // source of truth — the 3D scene, particles, and any DOM consumer all read
  // these values.
  marble: {
    red: 0xff3257,
    blue: 0x1f97ff,
    green: 0x17e847,
    yellow: 0xffc708,
    purple: 0xa449ff,
    orange: 0xff7b24,
  } as Record<string, number>,
  woodTop: 0xffefd7,
  woodSide: 0xbb7650,
  woodRim: 0xe7a977,
  dimple: 0xc996a0,
  bgTop: '#9b7bc7',
  bgBottom: '#6b568e',
} as const;
