import { ENERGY, GEM_MILESTONE_PER_FIRST_CLEAR, OFFLINE, STARTING_BALANCE } from "../../../content/economy.ts";
import { levelSpec } from "../../../content/levels.ts";
import { MAGE_CLASSES, type MageClass } from "../../../content/mages.ts";
import { rarityDefinition } from "../../../content/rarity.ts";
import { MAX_RIFT_TIER, PULL_COST_CRYSTALS, SKIP_SECONDS_PER_GEM, riftTier } from "../../../content/rift.ts";
import type { Loot } from "../sim/types.ts";
import { rarityFromOdds, rollItem, starterLoadouts, type Item, type Loadout, type Rng } from "./items.ts";

export interface SaveSettings {
  readonly music: boolean;
  readonly sfx: boolean;
  readonly haptics: boolean;
  /** Minimal interface mod: flat panels, no painted chrome. */
  readonly minimalUi: boolean;
}

export interface SaveState {
  readonly version: 1;
  readonly energy: number;
  /** Epoch ms of the last energy accrual. */
  readonly energyAt: number;
  readonly gold: number;
  readonly crystals: number;
  readonly gems: number;
  readonly rift: { readonly tier: number; readonly upgradeEndsAt: number | null };
  readonly loadout: Readonly<Record<MageClass, Loadout>>;
  /** The last pulled item awaiting Use or Discard. */
  readonly pending: Item | null;
  readonly highestCleared: number;
  readonly lastSeenAt: number;
  readonly settings: SaveSettings;
  readonly pulls: number;
  readonly nextItemId: number;
}

export function defaultSave(now: number): SaveState {
  return {
    version: 1,
    energy: STARTING_BALANCE.energy,
    energyAt: now,
    gold: STARTING_BALANCE.gold,
    crystals: STARTING_BALANCE.crystals,
    gems: STARTING_BALANCE.gems,
    rift: { tier: 0, upgradeEndsAt: null },
    loadout: starterLoadouts(),
    pending: null,
    highestCleared: 0,
    lastSeenAt: now,
    settings: { music: true, sfx: true, haptics: true, minimalUi: true },
    pulls: 0,
    nextItemId: 1,
  };
}

/** Settings added after a save was written default in without a version bump. */
export function withSettingsDefaults(state: SaveState): SaveState {
  return { ...state, settings: { ...defaultSave(state.lastSeenAt).settings, ...state.settings } };
}

export function isValidSave(value: Partial<SaveState>): boolean {
  return (
    value.version === 1 &&
    typeof value.energy === "number" &&
    typeof value.gold === "number" &&
    typeof value.crystals === "number" &&
    typeof value.gems === "number" &&
    typeof value.rift === "object" &&
    value.rift !== null &&
    typeof value.loadout === "object" &&
    value.loadout !== null &&
    MAGE_CLASSES.every((cls) => value.loadout?.[cls]?.weapon !== undefined && value.loadout?.[cls]?.armor !== undefined) &&
    typeof value.highestCleared === "number"
  );
}

/** Accrue energy regen and finish a due rift upgrade. Idempotent for the same `now`. */
export function tick(state: SaveState, now: number): SaveState {
  let next = state;
  if (next.energy < ENERGY.cap) {
    const elapsed = Math.max(0, now - next.energyAt);
    const gained = Math.floor(elapsed / (ENERGY.regenSeconds * 1000));
    if (gained > 0) {
      const energy = Math.min(ENERGY.cap, next.energy + gained);
      const energyAt = energy >= ENERGY.cap ? now : next.energyAt + gained * ENERGY.regenSeconds * 1000;
      next = { ...next, energy, energyAt };
    }
  } else if (next.energyAt !== now) {
    next = { ...next, energyAt: now };
  }
  if (next.rift.upgradeEndsAt !== null && now >= next.rift.upgradeEndsAt) {
    next = { ...next, rift: { tier: Math.min(MAX_RIFT_TIER, next.rift.tier + 1), upgradeEndsAt: null } };
  }
  return next;
}

export interface OfflineGrant {
  readonly seconds: number;
  readonly gold: number;
  readonly crystals: number;
}

export function offlineRate(highestCleared: number): { goldPerHour: number; crystalsPerHour: number } {
  if (highestCleared <= 0) return { goldPerHour: 0, crystalsPerHour: 0 };
  return {
    goldPerHour: Math.round(OFFLINE.goldPerHourBase * OFFLINE.goldPerHourGrowth ** (highestCleared - 1)),
    crystalsPerHour: OFFLINE.crystalsPerHourPerLevel * highestCleared,
  };
}

/** Grant passive offline income for the time away (capped). Returns null when nothing is due. */
export function applyOffline(state: SaveState, now: number): { state: SaveState; grant: OfflineGrant | null } {
  const away = Math.max(0, (now - state.lastSeenAt) / 1000);
  const seen = { ...state, lastSeenAt: now };
  if (away < OFFLINE.minSeconds || state.highestCleared <= 0) return { state: seen, grant: null };
  const seconds = Math.min(away, OFFLINE.capHours * 3600);
  const rate = offlineRate(state.highestCleared);
  const gold = Math.floor((rate.goldPerHour * seconds) / 3600);
  const crystals = Math.floor((rate.crystalsPerHour * seconds) / 3600);
  if (gold <= 0 && crystals <= 0) return { state: seen, grant: null };
  return {
    state: { ...seen, gold: seen.gold + gold, crystals: seen.crystals + crystals },
    grant: { seconds, gold, crystals },
  };
}

