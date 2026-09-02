import { RARITIES, type Rarity } from "./rarity.ts";

/** One pull costs this many Summon Crystals. */
export const PULL_COST_CRYSTALS = 10;

export interface RiftTier {
  readonly tier: number;
  /** Gold to START the upgrade to the next tier (undefined at max). */
  readonly upgradeGold?: number;
  /** Real-time seconds the upgrade takes (undefined at max). */
  readonly upgradeSeconds?: number;
  /** Pull odds per rarity age, in RARITIES order, summing to 100. */
  readonly odds: readonly number[];
}

/**
 * The second idle clock. Each tier reshapes the distribution: probability
 * slides toward rarer ages and the lowest ages drop off entirely (design §9).
 * Real odds are shown in-game from this table.
 */
export const RIFT_TIERS: readonly RiftTier[] = [
  { tier: 0, upgradeGold: 100, upgradeSeconds: 30, odds: [60, 30, 9, 1, 0, 0, 0, 0, 0, 0] },
  { tier: 1, upgradeGold: 300, upgradeSeconds: 60, odds: [45, 35, 15, 4, 1, 0, 0, 0, 0, 0] },
  { tier: 2, upgradeGold: 800, upgradeSeconds: 120, odds: [30, 35, 22, 9, 3, 1, 0, 0, 0, 0] },
  { tier: 3, upgradeGold: 2000, upgradeSeconds: 180, odds: [15, 30, 28, 15, 8, 3, 1, 0, 0, 0] },
  { tier: 4, upgradeGold: 5000, upgradeSeconds: 240, odds: [0, 25, 30, 22, 13, 6, 3, 1, 0, 0] },
  { tier: 5, upgradeGold: 12000, upgradeSeconds: 300, odds: [0, 10, 25, 25, 18, 11, 6, 3, 2, 0] },
  { tier: 6, odds: [0, 0, 15, 25, 22, 15, 10, 7, 4, 2] },
];

export const MAX_RIFT_TIER = RIFT_TIERS.length - 1;

/** Gems to skip the remaining upgrade timer: 1 gem per started 30 s block. */
export const SKIP_SECONDS_PER_GEM = 30;

export function riftTier(tier: number): RiftTier {
  const found = RIFT_TIERS[tier];
  if (!found) throw new Error(`unknown rift tier ${tier}`);
  return found;
}

export function oddsFor(tier: number): readonly { rarity: Rarity; percent: number }[] {
  const t = riftTier(tier);
  return RARITIES.map((rarity, i) => ({ rarity, percent: t.odds[i] ?? 0 }));
}
