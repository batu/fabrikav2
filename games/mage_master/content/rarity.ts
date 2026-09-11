/**
 * The ten rarity "ages", low to high. Rarity does two jobs (combat math v0.2,
 * Rarity & Gear tab): magnitude (Primary Stat Multiplier = growth^(age−1))
 * and stat count (Number of Substats = min(max, floor(age / 2))).
 * Colors are CSS token names resolved in design/tokens.css, never literals here.
 */
export const RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
  "immortal",
  "astral",
  "celestial",
  "ultimate",
] as const;

export type Rarity = (typeof RARITIES)[number];

/** MASTER SETTINGS (Rarity & Gear tab rows 6–8). */
export const RARITY_RULES = {
  /** Each age up multiplies the ceiling by this. */
  growthPerAge: 1.6,
  /** The most substats any single item can carry. */
  maxSubstats: 5,
  /** Every stat rolls between this fraction of its tier ceiling and the ceiling. */
  rollFloor: 0.75,
} as const;

export interface RarityDefinition {
  readonly id: Rarity;
  readonly index: number;
  /** Tier number, 1 (Common) to 10 (Ultimate). */
  readonly age: number;
  /** Primary Stat Multiplier over the slot base: growth^(age − 1). Sets the ceiling. */
  readonly magnitude: number;
  /** Number of substats rolled on top of the primary stat. */
  readonly substats: number;
  /** Gold received when an item of this age is discarded (or replaced). */
  readonly discardGold: number;
}

export const RARITY_TABLE: readonly RarityDefinition[] = RARITIES.map((id, index) => {
  const age = index + 1;
  return {
    id,
    index,
    age,
    magnitude: RARITY_RULES.growthPerAge ** (age - 1),
    substats: Math.min(RARITY_RULES.maxSubstats, Math.floor(age / 2)),
    discardGold: 10 * 2 ** index,
  };
});

export function rarityDefinition(id: Rarity): RarityDefinition {
  const found = RARITY_TABLE[RARITIES.indexOf(id)];
  if (!found) throw new Error(`unknown rarity ${id}`);
  return found;
}
