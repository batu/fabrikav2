import type { StatBlock } from "./stats.ts";

export const ENEMY_FAMILIES = ["goblin", "wolf", "slime"] as const;
export type EnemyFamily = (typeof ENEMY_FAMILIES)[number];

export type EnemyKind =
  | "goblin_grunt"
  | "goblin_archer"
  | "goblin_chief"
  | "wolf"
  | "wolf_alpha"
  | "slime"
  | "slime_king";

export interface EnemyDefinition {
  readonly id: EnemyKind;
  readonly family: EnemyFamily;
  readonly nameKey: `enemy.${EnemyKind}.name`;
  readonly boss: boolean;
  /** Level-1 stats; scaled per level by LEVEL_SCALING. */
  readonly base: StatBlock;
  /** Attack reach in world units (melee ≈ contact, archer ≈ ranged). */
  readonly reach: number;
  /** Render scale hint (1 = grunt size). */
  readonly scale: number;
  /** Drop table at level 1 (gold scales with level; crystal chance is flat). */
  readonly drops: { readonly gold: number; readonly crystalChance: number; readonly crystals: number };
}

const grunt = (over: Partial<StatBlock>): StatBlock => ({
  hp: 120,
  hpRegen: 0,
  dodge: 0.02,
  block: 0,
  atk: 14,
  def: 5,
  atkSpeed: 1,
  critChance: 0.05,
  critDamage: 1.5,
  moveSpeed: 60,
  ...over,
});

export const ENEMIES: readonly EnemyDefinition[] = [
  {
    id: "goblin_grunt",
    family: "goblin",
    nameKey: "enemy.goblin_grunt.name",
    boss: false,
    base: grunt({}),
    reach: 30,
    scale: 0.88,
    drops: { gold: 3, crystalChance: 0.25, crystals: 1 },
  },
  {
    id: "goblin_archer",
    family: "goblin",
    nameKey: "enemy.goblin_archer.name",
    boss: false,
    base: grunt({ hp: 80, atk: 18, def: 2, atkSpeed: 0.8, moveSpeed: 55 }),
    reach: 210,
    scale: 0.84,
    drops: { gold: 4, crystalChance: 0.3, crystals: 1 },
  },
  {
    id: "goblin_chief",
    family: "goblin",
    nameKey: "enemy.goblin_chief.name",
    boss: true,
    base: grunt({ hp: 900, atk: 40, def: 15, atkSpeed: 0.7, moveSpeed: 50, block: 0.1 }),
    reach: 40,
    scale: 1.6,
    drops: { gold: 40, crystalChance: 1, crystals: 5 },
  },
  {
    id: "wolf",
    family: "wolf",
    nameKey: "enemy.wolf.name",
    boss: false,
    base: grunt({ hp: 100, atk: 20, def: 4, atkSpeed: 1.4, moveSpeed: 110, dodge: 0.08 }),
    reach: 30,
    scale: 0.92,
    drops: { gold: 4, crystalChance: 0.25, crystals: 1 },
  },
  {
    id: "wolf_alpha",
    family: "wolf",
    nameKey: "enemy.wolf_alpha.name",
    boss: true,
    base: grunt({ hp: 1200, atk: 55, def: 12, atkSpeed: 1.2, moveSpeed: 90, dodge: 0.1 }),
    reach: 42,
    scale: 1.7,
    drops: { gold: 55, crystalChance: 1, crystals: 6 },
  },
  {
    id: "slime",
    family: "slime",
    nameKey: "enemy.slime.name",
    boss: false,
    base: grunt({ hp: 160, atk: 12, def: 8, atkSpeed: 0.6, moveSpeed: 40 }),
    reach: 28,
    scale: 0.82,
    drops: { gold: 5, crystalChance: 0.3, crystals: 1 },
  },
  {
    id: "slime_king",
    family: "slime",
    nameKey: "enemy.slime_king.name",
    boss: true,
    base: grunt({ hp: 1800, atk: 45, def: 25, atkSpeed: 0.5, moveSpeed: 35, block: 0.15 }),
    reach: 46,
    scale: 1.9,
    drops: { gold: 70, crystalChance: 1, crystals: 8 },
  },
];

export function enemyDefinition(id: EnemyKind): EnemyDefinition {
  const found = ENEMIES.find((e) => e.id === id);
  if (!found) throw new Error(`unknown enemy ${id}`);
  return found;
}

/** Per-level multipliers: hp and atk compound; stage index nudges both. */
export const LEVEL_SCALING = {
  hpPerLevel: 1.27,
  atkPerLevel: 1.2,
  defPerLevel: 1.12,
  perStage: 0.08,
  goldPerLevel: 1.25,
} as const;
