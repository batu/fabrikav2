/**
 * Juice settings — runtime-tunable knobs for the slither animation.
 *
 * Five presets (`off`, `minimal`, `medium`, `full`, `custom`) plus per-knob
 * toggles and sliders. `medium` is the shipping default. Selecting a named
 * preset overwrites individual knobs; touching any knob auto-promotes the
 * preset label to `custom` so the user's deliberate deviation is preserved
 * across re-selects.
 *
 * `toAnimConfig` extracts the animation-relevant subset for slither-anim —
 * render-layer concerns (flash pulse, neighbor jiggle) are consumed directly
 * by loop/render and live outside the per-anim config.
 *
 * See docs/plans/2026-04-18-001-feat-slither-juice-settings-panel-plan.md.
 */

export type JuicePreset = "off" | "minimal" | "medium" | "full" | "custom";

export interface JuiceSettings {
  readonly preset: JuicePreset;
  readonly windupEnabled: boolean;
  readonly windupDurationMs: number;
  readonly slitherCellsPerSec: number;
  readonly collisionHoldMs: number;
  readonly exitStreakFade: boolean;
  readonly headRecoil: boolean;
  readonly bodyShake: boolean;
  readonly redFlashPulse: boolean;
  readonly neighborJiggle: boolean;
  readonly jiggleMagnitudePx: number;
  /** Pre-roll skip — anim.t starts at this value instead of 0.
   *  Effectively 'negative wind-up': jumps the anim past its first
   *  N ms on spawn. At animSkipMs >= windupDurationMs the wind-up
   *  visual is entirely bypassed; further values skip into slither.
   *  Range 0..200. makeAnim caps the effective seed at sEnd so the
   *  impact event still fires for collide anims and exit anims don't
   *  pop done on the first tick (see slither-anim.ts makeAnim). */
  readonly animSkipMs: number;
}

/** Animation-only subset captured at anim spawn time. */
export interface AnimConfig {
  readonly windupEnabled: boolean;
  readonly windupDurationMs: number;
  readonly slitherCellsPerSec: number;
  readonly collisionHoldMs: number;
  readonly exitStreakFade: boolean;
  readonly headRecoil: boolean;
  readonly bodyShake: boolean;
  readonly animSkipMs: number;
}

/** Clamp ranges — used by validate() and the slider UI. */
export const RANGES = {
  windupDurationMs: { min: 0, max: 200 },
  slitherCellsPerSec: { min: 6, max: 24 },
  collisionHoldMs: { min: 100, max: 400 },
  jiggleMagnitudePx: { min: 0, max: 6 },
  animSkipMs: { min: 0, max: 200 },
} as const;

/** Single-tap step size per numeric knob for the ± HUD controls.
 *  Convention: step ≈ range / 20 (≈20 taps to traverse the range).
 *  Lives alongside RANGES so new knobs document both in one place. */
export const STEPS = {
  windupDurationMs: 10,
  slitherCellsPerSec: 2,
  collisionHoldMs: 20,
  animSkipMs: 10,
} as const;

const VALID_PRESETS: ReadonlyArray<JuicePreset> = ["off", "minimal", "medium", "full", "custom"];

type Knobs = Omit<JuiceSettings, "preset">;

const OFF_KNOBS: Knobs = {
  windupEnabled: false,
  windupDurationMs: 0,
  slitherCellsPerSec: 12,
  collisionHoldMs: 100,
  exitStreakFade: false,
  headRecoil: false,
  bodyShake: false,
  redFlashPulse: false,
  neighborJiggle: false,
  jiggleMagnitudePx: 0,
  animSkipMs: 0,
};

const MINIMAL_KNOBS: Knobs = {
  ...OFF_KNOBS,
  redFlashPulse: true,
};

const MEDIUM_KNOBS: Knobs = {
  windupEnabled: true,
  windupDurationMs: 80,
  slitherCellsPerSec: 12,
  collisionHoldMs: 260,
  exitStreakFade: true,
  headRecoil: true,
  bodyShake: true,
  redFlashPulse: true,
  neighborJiggle: false,
  jiggleMagnitudePx: 0,
  animSkipMs: 0,
};

