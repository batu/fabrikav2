/**
 * Currency tunables (design §10). Every currency has a faucet and a sink.
 * Energy is a grind throttle, never a paywall: cap + regen are sized so a
 * 30-minute session never blocks.
 */
export const ENERGY = {
  cap: 10,
  regenSeconds: 45,
  levelCost: 1,
} as const;

export const STARTING_BALANCE = {
  energy: 10,
  gold: 50,
  crystals: 30,
  gems: 30,
} as const;

/** Offline income is a passive rate keyed to the highest cleared level (§10). */
export const OFFLINE = {
  capHours: 8,
  /** Minimum away time before offline income is granted. */
  minSeconds: 60,
  goldPerHourBase: 30,
  goldPerHourGrowth: 1.3,
  crystalsPerHourPerLevel: 2,
} as const;

/** Gem faucet without IAP: a milestone trickle on first-time level clears. */
export const GEM_MILESTONE_PER_FIRST_CLEAR = 20;

/** Battle sim geometry shared by content and renderer (world units). */
export const ARENA = {
  width: 390,
  /** Height of one stage's playfield; the camp line sits near the bottom. */
  height: 560,
  campLineY: 470,
  spawnTop: 40,
  spawnBottom: 175,
  /** How far the party runs forward between stages (one stage of field). */
  advanceDistance: 560,
  advanceSeconds: 1.2,
  /** After a stage clear the party walks back into formation at its own move
      speed (at most this long), then holds before the run-forward. */
  regroupMaxSeconds: 2.2,
  regroupHoldSeconds: 0.5,
  /** Walk-back speed relative to the mage's move speed. */
  regroupSpeedMult: 1.6,
  /** Body separation between living units (centre to centre, times average
      scale): overlapping bodies are pushed apart by this fraction of the
      overlap every tick, in two passes, so a pile never interpenetrates. */
  separation: 72,
  separationStrength: 0.85,
  /** Body radius (times scale) added to weapon reach, so attacks are measured
      edge to edge and a wide separation never holds melee out of range. */
  bodyRadius: 22,
} as const;
