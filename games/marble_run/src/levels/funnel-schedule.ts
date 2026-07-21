/**
 * The difficulty funnel that drives the 110-level bake.
 *
 * Pure integer arithmetic: every function here maps a level id to schedule
 * facts (slot, target difficulty, unlocked elements, board size) with no I/O
 * and no randomness, so `scripts/generate-levels.ts` and the unit tests read
 * the same spec. Reference sheet: `refs/basic diff funnel - Sheet1.csv`.
 *
 * The shape of the funnel is deliberate: long ramps that the player blasts
 * through, a band of real resistance, a spike that stings, then a fixed
 * recover level. The ramp and recover targets NEVER scale with progression —
 * scaling them removes the "I got strong" payoff that the whole cycle exists
 * to deliver.
 */
import type { MarbleColor } from '../marble-board/types';

export const LEVEL_TOTAL = 110;

export type Slot = 'onboarding' | 'ramp' | 'band' | 'spike' | 'recover' | 'relax' | 'climax';

/**
 * Levels 1..11 climb from tutorial-trivial to moderate. Spelled out rather
 * than computed: 11 levels spanning targets 1-10 cannot be strictly
 * increasing, and an explicit table makes the one repeat a decision (levels
 * 1 and 2 are both trivial) instead of a rounding accident.
 */