const FULL_KNOBS: Knobs = {
  ...MEDIUM_KNOBS,
  neighborJiggle: true,
  jiggleMagnitudePx: 3,
};

export const DEFAULT_JUICE: JuiceSettings = { preset: "medium", ...MEDIUM_KNOBS };

/**
 * Apply a named preset. For `custom`, preserve the incoming knobs — the
 * preset label just marks the user's deliberate deviation. For named
 * presets, overwrite every knob with the preset's canonical values.
 */
export function applyPreset(preset: JuicePreset, current: JuiceSettings): JuiceSettings {
  switch (preset) {
    case "off":
      return { preset: "off", ...OFF_KNOBS };
    case "minimal":
      return { preset: "minimal", ...MINIMAL_KNOBS };
    case "medium":
      return { preset: "medium", ...MEDIUM_KNOBS };
    case "full":
      return { preset: "full", ...FULL_KNOBS };
    case "custom": {
      const { preset: _p, ...knobs } = current;
      return { preset: "custom", ...knobs };
    }
  }
}

/**
 * Update one knob. Always flips preset → `custom` so the user's
 * deliberate change isn't silently overwritten by a later preset
 * re-select. The "same value" case still promotes — see test
 * rationale.
 */
export function setKnob<K extends keyof Knobs>(
  current: JuiceSettings,
  key: K,
  value: JuiceSettings[K],
): JuiceSettings {
  return { ...current, [key]: value, preset: "custom" };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

function asBool(v: unknown): boolean {
  return Boolean(v);
}

/**
 * Build a JuiceSettings from an untrusted partial payload (e.g.,
 * localStorage). Missing fields fall back to DEFAULT_JUICE, numerics
 * clamp to their documented ranges, unknown preset strings fall back
 * to the default preset.
 */
export function validate(raw: Partial<JuiceSettings>): JuiceSettings {
  const preset: JuicePreset = VALID_PRESETS.includes(raw.preset as JuicePreset)
    ? (raw.preset as JuicePreset)
    : DEFAULT_JUICE.preset;

  const pick = <K extends keyof Knobs>(key: K): JuiceSettings[K] => {
    const v = raw[key];
    return v === undefined ? DEFAULT_JUICE[key] : (v as JuiceSettings[K]);
  };

  return {
    preset,
    windupEnabled: asBool(pick("windupEnabled")),
    windupDurationMs: clamp(
      Number(pick("windupDurationMs")),
      RANGES.windupDurationMs.min,
      RANGES.windupDurationMs.max,
    ),
    slitherCellsPerSec: clamp(
      Number(pick("slitherCellsPerSec")),
      RANGES.slitherCellsPerSec.min,
      RANGES.slitherCellsPerSec.max,
    ),
    collisionHoldMs: clamp(
      Number(pick("collisionHoldMs")),
      RANGES.collisionHoldMs.min,
      RANGES.collisionHoldMs.max,
    ),
    exitStreakFade: asBool(pick("exitStreakFade")),
    headRecoil: asBool(pick("headRecoil")),
    bodyShake: asBool(pick("bodyShake")),
    redFlashPulse: asBool(pick("redFlashPulse")),
    neighborJiggle: asBool(pick("neighborJiggle")),
    jiggleMagnitudePx: clamp(
      Number(pick("jiggleMagnitudePx")),
      RANGES.jiggleMagnitudePx.min,
      RANGES.jiggleMagnitudePx.max,
    ),
    animSkipMs: clamp(
      Number(pick("animSkipMs")),
      RANGES.animSkipMs.min,
      RANGES.animSkipMs.max,
    ),
  };
}

/** Extract the animation-only subset used by slither-anim at spawn. */
export function toAnimConfig(j: JuiceSettings): AnimConfig {
  return {
    windupEnabled: j.windupEnabled,
    windupDurationMs: j.windupDurationMs,
    slitherCellsPerSec: j.slitherCellsPerSec,
    collisionHoldMs: j.collisionHoldMs,
    exitStreakFade: j.exitStreakFade,
    headRecoil: j.headRecoil,
    bodyShake: j.bodyShake,
    animSkipMs: j.animSkipMs,
  };
}
