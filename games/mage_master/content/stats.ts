// Stat vocabulary shared by mages, enemies, and gear. Pure data types; the
// formulas that consume them live in src/game/sim and src/game/economy.

export const STAT_KEYS = [
  "hp",
  "hpRegen",
  "dodge",
  "block",
  "atk",
  "def",
  "atkSpeed",
  "critChance",
  "critDamage",
  "moveSpeed",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export type StatBlock = Readonly<Record<StatKey, number>>;

export const ZERO_STATS: StatBlock = {
  hp: 0,
  hpRegen: 0,
  dodge: 0,
  block: 0,
  atk: 0,
  def: 0,
  atkSpeed: 0,
  critChance: 0,
  critDamage: 0,
  moveSpeed: 0,
};

export function addStats(a: StatBlock, b: Partial<StatBlock>): StatBlock {
  const out: Record<StatKey, number> = { ...a };
  for (const key of STAT_KEYS) out[key] = a[key] + (b[key] ?? 0);
  return out;
}

/** Percent-style stats are stored as fractions (0.25 = 25%). */
export const PERCENT_STATS: ReadonlySet<StatKey> = new Set<StatKey>([
  "dodge",
  "block",
  "critChance",
  "critDamage",
]);
