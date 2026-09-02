import type { EnemyFamily, EnemyKind } from "./enemies.ts";

export const LEVEL_COUNT = 10;
export const STAGES_PER_LEVEL = 4;

export interface SpawnEntry {
  readonly kind: EnemyKind;
  /** Seconds after the stage starts. */
  readonly at: number;
}

export interface StageSpec {
  readonly index: number;
  readonly boss: boolean;
  readonly spawns: readonly SpawnEntry[];
}

export type ArenaTheme = "sand" | "forest" | "swamp";

export const ARENA_THEME: Readonly<Record<EnemyFamily | "mixed", ArenaTheme>> = {
  goblin: "sand",
  wolf: "forest",
  slime: "swamp",
  mixed: "swamp",
};

export interface LevelSpec {
  readonly id: number;
  readonly family: EnemyFamily | "mixed";
  readonly stages: readonly StageSpec[];
  /** Flat clear bonus on top of enemy drops. */
  readonly clearBonus: { readonly gold: number; readonly crystals: number };
}

const FAMILY_BY_LEVEL: readonly (EnemyFamily | "mixed")[] = [
  "goblin",
  "goblin",
  "goblin",
  "wolf",
  "wolf",
  "wolf",
  "slime",
  "slime",
  "slime",
  "mixed",
];

const GRUNTS: Readonly<Record<EnemyFamily, readonly EnemyKind[]>> = {
  goblin: ["goblin_grunt", "goblin_grunt", "goblin_archer"],
  wolf: ["wolf", "wolf", "wolf"],
  slime: ["slime", "slime", "slime"],
};

const BOSSES: Readonly<Record<EnemyFamily, EnemyKind>> = {
  goblin: "goblin_chief",
  wolf: "wolf_alpha",
  slime: "slime_king",
};

function familyFor(level: number, stage: number): EnemyFamily {
  const family = FAMILY_BY_LEVEL[level - 1] ?? "mixed";
  if (family !== "mixed") return family;
  const order: readonly EnemyFamily[] = ["goblin", "wolf", "slime"];
  return order[(stage - 1) % order.length] ?? "slime";
}

/** Deterministic stage builder: count grows with level and stage; stage 4 = boss + escorts. */
function buildStage(level: number, stage: number): StageSpec {
  const family = familyFor(level, stage);
  const boss = stage === STAGES_PER_LEVEL;
  const spawns: SpawnEntry[] = [];
  if (boss) {
    const bossFamily = level === LEVEL_COUNT ? "slime" : family;
    spawns.push({ kind: BOSSES[bossFamily], at: 0.4 });
    const escorts = 2 + Math.floor(level / 4);
    for (let i = 0; i < escorts; i += 1) {
      const pool = GRUNTS[family];
      spawns.push({ kind: pool[i % pool.length] ?? "goblin_grunt", at: 0.2 + i * 0.35 });
    }
    return { index: stage, boss, spawns };
  }
  const count = 3 + Math.floor((level - 1) / 3) + (stage - 1);
  const pool = GRUNTS[family];
  for (let i = 0; i < count; i += 1) {
    spawns.push({ kind: pool[(i + level) % pool.length] ?? "goblin_grunt", at: i * 0.3 });
  }
  return { index: stage, boss, spawns };
}

export const LEVELS: readonly LevelSpec[] = Array.from({ length: LEVEL_COUNT }, (_v, i) => {
  const id = i + 1;
  return {
    id,
    family: FAMILY_BY_LEVEL[i] ?? "mixed",
    stages: Array.from({ length: STAGES_PER_LEVEL }, (_s, s) => buildStage(id, s + 1)),
    clearBonus: { gold: Math.round(20 * 1.3 ** i), crystals: 5 + Math.floor(i / 2) },
  };
});

export function levelSpec(id: number): LevelSpec {
  const found = LEVELS[id - 1];
  if (!found) throw new Error(`unknown level ${id}`);
  return found;
}
