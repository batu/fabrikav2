/**
 * Combat math — the master knobs and the formulas from
 * `refs/balance/mage-masters-combat-math.xlsx` (v0.2, 2026-09-07).
 *
 * The sim (src/game/sim/battle.ts) resolves every swing with these; the
 * closed-form helpers below are the workbook's Calculator tab, used by tests
 * to prove the sim's averages match the design and available to any UI that
 * wants to show DPS / Effective Health / Time to Kill.
 */

/** MODEL CONSTANTS: the master knobs (Calculator tab rows 15–19). */
export const COMBAT = {
  /** Fraction of a hit a successful block removes (0.5 = blocked hit deals half). */
  blockReduction: 0.5,
  /** Rating points that buy 50% before the cap. One flat number everywhere: no level, no stage, no growth. */
  ratingSoftness: 100,
  maxCritChance: 0.75,
  maxDodgeChance: 0.6,
  maxBlockChance: 0.75,
} as const;

/** ELEMENTS: a second damage stream that scales with the weapon's Elemental Damage (Calculator rows 49–56). */
export const ELEMENTS_MATH = {
  fire: {
    /** Burn per second, per stack, as a share of Elemental Damage. */
    burnRate: 0.1,
    maxStacks: 3,
    /** Seconds a burn stays lit after the last hit (not in the workbook; kept from the prior sim). */
    durationSec: 3,
    tickSec: 1,
  },
  ice: {
    /** Enemy slow gained for every 100 Elemental Damage. */
    slowPer100: 0.2,
    maxSlow: 0.5,
    /** Seconds a chill lasts (not in the workbook; kept from the prior sim). */
    durationSec: 2.5,
  },
  lightning: {
    /** Share of Elemental Damage that arcs to a nearby enemy. */
    chainFraction: 0.5,
    /** How many nearby enemies one arc can reach. */
    nearbyCount: 1,
    /** World units within which an arc finds its target (not in the workbook; kept from the prior sim). */
    radius: 90,
  },
  arcane: {
    /** Extra damage the target takes for every 100 Elemental Damage. */
    exposePer100: 0.15,
    maxExpose: 0.6,
    /** Seconds an Expose mark lasts (not in the workbook; same window as burn). */
    durationSec: 3,
  },
} as const;

/** Chance = min(cap, Rating / (Rating + Rating Softness)). Negative or zero rating gives 0. */
export function ratingToChance(rating: number, cap: number): number {
  if (rating <= 0) return 0;
  return Math.min(cap, rating / (rating + COMBAT.ratingSoftness));
}

export const critChance = (rating: number): number => ratingToChance(rating, COMBAT.maxCritChance);
export const dodgeChance = (rating: number): number => ratingToChance(rating, COMBAT.maxDodgeChance);
export const blockChance = (rating: number): number => ratingToChance(rating, COMBAT.maxBlockChance);

/** Rating that yields `chance` (inverse of the uncapped conversion); used to express legacy percent stats as ratings. */
export function chanceToRating(chance: number): number {
  if (chance <= 0) return 0;
  if (chance >= 1) throw new Error("chance must be below 100%");
  return (COMBAT.ratingSoftness * chance) / (1 - chance);
}

export interface AttackerStats {
  readonly atk: number;
  readonly atkSpeed: number;
  readonly critRating: number;
  readonly critDamage: number;
}

export interface DefenderStats {
  readonly hp: number;
  readonly dodgeRating: number;
  readonly blockRating: number;
  readonly hpRegen: number;
}

/** 1 + Crit Chance × (Crit Damage − 1). */
export function averageCritBonus(a: AttackerStats): number {
  return 1 + critChance(a.critRating) * (a.critDamage - 1);
}

/** (1 − Dodge) × (1 − Block × Block Reduction): the share of raw damage a defender actually takes. */
export function mitigation(d: DefenderStats): number {
  return (1 - dodgeChance(d.dodgeRating)) * (1 - blockChance(d.blockRating) * COMBAT.blockReduction);
}

/** Attack Power × Average Critical Bonus × (1 − Dodge) × (1 − Block × Block Reduction). */
export function averageDamagePerSwing(a: AttackerStats, d: DefenderStats): number {
  return a.atk * averageCritBonus(a) * mitigation(d);
}

/** Average Damage per Swing × Attacks per Second (the physical stream only). */
export function physicalDps(a: AttackerStats, d: DefenderStats): number {
  return averageDamagePerSwing(a, d) * a.atkSpeed;
}

/** Health ÷ [ (1 − Dodge) × (1 − Block × Block Reduction) ]: raw damage the defender truly absorbs. */
export function effectiveHealth(d: DefenderStats): number {
  return d.hp / mitigation(d);
}

/** Health ÷ (Damage per Second − Health Regeneration); `null` when the defender never dies. */
export function timeToKill(hp: number, dps: number, hpRegen: number): number | null {
  const net = dps - hpRegen;
  if (net <= 0) return null;
  return hp / net;
}

/** Fire: Elemental Damage × Burn Rate × Stacks, per second. */
export function burnDps(elem: number, stacks: number = ELEMENTS_MATH.fire.maxStacks): number {
  return elem * ELEMENTS_MATH.fire.burnRate * Math.min(stacks, ELEMENTS_MATH.fire.maxStacks);
}

/** Lightning: Elemental Damage × Chain Fraction per arc (hits OTHER enemies). */
export function chainDamage(elem: number): number {
  return elem * ELEMENTS_MATH.lightning.chainFraction;
}

/** Ice: min(Maximum Chill, Elemental Damage / 100 × Slow per 100). */
export function chillSlow(elem: number): number {
  return Math.min(ELEMENTS_MATH.ice.maxSlow, Math.max(0, elem / 100) * ELEMENTS_MATH.ice.slowPer100);
}

/** Arcane: min(Maximum Expose, Elemental Damage / 100 × Expose per 100). */
export function exposeAmount(elem: number): number {
  return Math.min(ELEMENTS_MATH.arcane.maxExpose, Math.max(0, elem / 100) * ELEMENTS_MATH.arcane.exposePer100);
}

/** (Physical DPS + Fire burn DPS) × (1 + Expose) on a single target. */
export function combinedDps(physical: number, burn: number, expose: number): number {
  return (physical + burn) * (1 + expose);
}
