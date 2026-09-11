import type { StatBlock } from "./stats.ts";

export const MAGE_CLASSES = ["tank", "warrior", "support"] as const;
export type MageClass = (typeof MAGE_CLASSES)[number];

export interface MageDefinition {
  readonly id: MageClass;
  /** Copy key for the display name (design/copy.ts). */
  readonly nameKey: `mage.${MageClass}.name`;
  readonly base: StatBlock;
  /** Arena x position (0..1 of field width) and camp-line offset in world units. */
  readonly slot: { readonly x: number; readonly forward: number };
  /** Support sustain: heal pulse every `everySec` for `atkRatio` × ATK to the lowest ally. */
  readonly sustain?: { readonly everySec: number; readonly atkRatio: number };
}

/**
 * The fixed party. Mages never level; all power = base + equipped gear.
 * Tank buys time (HP/block), Warrior spends it (ATK/speed/crit), Support
 * refills it (regen + heal pulse).
 *
 * Crit, dodge and block are RATING points (combat math v0.2): chance =
 * rating / (rating + 100), capped. The ratings below reproduce the class
 * chances the previous percent-based tuning had (25 → 20% block, 33 → 25%
 * crit). Health absorbs the removed DEF stat (HP × (100 + DEF) / 100).
 */
export const MAGES: readonly MageDefinition[] = [
  {
    id: "tank",
    nameKey: "mage.tank.name",
    base: {
      hp: 1305,
      hpRegen: 4,
      dodge: 3,
      block: 25,
      atk: 30,
      elem: 0,
      atkSpeed: 0.8,
      critChance: 5,
      critDamage: 1.5,
      moveSpeed: 90,
    },
    slot: { x: 0.5, forward: 44 },
  },
  {
    id: "warrior",
    nameKey: "mage.warrior.name",
    base: {
      hp: 470,
      hpRegen: 1,
      dodge: 11,
      block: 0,
      atk: 75,
      elem: 0,
      atkSpeed: 1.5,
      critChance: 33,
      critDamage: 2,
      moveSpeed: 130,
    },
    slot: { x: 0.24, forward: 0 },
  },
  {
    id: "support",
    nameKey: "mage.support.name",
    base: {
      hp: 750,
      hpRegen: 6,
      dodge: 6,
      block: 9,
      atk: 45,
      elem: 0,
      atkSpeed: 1,
      critChance: 11,
      critDamage: 1.6,
      moveSpeed: 110,
    },
    slot: { x: 0.76, forward: 0 },
    sustain: { everySec: 3, atkRatio: 0.8 },
  },
];

export function mageDefinition(id: MageClass): MageDefinition {
  const found = MAGES.find((m) => m.id === id);
  if (!found) throw new Error(`unknown mage ${id}`);
  return found;
}
