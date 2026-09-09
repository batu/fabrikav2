import { loadPersistedJson, savePersistedJson, mulberry32 } from '@fabrikav2/kernel';
import { CARD_BASES, CHARACTERS, META_UPGRADES, WEAPONS, type Card, type MetaKey, type Stat } from '../game/catalog';

export const SAVE_KEY = 'fabrikav2.hill-to-die-on.v1';
export interface MetaSave {
  version: 1; salvage: number; unlockedLevel: number; best: number[]; attempts: number;
  character: number; weapons: number[]; characters: number[]; playerWeapon: number;
  upgrades: Record<MetaKey, number>; layout: number[];
}
// Layout: -2 empty, -1 wall, 0..3 tower weapon. Eight positions clockwise from north.
export function defaultSave(): MetaSave {
  return { version: 1, salvage: 0, unlockedLevel: 1, best: [0, 0], attempts: 0,
    character: 0, characters: [0], weapons: [0, 1], playerWeapon: 0,
    upgrades: { power: 0, learning: 0, fortune: 0, towers: 0 }, layout: [0, -1, -2, -2, -2, -2, -2, -1] };
}
const integer = (n: unknown, max: number): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;
export function validSave(s: Partial<MetaSave>): s is MetaSave {
  if (s.version !== 1 || !integer(s.salvage, 1e9) || !integer(s.attempts, 1e7) || !integer(s.unlockedLevel, 2) || s.unlockedLevel < 1) return false;
  if (!Array.isArray(s.weapons) || !s.weapons.includes(0) || !s.weapons.every(n => integer(n, 3))) return false;
  if (!Array.isArray(s.characters) || !s.characters.includes(0) || !s.characters.every(n => integer(n, 2))) return false;
  if (!integer(s.character, 2) || !s.characters.includes(s.character) || !integer(s.playerWeapon, 3) || !s.weapons.includes(s.playerWeapon)) return false;
  if (!s.upgrades || !META_UPGRADES.every(u => integer(s.upgrades?.[u.key], u.max))) return false;
  if (!Array.isArray(s.best) || s.best.length !== 2 || !s.best.every(n => integer(n, 10))) return false;
  return Array.isArray(s.layout) && s.layout.length === 8 && s.layout.every(n => n === -2 || n === -1 || s.weapons!.includes(n))
    && s.layout.filter(n => n === -1).length <= 2 && s.layout.filter(n => n >= 0).length <= 1 + s.upgrades.towers;
}
export class Progression {
  save: MetaSave;
  constructor(public readonly storageKey = SAVE_KEY) { this.save = loadPersistedJson(storageKey, defaultSave, validSave); }
  persist(): void { savePersistedJson(this.storageKey, this.save); }
  purchase(kind: 'weapon' | 'character' | MetaKey, index = 0): boolean {
    let cost: number;
    if (kind === 'weapon' || kind === 'character') {
      const catalog = kind === 'weapon' ? WEAPONS : CHARACTERS;
      const list = kind === 'weapon' ? this.save.weapons : this.save.characters;
      if (!catalog[index] || list.includes(index)) return false;
      cost = catalog[index].cost;
      if (this.save.salvage < cost) return false;
      list.push(index);
    } else {
      const def = META_UPGRADES.find(u => u.key === kind);
      if (!def || this.save.upgrades[kind] >= def.max) return false;
      cost = def.base * (this.save.upgrades[kind] + 1);
      if (this.save.salvage < cost) return false;
      this.save.upgrades[kind]++;
    }
    this.save.salvage -= cost; this.persist(); return true;
  }
  equip(position: number, weapon: number): boolean {
    if (!Number.isInteger(position) || position < -1 || position > 7 || !Number.isInteger(weapon)) return false;
    if (position === -1) {
      if (!this.save.weapons.includes(weapon)) return false;
      this.save.playerWeapon = weapon;
    } else {
      if (weapon !== -1 && weapon !== -2 && !this.save.weapons.includes(weapon)) return false;
      const others = this.save.layout.filter((_, i) => i !== position);
      if (weapon === -1 && others.filter(n => n === -1).length >= 2) return false;
      if (weapon >= 0 && others.filter(n => n >= 0).length >= 1 + this.save.upgrades.towers) return false;
      this.save.layout[position] = weapon;
    }
    this.persist(); return true;
  }
  selectCharacter(index: number): boolean {
    if (!this.save.characters.includes(index)) return false;
    this.save.character = index; this.save.playerWeapon = CHARACTERS[index].weapon; this.persist(); return true;
  }
  bank(level: number, wave: number, reward: number): void {
    this.save.salvage += reward; this.save.best[level - 1] = Math.max(this.save.best[level - 1], wave);
    if (wave === 10) this.save.unlockedLevel = Math.min(2, Math.max(this.save.unlockedLevel, level + 1));
    this.persist();
  }
}
export class RunStats {
  cards: Card[] = [];
  constructor(readonly meta: MetaSave) {}
  bonus(stat: Stat, weapon = -1): number {
    let value = 0;
    for (const card of this.cards) {
      if (card.stat !== stat) continue;
      if (card.scope === 'all' || card.scope === weapon || (weapon >= 0 && typeof card.scope === 'string' && WEAPONS[weapon].tags.some(t => t === card.scope))) value += card.amount;
    }
    if (stat === 'damage') {
      value += this.meta.upgrades.power * .1 + (this.meta.character === 0 ? .2 : 0);
      if (this.meta.character === 1 && weapon >= 0 && WEAPONS[weapon].tags.includes('fire')) value += .35;
    }
    if (stat === 'area' && this.meta.character === 1) value += .2;
    if (stat === 'xp') value += this.meta.upgrades.learning * .1;
    if (stat === 'luck') value += this.meta.upgrades.fortune * 10;
    return value;
  }
  draft(random: () => number = mulberry32(Date.now())): Card[] {
    const equipped = [...new Set([this.meta.playerWeapon, ...this.meta.layout.filter(n => n >= 0)])];
    const pool = CARD_BASES.filter(c => c.scope === 'all' || equipped.some(w => typeof c.scope === 'number' ? w === c.scope : WEAPONS[w].tags.some(t => t === c.scope)));
    const result: Card[] = [];
    const luck = this.bonus('luck');
    for (let i = 0; i < 3; i++) {
      const base = pool.splice(Math.floor(random() * pool.length), 1)[0];
      const roll = random();
      const legendary = Math.min(.20, .03 + luck * .001);
      const epic = Math.min(.35, .12 + luck * .0015);
      const rare = .30;
      const rank = roll < legendary ? 3 : roll < legendary + epic ? 2 : roll < legendary + epic + rare ? 1 : 0;
      const multiplier = [1, 1.5, 2.25, 3.25][rank];
      const amount = base.stat === 'luck' ? Math.round(10 * multiplier) : (base.stat === 'crit' ? .04 : base.scope === 'all' ? .12 : .22) * multiplier;
      result.push({ ...base, rank, amount });
    }
    return result;
  }
}
