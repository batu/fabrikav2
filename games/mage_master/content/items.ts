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

/**
 * Primary-stat ceiling per slot at Common (Rarity & Gear tab: "Weapon = Attack
 * Power; Armor = Health"). The rarity magnitude multiplies it; the roll floor
 * sets the worst roll (content/rarity.ts).
 */
export const PRIMARY_BASE: Readonly<Record<ItemSlot, { readonly stat: StatKey; readonly value: number }>> = {
  weapon: { stat: "atk", value: 22 },
  armor: { stat: "hp", value: 160 },
};

/**
 * Every weapon carries one Element and its own Elemental Damage stat, a second
 * damage stream that scales with rarity like the primary. Ceiling at Common.
 */
export const WEAPON_ELEMENTAL_BASE = 100;

export interface SubstatSpec {
  readonly stat: StatKey;
  /** Ceiling at Common; the roll lands between rollFloor × ceiling and ceiling. */
  readonly base: number;
  /** Multiplied by the rarity magnitude when true; flat across ages otherwise (speeds, crit multiplier). */
  readonly scales: boolean;
}

/** Substat pools per slot. Rarity sets how many are drawn (without replacement). */
export const SUBSTAT_POOL: Readonly<Record<ItemSlot, readonly SubstatSpec[]>> = {
  weapon: [
    { stat: "atkSpeed", base: 0.2, scales: false },
    { stat: "critChance", base: 9, scales: true },
    { stat: "critDamage", base: 0.35, scales: false },
    { stat: "moveSpeed", base: 20, scales: false },
    { stat: "hp", base: 60, scales: true },
  ],
  armor: [
    { stat: "hpRegen", base: 3, scales: true },
    { stat: "dodge", base: 6, scales: true },
    { stat: "block", base: 6, scales: true },
    { stat: "atk", base: 8, scales: true },
    { stat: "moveSpeed", base: 20, scales: false },
  ],
};

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
