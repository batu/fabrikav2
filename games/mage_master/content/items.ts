import type { MageClass } from "./mages.ts";
import type { StatKey } from "./stats.ts";

export const ELEMENTS = ["fire", "ice", "lightning", "arcane"] as const;
export type Element = (typeof ELEMENTS)[number];

export const RANGES = ["melee", "ranged"] as const;
export type WeaponRange = (typeof RANGES)[number];

export const PATTERNS = ["single", "aoe"] as const;
export type AttackPattern = (typeof PATTERNS)[number];

export const ITEM_SLOTS = ["weapon", "armor"] as const;
export type ItemSlot = (typeof ITEM_SLOTS)[number];

/** Primary-stat base per slot, before the rarity magnitude and the ±roll. */
export const PRIMARY_BASE: Readonly<Record<ItemSlot, { readonly stat: StatKey; readonly value: number }>> = {
  weapon: { stat: "atk", value: 22 },
  armor: { stat: "hp", value: 160 },
};

/** ±roll applied to the primary stat (0.15 = 85%..115%). */
export const PRIMARY_ROLL = 0.15;

export interface SubstatSpec {
  readonly stat: StatKey;
  /** Flat range (min..max); scaled by rarity magnitude when `scales` is true. */
  readonly min: number;
  readonly max: number;
  readonly scales: boolean;
}

/** Substat pools per slot. Rarity sets how many are drawn (without replacement). */
export const SUBSTAT_POOL: Readonly<Record<ItemSlot, readonly SubstatSpec[]>> = {
  weapon: [
    { stat: "atkSpeed", min: 0.08, max: 0.2, scales: false },
    { stat: "critChance", min: 0.03, max: 0.08, scales: false },
    { stat: "critDamage", min: 0.1, max: 0.35, scales: false },
    { stat: "moveSpeed", min: 8, max: 20, scales: false },
    { stat: "hp", min: 30, max: 60, scales: true },
  ],
  armor: [
    { stat: "def", min: 6, max: 12, scales: true },
    { stat: "hpRegen", min: 1.5, max: 3, scales: true },
    { stat: "dodge", min: 0.02, max: 0.06, scales: false },
    { stat: "block", min: 0.02, max: 0.06, scales: false },
    { stat: "atk", min: 4, max: 8, scales: true },
  ],
};

/** Element status effects (design doc §8). Values are the sim's tunables. */
export const ELEMENT_EFFECTS = {
  fire: { kind: "burn", ticks: 3, tickSec: 1, atkRatioPerTick: 0.25 },
  ice: { kind: "chill", durationSec: 2.5, slow: 0.3 },
  lightning: { kind: "chain", radius: 90, damageRatio: 0.5 },
  arcane: { kind: "pierce", defIgnored: 0.5 },
} as const;

/** AoE hits every enemy within `radius` of the target for `damageRatio` of a single hit. */
export const AOE = { radius: 70, damageRatio: 0.65 } as const;

/** Ranged weapons fire from position; melee weapons close in with moveSpeed. */
export const WEAPON_REACH: Readonly<Record<WeaponRange, number>> = {
  melee: 36,
  ranged: 340,
};

export const PROJECTILE_SPEED = 620;

/** Starting kit: one Common weapon + armor per mage so the first fight is winnable. */
export const STARTER_WEAPON: Readonly<Record<MageClass, { range: WeaponRange; pattern: AttackPattern; element: Element }>> = {
  tank: { range: "melee", pattern: "aoe", element: "ice" },
  warrior: { range: "melee", pattern: "single", element: "fire" },
  support: { range: "ranged", pattern: "aoe", element: "lightning" },
};
