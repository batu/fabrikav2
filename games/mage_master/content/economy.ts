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
  /** Soft separation between living units so clusters stay readable. Allies
      hold this distance (times average scale); opposing pairs may close to the
      attacker's reach so melee units still land hits. Per tick the push is at
      most `separationStrength * 2` world units (full overlap at 30 Hz). */
  separation: 44,
  separationStrength: 1.5,
} as const;
