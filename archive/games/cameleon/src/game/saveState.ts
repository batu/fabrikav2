import { loadPersistedJson, savePersistedJson } from "@fabrikav2/kernel";

import { CAMELEON_LEVEL_IDS } from "./level.ts";

const CAMELEON_SAVE_KEY = "@fabrikav2/cameleon/save/v1";

export interface CameleonSaveData {
  readonly v: 1;
  readonly unlockedLevel: number;
  readonly coins: number;
}

export interface CameleonSaveSeedProfile {
  readonly unlockedLevel?: number;
  readonly coins?: number;
}

export interface CameleonProgressStore {
  readonly unlockedLevel: number;
  readonly coins: number;
  isUnlocked(levelNumber: number): boolean;
  recordWin(levelNumber: number, rewardCoins: number): void;
  addCoins(amount: number): void;
  resetSave(): void;
  seedSave(profile: CameleonSaveSeedProfile): void;
}

const LEVEL_COUNT = CAMELEON_LEVEL_IDS.length;

function defaults(): CameleonSaveData {
  return { v: 1, unlockedLevel: 1, coins: 0 };
}

function sanitize(raw: Partial<CameleonSaveData>): CameleonSaveData {
  return {
    v: 1,
    unlockedLevel: clampInt(raw.unlockedLevel, 1, LEVEL_COUNT, 1),
    coins: clampInt(raw.coins, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

function load(): CameleonSaveData {
  return sanitize(loadPersistedJson<CameleonSaveData>(CAMELEON_SAVE_KEY, defaults, (parsed) => parsed.v === 1));
}

export class CameleonSaveState implements CameleonProgressStore {
  private data: CameleonSaveData;
  private readonly persist: boolean;

  constructor(options: { readonly persist?: boolean; readonly data?: CameleonSaveData } = {}) {
    this.persist = options.persist ?? true;
    this.data = options.data ?? (this.persist ? load() : defaults());
  }

  get unlockedLevel(): number {
    return this.data.unlockedLevel;
  }

  get coins(): number {
    return this.data.coins;
  }

  isUnlocked(levelNumber: number): boolean {
    return levelNumber <= this.data.unlockedLevel;
  }

  recordWin(levelNumber: number, rewardCoins: number): void {
    this.data = {
      v: 1,
      unlockedLevel: clampInt(
        Math.max(this.data.unlockedLevel, Math.min(levelNumber + 1, LEVEL_COUNT)),
        1,
        LEVEL_COUNT,
        this.data.unlockedLevel,
      ),
      coins: clampInt(this.data.coins + rewardCoins, 0, Number.MAX_SAFE_INTEGER, this.data.coins),
    };
    this.save();
  }

  addCoins(amount: number): void {
    this.data = {
      ...this.data,
      coins: clampInt(this.data.coins + Math.trunc(amount), 0, Number.MAX_SAFE_INTEGER, this.data.coins),
    };
    this.save();
  }

  resetSave(): void {
    this.data = defaults();
    this.save();
  }

  seedSave(profile: CameleonSaveSeedProfile): void {
    this.data = {
      v: 1,
      unlockedLevel: clampInt(profile.unlockedLevel, 1, LEVEL_COUNT, 1),
      coins: clampInt(profile.coins, 0, Number.MAX_SAFE_INTEGER, 0),
    };
    this.save();
  }

  private save(): void {
    if (this.persist) savePersistedJson(CAMELEON_SAVE_KEY, this.data);
  }
}

export const cameleonSaveState = new CameleonSaveState();

export function createMemoryCameleonSaveState(profile: CameleonSaveSeedProfile = {}): CameleonSaveState {
  const state = new CameleonSaveState({ persist: false });
  state.seedSave(profile);
  return state;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
