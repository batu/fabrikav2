export const TEST_HARNESS_ENABLED: boolean =
  import.meta.env.DEV || String(import.meta.env.VITE_ENABLE_TEST_HARNESS) === 'true';

const viewportWidth = window.innerWidth;
const viewportHeight = window.innerHeight;
const portraitViewportWidth = Math.min(viewportWidth, viewportHeight);
const portraitViewportHeight = Math.max(viewportWidth, viewportHeight);

function detectMaxRenderbufferSize(): number {
  const canvas = document.createElement('canvas');
  const gl = (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
  if (!gl) return 4096;
  const value = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
  return typeof value === 'number' && Number.isFinite(value) ? value : 4096;
}

const maxSafeTextureSize = Math.min(4096, detectMaxRenderbufferSize());
const maxSafeTextureDimension = maxSafeTextureSize - 2;
// Shipped landscape levels can produce a mask texture wider than the
// viewport: maskWidth ~= portraitViewportHeight * levelAspect. Keep the
// global DPR low enough that the largest current aspect stays attachable
// on Android WebGL.
const maxLevelMaskAspectRatio = 1.5;
const dpr = Math.min(
  window.devicePixelRatio || 1,
  2,
  maxSafeTextureDimension / portraitViewportWidth,
  maxSafeTextureDimension / portraitViewportHeight,
  maxSafeTextureDimension / (portraitViewportHeight * maxLevelMaskAspectRatio),
);

export const DPR: number = dpr;

// Use full device dimensions — the game does cover-scaling for level images,
// so the canvas should fill the entire screen with no gaps.
export const GAME = {
  WIDTH: Math.round(portraitViewportWidth * dpr),
  HEIGHT: Math.round(portraitViewportHeight * dpr),
} as const;

export const TIMING = {
  REVEAL_MS: 600,
  WRONG_TAP_FADE_MS: 500,
  PENALTY_COOLDOWN_MS: 300,
  LEVEL_COMPLETE_DELAY_MS: 300,
  RESTORATION_PICKUP_FLY_MS: 680,
  // Miss-juice: gentle board wobble + dust poof. Reduced-motion uses the
  // shorter shake; the poof is skipped entirely under reduced-motion.
  MISS_SHAKE_MS: 130,
  MISS_SHAKE_MS_REDUCED: 70,
  DUST_POOF_LIFESPAN_MS: 380,
  DUST_POOF_DESTROY_MS: 600,
} as const;

export const GAMEPLAY = {
  TOLERANCE_MULTIPLIER: 3.0,
  LIVES_PER_LEVEL: 3,
  INITIAL_HINTS: 3,
  MAX_HINT_BALANCE: 3,
  /** Max movement between pointer-down and pointer-up that still counts as a tap.
   *  Phaser reports pointer coordinates in the game's internal canvas pixels,
   *  while the canvas itself is DPR-scaled, so this uses a 12 CSS-pixel slop
   *  multiplied by DPR. Too low cancels normal finger wobble on taps; too high
   *  lets short drags/pans accidentally fire guesses. */
  DRAG_TAP_THRESHOLD_PX: Math.round(12 * dpr),
  PARTICLE_COUNT: 12,
  DUST_PARTICLE_COUNT: 8,
  // cameras.main.shake intensity for the miss wobble (full / reduced-motion).
  // Deliberately soft — a small "no" nudge, not a punishing jolt.
  MISS_SHAKE_INTENSITY: 0.0035,
  MISS_SHAKE_INTENSITY_REDUCED: 0.0018,
  RESTORATION_PICKUP_LANDING_SIZE_PX: Math.round(30 * dpr),
  RESTORATION_PICKUP_MIN_ARC_PX: Math.round(80 * dpr),
} as const;

export const COLORS = {
  BG: 0xf5f0e8,
  WRONG_TAP: 0xff4444,
  HINT_CIRCLE: 0x35a7ff, // vivid sky blue — must pop against both jungle greens and autumn oranges
} as const;
