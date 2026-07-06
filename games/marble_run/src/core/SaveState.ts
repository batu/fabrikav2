/**
 * Persisted progress + settings (storage-guarded — blocked WebViews
 * must not crash module eval).
 */
import { loadPersistedJson, savePersistedJson } from '@fabrikav2/kernel';
import { LEVEL_COUNT, SAVE_KEY } from './Constants';

export interface SaveData {
  v: 2;
  unlocked: number;
  coins: number;
  sfx: boolean;
  music: boolean;
  haptics: boolean;
}

interface LegacySaveData {
  v: 1;
  unlocked?: number;
  sfx?: boolean;
  music?: boolean;
  haptics?: boolean;
}

function defaults(): SaveData {
  return { v: 2, unlocked: 1, coins: 0, sfx: true, music: true, haptics: true };
}

function load(): SaveData {
  const raw = loadPersistedJson<SaveData | LegacySaveData>(
    SAVE_KEY,
    defaults,
    (p) => p.v === 1 || p.v === 2,
  );
  if (raw.v === 2) return { ...defaults(), ...raw };
  return {
    ...defaults(),
    unlocked: Math.min(Math.max(raw.unlocked ?? 1, 1), LEVEL_COUNT),
    sfx: raw.sfx ?? true,
    music: raw.music ?? true,
    haptics: raw.haptics ?? true,
  };
}

export class SaveState {
  private data: SaveData = load();

  get unlocked(): number {
    return this.data.unlocked;
  }
  get coins(): number {
    return this.data.coins;
  }
  get sfxEnabled(): boolean {
    return this.data.sfx;
  }
  get musicEnabled(): boolean {
    return this.data.music;
  }
  get hapticsEnabled(): boolean {
    return this.data.haptics;
  }
  /** True when there is level progress or coins worth resetting. Gates the
   *  settings "reset progress" affordance (see shell/settings.ts). */
  get hasProgress(): boolean {
    return this.data.unlocked > 1 || this.data.coins > 0;
  }

  isUnlocked(levelId: number): boolean {
    return levelId <= this.data.unlocked;
  }
  currentLevel(): number {
    return Math.min(Math.max(this.data.unlocked, 1), LEVEL_COUNT);
  }

  recordWin(levelId: number, coins: number): void {
    this.data.coins += coins;
    if (levelId >= this.data.unlocked && levelId < LEVEL_COUNT) {
      this.data.unlocked = levelId + 1;
    }
    this.save();
  }

  addCoins(coins: number): void {
    this.data.coins += coins;
    this.save();
  }

  spendCoins(cost: number): boolean {
    if (this.data.coins < cost) return false;
    this.data.coins -= cost;
    this.save();
    return true;
  }

  setSetting(key: 'sfx' | 'music' | 'haptics', value: boolean): void {
    this.data[key] = value;
    this.save();
  }

  resetProgress(): void {
    const { sfx, music, haptics } = this.data;
    this.data = { ...defaults(), sfx, music, haptics };
    this.save();
  }

  private save(): void {
    savePersistedJson(SAVE_KEY, this.data);
  }
}

export const saveState = new SaveState();
