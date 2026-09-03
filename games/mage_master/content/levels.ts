import type { EnemyFamily, EnemyKind } from "./enemies.ts";

/** Authored ladder; levels continue past it forever (see `levelSpec`). */
export const LEVEL_COUNT = 10;
/** Past the ladder, per-level scaling exponents grow at this fraction of the authored rate. */
const LATE_LEVEL_RATE = 0.5;
const ENDLESS_FAMILIES: readonly (EnemyFamily | "mixed")[] = ["goblin", "wolf", "slime", "mixed"];
/** Grunt count per stage and boss escorts stop growing here so late stages stay readable. */
const MAX_GRUNTS = 8;
const MAX_ESCORTS = 5;

/** Exponent for the per-level multipliers: authored levels compound fully, endless ones at half rate. */
export function levelExponent(level: number): number {
  return Math.min(level, LEVEL_COUNT) - 1 + Math.max(0, level - LEVEL_COUNT) * LATE_LEVEL_RATE;
}

function familyOf(level: number): EnemyFamily | "mixed" {
  return FAMILY_BY_LEVEL[level - 1] ?? ENDLESS_FAMILIES[(level - LEVEL_COUNT - 1) % ENDLESS_FAMILIES.length] ?? "mixed";
}
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
  const family = familyOf(level);
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
    const escorts = Math.min(MAX_ESCORTS, 2 + Math.floor(level / 4));
    for (let i = 0; i < escorts; i += 1) {
      const pool = GRUNTS[family];
      spawns.push({ kind: pool[i % pool.length] ?? "goblin_grunt", at: 0.2 + i * 0.35 });
    }
    return { index: stage, boss, spawns };
  }
  const count = Math.min(MAX_GRUNTS, 3 + Math.floor((level - 1) / 3) + (stage - 1));
  const pool = GRUNTS[family];
  for (let i = 0; i < count; i += 1) {
    spawns.push({ kind: pool[(i + level) % pool.length] ?? "goblin_grunt", at: i * 0.3 });
  }
  return { index: stage, boss, spawns };
}

function buildLevel(id: number): LevelSpec {
  const exponent = levelExponent(id);
  return {
    id,
    family: familyOf(id),
    stages: Array.from({ length: STAGES_PER_LEVEL }, (_s, s) => buildStage(id, s + 1)),
    clearBonus: { gold: Math.round(20 * 1.3 ** exponent), crystals: 5 + Math.floor(exponent / 2) },
  };
}

const specs = new Map<number, LevelSpec>();

/** Any level id ≥ 1; the game is endless. */
export function levelSpec(id: number): LevelSpec {
  if (!Number.isInteger(id) || id < 1) throw new Error(`unknown level ${id}`);
  let spec = specs.get(id);
  if (!spec) {
    spec = buildLevel(id);
    specs.set(id, spec);
  }
  return spec;
}