export function touch(state: SaveState, now: number): SaveState {
  return state.lastSeenAt === now ? state : { ...state, lastSeenAt: now };
}

export function unlockedLevel(state: SaveState): number {
  return state.highestCleared + 1;
}

export function canEnterLevel(state: SaveState, level: number): boolean {
  return level >= 1 && level <= unlockedLevel(state) && state.energy >= ENERGY.levelCost;
}

export function enterLevel(state: SaveState, level: number, now: number): SaveState {
  if (!canEnterLevel(state, level)) throw new Error(`cannot enter level ${level}`);
  const wasFull = state.energy >= ENERGY.cap;
  return { ...state, energy: state.energy - ENERGY.levelCost, energyAt: wasFull ? now : state.energyAt };
}

export interface LevelReward {
  readonly gold: number;
  readonly crystals: number;
  readonly gems: number;
  readonly firstClear: boolean;
}

export function completeLevel(state: SaveState, level: number, loot: Loot): { state: SaveState; reward: LevelReward } {
  const firstClear = level > state.highestCleared;
  const gems = firstClear ? GEM_MILESTONE_PER_FIRST_CLEAR : 0;
  const reward: LevelReward = { gold: loot.gold, crystals: loot.crystals, gems, firstClear };
  return {
    state: {
      ...state,
      gold: state.gold + loot.gold,
      crystals: state.crystals + loot.crystals,
      gems: state.gems + gems,
      highestCleared: Math.max(state.highestCleared, level),
    },
    reward,
  };
}

export function failLevel(state: SaveState, loot: Loot): SaveState {
  return { ...state, gold: state.gold + loot.gold, crystals: state.crystals + loot.crystals };
}

export function canPull(state: SaveState): boolean {
  return state.pending === null && state.crystals >= PULL_COST_CRYSTALS;
}

export function pull(state: SaveState, rand: Rng): { state: SaveState; item: Item } {
  if (!canPull(state)) throw new Error("cannot pull");
  const tier = riftTier(state.rift.tier);
  const rarity = rarityFromOdds(rand, tier.odds);
  const slot = rand() < 0.5 ? "weapon" : "armor";
  const cls = MAGE_CLASSES[Math.floor(rand() * MAGE_CLASSES.length)] ?? "tank";
  const item = rollItem(rand, { slot, cls, rarity, id: `item-${state.nextItemId}` });
  return {
    state: {
      ...state,
      crystals: state.crystals - PULL_COST_CRYSTALS,
      pending: item,
      pulls: state.pulls + 1,
      nextItemId: state.nextItemId + 1,
    },
    item,
  };
}

export function discardValue(item: Item): number {
  return rarityDefinition(item.rarity).discardGold;
}

/** Equip the pending item on its class-matched mage; the replaced item converts to gold. */
export function usePending(state: SaveState): { state: SaveState; replaced: Item; gold: number } {
  const item = state.pending;
  if (!item) throw new Error("nothing pending");
  const current = state.loadout[item.cls];
  const replaced = item.slot === "weapon" ? current.weapon : current.armor;
  const gold = discardValue(replaced);
  const loadout: Loadout = item.slot === "weapon" ? { weapon: item, armor: current.armor } : { weapon: current.weapon, armor: item };
  return {
    state: { ...state, pending: null, gold: state.gold + gold, loadout: { ...state.loadout, [item.cls]: loadout } },
    replaced,
    gold,
  };
}

export function discardPending(state: SaveState): { state: SaveState; gold: number } {
  const item = state.pending;
  if (!item) throw new Error("nothing pending");
  const gold = discardValue(item);
  return { state: { ...state, pending: null, gold: state.gold + gold }, gold };
}

export function canStartUpgrade(state: SaveState): boolean {
  const tier = riftTier(state.rift.tier);
  return state.rift.upgradeEndsAt === null && tier.upgradeGold !== undefined && state.gold >= tier.upgradeGold;
}

export function startUpgrade(state: SaveState, now: number): SaveState {
  const tier = riftTier(state.rift.tier);
  if (!canStartUpgrade(state) || tier.upgradeGold === undefined || tier.upgradeSeconds === undefined) {
    throw new Error("cannot start upgrade");
  }
  return {
    ...state,
    gold: state.gold - tier.upgradeGold,
    rift: { tier: state.rift.tier, upgradeEndsAt: now + tier.upgradeSeconds * 1000 },
  };
}

export function skipCost(state: SaveState, now: number): number {
  if (state.rift.upgradeEndsAt === null) return 0;
  const remaining = Math.max(0, (state.rift.upgradeEndsAt - now) / 1000);
  return Math.ceil(remaining / SKIP_SECONDS_PER_GEM);
}

export function canSkipUpgrade(state: SaveState, now: number): boolean {
  return state.rift.upgradeEndsAt !== null && state.gems >= skipCost(state, now);
}

export function skipUpgrade(state: SaveState, now: number): SaveState {
  if (!canSkipUpgrade(state, now)) throw new Error("cannot skip upgrade");
  return {
    ...state,
    gems: state.gems - skipCost(state, now),
    rift: { tier: Math.min(MAX_RIFT_TIER, state.rift.tier + 1), upgradeEndsAt: null },
  };
}

export function setSetting(state: SaveState, key: keyof SaveSettings, value: boolean): SaveState {
  return { ...state, settings: { ...state.settings, [key]: value } };
}

export function levelClearBonus(level: number): Loot {
  const spec = levelSpec(level);
  return { gold: spec.clearBonus.gold, crystals: spec.clearBonus.crystals };
}
