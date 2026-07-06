/**
 * Marble Run. Real Three.js dimetric scene with
 * reference-style glossy candy marbles, warm toy wood, and chunky mobile UI.
 */
export const TEST_HARNESS_ENABLED: boolean =
  import.meta.env.MODE !== 'production' ||
  import.meta.env.VITE_ENABLE_TEST_HARNESS === 'true';

export const SAVE_KEY = 'marble_run_v5_save';
export const LEVEL_COUNT = 20;
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
  marble: {
    red: 0xff4d6d,
    blue: 0x38a3ff,
    green: 0x44d164,
    yellow: 0xffcc1f,
    purple: 0xb266ff,
    orange: 0xff8a3d,
  } as Record<string, number>,
  woodTop: 0xffefd7,
  woodSide: 0xbb7650,
  woodRim: 0xe7a977,
  dimple: 0xc996a0,
  bgTop: '#9b7bc7',
  bgBottom: '#6b568e',
} as const;
