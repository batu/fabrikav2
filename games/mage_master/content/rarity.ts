/**
 * The ten rarity "ages", low to high. Rarity does two jobs (design doc §9):
 * magnitude (primary-stat multiplier) and stat count (substats carried).
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

export interface RarityDefinition {
  readonly id: Rarity;
  readonly index: number;
  /** Primary-stat multiplier over the slot base. */
  readonly magnitude: number;
  /** Number of substats rolled on top of the primary stat. */
  readonly substats: number;
  /** Gold received when an item of this age is discarded (or replaced). */
  readonly discardGold: number;
}

const MAGNITUDE = [1, 1.35, 1.8, 2.5, 3.5, 5, 7, 10, 14, 20] as const;
const SUBSTATS = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4] as const;

export const RARITY_TABLE: readonly RarityDefinition[] = RARITIES.map((id, index) => ({
  id,
  index,
  magnitude: MAGNITUDE[index] ?? 1,
  substats: SUBSTATS[index] ?? 0,
  discardGold: 10 * 2 ** index,
}));

export function rarityDefinition(id: Rarity): RarityDefinition {
  const found = RARITY_TABLE[RARITIES.indexOf(id)];
  if (!found) throw new Error(`unknown rarity ${id}`);
  return found;
}