const ONBOARDING_TARGETS: readonly number[] = [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ONBOARDING_END = ONBOARDING_TARGETS.length; // 11

/** The repeating shape of the funnel, starting at level 12. */
const CYCLE: readonly Slot[] = [
  'ramp', 'ramp', 'ramp',
  'band', 'spike', 'recover',
  'band', 'band', 'band', 'spike', 'recover',
  'band', 'band', 'band', 'spike', 'recover',
  'band', 'band', 'climax',
];

const CYCLE_LENGTH = CYCLE.length; // 19

/** Fixed ramp targets — never scaled (see module docstring). */
const RAMP_TARGETS: readonly number[] = [5, 7, 10];
/** Fixed recover target — never scaled. */
const RECOVER_TARGET = 7;
/** Cycle 0 has no climax before it, so its ramp triplet is replaced. */
const CYCLE_ZERO_OPENING: readonly Slot[] = ['band', 'band', 'relax'];
const RELAX_TARGET = 7; // midpoint of the 5-10 relax band

const BAND_BASES: readonly number[] = [11, 12, 13, 14, 15];
const BAND_MAX = 18;
const SPIKE_BASES: readonly number[] = [16, 17, 18];
const SPIKE_MAX = 18;
const CLIMAX_TARGETS: readonly number[] = [19, 20];
/** Per-cycle difficulty creep applied to band and spike slots only. */
const MAX_CREEP = 3;

/** Which cycle/position a post-onboarding level sits at. */
function cyclePosition(id: number): { cycle: number; pos: number } {
  const offset = id - (ONBOARDING_END + 1);
  return { cycle: Math.floor(offset / CYCLE_LENGTH), pos: offset % CYCLE_LENGTH };
}

export function slotFor(id: number): Slot {
  if (id <= ONBOARDING_END) return 'onboarding';
  const { cycle, pos } = cyclePosition(id);
  if (cycle === 0 && pos < CYCLE_ZERO_OPENING.length) return CYCLE_ZERO_OPENING[pos]!;
  return CYCLE[pos]!;
}

/**
 * How many slots of `slot` precede `pos` within one cycle — used to walk the
 * band/spike base lists so consecutive bands are not all identical.
 */
function ordinalWithinCycle(pos: number, slot: Slot): number {
  let n = 0;
  for (let i = 0; i < pos; i += 1) if (CYCLE[i] === slot) n += 1;
  return n;
}

export function targetFor(id: number): number {
  if (id <= ONBOARDING_END) return ONBOARDING_TARGETS[id - 1]!;

  const { cycle, pos } = cyclePosition(id);
  const slot = slotFor(id);
  const creep = Math.min(cycle, MAX_CREEP);

  switch (slot) {
    case 'ramp':
      return RAMP_TARGETS[pos]!; // ramps only ever occupy pos 0-2
    case 'recover':
      return RECOVER_TARGET;
    case 'relax':
      return RELAX_TARGET;
    case 'band':
      return Math.min(BAND_MAX, BAND_BASES[ordinalWithinCycle(pos, 'band') % BAND_BASES.length]! + creep);
    case 'spike':
      return Math.min(SPIKE_MAX, SPIKE_BASES[ordinalWithinCycle(pos, 'spike') % SPIKE_BASES.length]! + creep);
    case 'climax':
      return CLIMAX_TARGETS[cycle % CLIMAX_TARGETS.length]!;
    default:
      throw new Error(`targetFor(${id}): unreachable slot ${slot}`);
  }
}

// ── Teach pins ───────────────────────────────────────────────────────────
// An element never appears before its debut level, and the debut level
// itself is a spotlight: smaller board, one notch easier than the local
// curve, so the new element is legible rather than lost in the noise.

export type Feature = 'green' | 'yellow' | 'plugs' | 'voids' | 'purple' | 'orange';

/**
 * MRB-7 retune. The pins were pulled forward to match the FEEL of the
 * original hand-tuned first ten levels, which introduce green at 3, voids
 * at 6 and plugs at 8 — a first ten that keeps teaching rather than
 * spending four levels on two colors and a bare board.
 *
 * Safe for slots 11+ by construction: every pin is <= 10, so
 * `unlockedColors`, `allowsPlugs` and `allowsVoids` are unchanged for any
 * id >= 11. Only the onboarding stretch moves.
 */
export const TEACH_PINS: Readonly<Record<Feature, number>> = {
  green: 3,
  voids: 6,
  yellow: 7,
  plugs: 8,
  purple: 13,
  orange: 17,
};

/** Colors available from level 1, before any teach pin fires. */
const BASE_COLORS: readonly MarbleColor[] = ['red', 'blue'];
const PINNED_COLORS: ReadonlyArray<readonly [Feature, MarbleColor]> = [
  ['green', 'green'],
  ['yellow', 'yellow'],
  ['purple', 'purple'],
  ['orange', 'orange'],
];

export function isDebutLevel(id: number): boolean {
  return Object.values(TEACH_PINS).includes(id);
}

/** Every color unlocked by level `id` — the teach-pin ceiling. */
export function unlockedColors(id: number): readonly MarbleColor[] {
  const colors = [...BASE_COLORS];
  for (const [feature, color] of PINNED_COLORS) {
    if (id >= TEACH_PINS[feature]) colors.push(color);
  }
  return colors;
}

/**
 * Colors a level actually uses. A teach pin is a floor ("never before its
 * debut"), not a mandate to always use the full palette — and using it is
 * actively wrong on the easy slots: spreading 12 marbles over 6 colors means
 * every marble is immediately free, so waves stay shallow and the level
 * measures far below a ramp target. Fewer colors means marbles stack and
 * block each other, which is what difficulty is made of.
 */
export function paletteFor(id: number): readonly MarbleColor[] {
  const unlocked = unlockedColors(id);
  const target = effectiveTargetFor(id);
  const wanted = target <= 3 ? 2 : target <= 6 ? 3 : target <= 9 ? 4 : target <= 13 ? 5 : 6;
  const chosen = unlocked.slice(0, Math.min(wanted, unlocked.length));

  // A color debuting on an easy slot would otherwise be sliced straight back
  // off — orange debuts at 17, which is a `recover` slot — silently pushing
  // the teach pin later than the schedule says. Force it in.
  const debuting = PINNED_COLORS.find(([feature]) => TEACH_PINS[feature] === id)?.[1];
  if (debuting !== undefined && !chosen.includes(debuting)) chosen.push(debuting);
  return chosen;
}

export function allowsPlugs(id: number): boolean {
  return id >= TEACH_PINS.plugs;
}

export function allowsVoids(id: number): boolean {
  return id >= TEACH_PINS.voids;
}

// ── Board sizing ─────────────────────────────────────────────────────────

export interface BoardSize {
  readonly cols: number;
  readonly rows: number;
  readonly marbleTarget: number;
}

/** Hard ceiling on marbles for ordinary levels in the set. */
export const MARBLE_CAP = 65;

/** Climax-only readability/performance exception to the ordinary cap. */
export const CLIMAX_MARBLE_CAP = 80;

/** Climax boards need a larger playable area to reach their scheduled peak. */
const CLIMAX_BOARD_SIZE = { cols: 11, rows: 13 } as const;

/**
 * Highest non-climax difficulty `scoreLevel` can actually report under
 * MARBLE_CAP.
 *
 * MEASURED, not assumed: sweeping the landmark shapes at 10x12 with 65
 * marbles tops out at ~17.9. The score's marble term is log-normalized
 * against a 120-marble anchor calibrated on the OLD 20-level corpus, whose
 * hardest level carried 78 marbles — so a "20" on that scale literally means
 * more marbles than the ordinary 65 cap permits. Ordinary levels keep that
 * cap; climaxes use the explicit 80-marble exception and larger board above.
 */
export const ACHIEVABLE_MAX_TARGET = 17.5;

/** Measured ceiling after the climax-only 80-marble exception. */
export const CLIMAX_ACHIEVABLE_MAX_TARGET = 18.5;

/**
 * Spikes clamp half a point below climaxes. Without this both saturate at
 * ACHIEVABLE_MAX_TARGET and the climax stops being the peak of its cycle —
 * measured runs had a climax landing BELOW the spike preceding it, which
 * inverts the one beat the whole 19-slot cycle builds toward. The absolute
 * 19-20 target band remains compressed by the score scale, but the ordinary
 * cap still keeps spikes below climaxes.
 */
const SPIKE_CEILING = ACHIEVABLE_MAX_TARGET - 0.5;

export function effectiveTargetFor(id: number): number {
  const slot = slotFor(id);
  // Climax levels have the only cap exception, so their 19/20 schedule
  // targets use the separate, measured 18.5 effective ceiling.
  if (slot === 'climax') return Math.min(targetFor(id), CLIMAX_ACHIEVABLE_MAX_TARGET);
  const ceiling = slot === 'spike' ? SPIKE_CEILING : ACHIEVABLE_MAX_TARGET;
  // A teach-pin debut is a spotlight: one notch easier than the local curve
  // so the new element is legible rather than lost in the noise.
  const spotlight = isDebutLevel(id) ? 1 : 0;
  return Math.max(1, Math.min(targetFor(id), ceiling) - spotlight);
}

/**
 * Marbles needed to land near a given target, fitted to measured
 * `scoreLevel` samples rather than assumed linear — the score is
 * log-normalized in marbles and saturates hard past ~55, so a linear map
 * makes the seed search miss the whole top of the range.
 */
const MARBLE_ANCHORS: ReadonlyArray<readonly [target: number, marbles: number]> = [
  [1, 6], [2, 7], [3, 9], [5, 12], [7, 16], [10, 25],
  [13, 40], [15, 54], [16, 60], [17, 64], [17.5, 65], [19, 80],
];

function interpolate(anchors: typeof MARBLE_ANCHORS, t: number): number {
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (t <= first[0]) return first[1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i += 1) {
    const [x1, y1] = anchors[i]!;
    const [x0, y0] = anchors[i - 1]!;
    if (t <= x1) return y0 + ((t - x0) * (y1 - y0)) / (x1 - x0);
  }
  return last[1];
}

/**
 * Board dimensions follow the target rather than the level id, so a ramp
 * level late in the game really is a small quick board — that is what makes
 * blasting through it feel like power instead of padding.
 *
 * Area is sized to roughly twice the marble count: too tight and the
 * generator jams before hitting `marbleTarget`, too loose and the score's
 * area term inflates difficulty past the target.
 */
/**
 * `buildShape` silently falls back to `plain` on any board smaller than this
 * in either axis (sculpting a tiny board eats the playable region). Mirrored
 * here because the plugs and voids teach pins are BOARD features: shrinking
 * their spotlight board below the sculpt floor makes the debut level render
 * as an ordinary plain board, so the pin never actually fires and the
 * manifest advertises a shape the level does not have. Caught by rendering
 * L9/L12 rather than by any assertion — see `sculptsAt`.
 */
export const MIN_SCULPT_SIZE = 6;

/** Whether a level's board is large enough for a sculpted shape to survive. */
export function sculptsAt(cols: number, rows: number): boolean {
  return cols >= MIN_SCULPT_SIZE && rows >= MIN_SCULPT_SIZE;
}

/** Teach pins that are board features rather than marble colors. */
function needsSculptedBoard(id: number): boolean {
  return id === TEACH_PINS.plugs || id === TEACH_PINS.voids;
}

export function boardSizeFor(id: number): BoardSize {
  const target = effectiveTargetFor(id);
  if (slotFor(id) === 'climax') {
    return {
      ...CLIMAX_BOARD_SIZE,
      marbleTarget: CLIMAX_MARBLE_CAP,
    };
  }
  const spotlight = isDebutLevel(id) ? 1 : 0;
  const marbleTarget = Math.min(MARBLE_CAP, Math.round(interpolate(MARBLE_ANCHORS, target)));

  const wantedArea = marbleTarget * 2;
  // Keep boards portrait-ish (rows ~1.2x cols) to match the phone viewport.
  let cols = Math.min(10, Math.max(4, Math.round(Math.sqrt(wantedArea / 1.2)) - spotlight));
  let rows = Math.min(12, Math.max(4, Math.ceil(wantedArea / cols) - spotlight));

  // A plugs/voids debut must be big enough to actually show plugs/voids.
  if (needsSculptedBoard(id)) {
    cols = Math.max(cols, MIN_SCULPT_SIZE);
    rows = Math.max(rows, MIN_SCULPT_SIZE);
  }
  return { cols, rows, marbleTarget };
}

/** The ordinary 65 cap, with the card's explicit climax-only exception. */
export function marbleCapFor(id: number): number {
  return slotFor(id) === 'climax' ? CLIMAX_MARBLE_CAP : MARBLE_CAP;
}

/**
 * Share of levels REQUESTED as full mirrors. Batu's note on the previous
 * bake: "symmetry is overdone... barely symmetric is worse, and not all
 * levels should be symmetrical". Symmetry is now bimodal (a level is a
 * perfect mirror or clearly asymmetric — see `symmetryMode` in the core
 * generator) and this is the documented rate for the mirrored half.
 *
 * 7/20 = exactly 35%, the midpoint of the card's 30-40% target. 7 is
 * coprime with 20, so the mirrors scatter across the set instead of
 * clumping into runs, and the share holds within any 20-level window.
 *
 * This is the REQUESTED rate; the bake drops the request to 'asymmetric'
 * where the sculpted shape itself is not mirrorable, so the achieved
 * share is at or below this. The bake summary prints the achieved counts.
 */
export const MIRROR_SHARE_NUMERATOR = 7;
export const MIRROR_SHARE_DENOMINATOR = 20;

export function symmetryModeFor(id: number): 'mirror' | 'asymmetric' {
  return (id * MIRROR_SHARE_NUMERATOR) % MIRROR_SHARE_DENOMINATOR < MIRROR_SHARE_NUMERATOR
    ? 'mirror'
    : 'asymmetric';
}

/** Generous openings early, tight late — but never tight on a rest slot. */
export function minOpenersFor(id: number): number {
  const slot = slotFor(id);
  const p = (id - 1) / (LEVEL_TOTAL - 1);
  const curve = 0.05 + 0.45 * (1 - p) ** 2;
  const restFloor = slot === 'ramp' || slot === 'recover' || slot === 'relax' ? 0.15 : 0;
  return Number(Math.max(curve, restFloor).toFixed(3));
}

/** Big satisfying chain finishes on the easy slots, tense thin ones on hard. */
export function lastWavePreferenceFor(id: number): 'cascade' | 'thin' {
  const slot = slotFor(id);
  return slot === 'spike' || slot === 'climax' ? 'thin' : 'cascade';
}

export function openerSpreadFor(id: number): boolean {
  const slot = slotFor(id);
  return slot === 'ramp' || slot === 'recover' || slot === 'relax';
}
