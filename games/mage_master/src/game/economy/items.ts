import { ELEMENTS, PATTERNS, PRIMARY_BASE, PRIMARY_ROLL, RANGES, STARTER_WEAPON, SUBSTAT_POOL, type AttackPattern, type Element, type ItemSlot, type WeaponRange } from "../../../content/items.ts";
import { MAGE_CLASSES, mageDefinition, type MageClass } from "../../../content/mages.ts";
import { RARITIES, rarityDefinition, type Rarity } from "../../../content/rarity.ts";
import { addStats, type StatBlock, type StatKey } from "../../../content/stats.ts";

export interface ItemStat {
  readonly stat: StatKey;
  readonly value: number;
}

export interface WeaponTraits {
  readonly range: WeaponRange;
  readonly pattern: AttackPattern;
  readonly element: Element;
}

export interface Item {
  readonly id: string;
  readonly slot: ItemSlot;
  readonly cls: MageClass;
  readonly rarity: Rarity;
  readonly primary: ItemStat;
  readonly substats: readonly ItemStat[];
  /** Present on weapons only. */
  readonly weapon?: WeaponTraits;
}

export type Rng = () => number;

function pick<T>(rand: Rng, list: readonly T[]): T {
  const item = list[Math.floor(rand() * list.length)];
  if (item === undefined) throw new Error("pick from empty list");
  return item;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface RollItemOptions {
  readonly slot: ItemSlot;
  readonly cls: MageClass;
  readonly rarity: Rarity;
  readonly id: string;
  /** Fixed traits (starter kit); random when omitted. */
  readonly traits?: WeaponTraits;
}

export function rollItem(rand: Rng, opts: RollItemOptions): Item {
  const rarity = rarityDefinition(opts.rarity);
  const base = PRIMARY_BASE[opts.slot];
  const roll = 1 - PRIMARY_ROLL + rand() * PRIMARY_ROLL * 2;
  const primary: ItemStat = { stat: base.stat, value: Math.round(base.value * rarity.magnitude * roll) };
  const pool = [...SUBSTAT_POOL[opts.slot]];
  const substats: ItemStat[] = [];
  for (let i = 0; i < rarity.substats && pool.length > 0; i += 1) {
    const index = Math.floor(rand() * pool.length);
    const spec = pool.splice(index, 1)[0];
    if (!spec) break;
    const raw = spec.min + rand() * (spec.max - spec.min);
    const value = spec.scales ? Math.round(raw * rarity.magnitude) : round2(raw);
    substats.push({ stat: spec.stat, value });
  }
  const weapon: WeaponTraits | undefined =
    opts.slot === "weapon"
      ? (opts.traits ?? { range: pick(rand, RANGES), pattern: pick(rand, PATTERNS), element: pick(rand, ELEMENTS) })
      : undefined;
  return weapon
    ? { id: opts.id, slot: opts.slot, cls: opts.cls, rarity: opts.rarity, primary, substats, weapon }
    : { id: opts.id, slot: opts.slot, cls: opts.cls, rarity: opts.rarity, primary, substats };
}

export function itemStats(item: Item): Partial<StatBlock> {
  const out: Partial<Record<StatKey, number>> = { [item.primary.stat]: item.primary.value };
  for (const s of item.substats) out[s.stat] = (out[s.stat] ?? 0) + s.value;
  return out;
}

export interface Loadout {
  readonly weapon: Item;
  readonly armor: Item;
}

export function mageStats(cls: MageClass, loadout: Loadout): StatBlock {
  const base = mageDefinition(cls).base;
  return addStats(addStats(base, itemStats(loadout.weapon)), itemStats(loadout.armor));
}

/** A rough single-number power score for comparisons in the UI. */
export function itemPower(item: Item): number {
  const stats = itemStats(item);
  let score = 0;
  for (const [key, value] of Object.entries(stats) as [StatKey, number][]) {
    switch (key) {
      case "atk":
        score += value * 4;
        break;
      case "hp":
        score += value * 0.5;
        break;
      case "def":
        score += value * 2;
        break;
      case "hpRegen":
        score += value * 6;
        break;
      case "atkSpeed":
        score += value * 120;
        break;
      case "critChance":
        score += value * 200;
        break;
      case "critDamage":
        score += value * 80;
        break;
      case "dodge":
      case "block":
        score += value * 150;
        break;
      case "moveSpeed":
        score += value * 0.5;
        break;
    }
  }
  return Math.round(score);
}

/** Starter kit: one Common weapon and armor per mage, deterministic per class. */
export function starterLoadouts(): Record<MageClass, Loadout> {
  const out = {} as Record<MageClass, Loadout>;
  for (const cls of MAGE_CLASSES) {
    const rand: Rng = () => 0.5;
    out[cls] = {
      weapon: rollItem(rand, { slot: "weapon", cls, rarity: "common", id: `starter-${cls}-weapon`, traits: STARTER_WEAPON[cls] }),
      armor: rollItem(rand, { slot: "armor", cls, rarity: "common", id: `starter-${cls}-armor` }),
    };
  }
  return out;
}

export function rarityFromOdds(rand: Rng, odds: readonly number[]): Rarity {
  const total = odds.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < odds.length; i += 1) {
    r -= odds[i] ?? 0;
    if (r < 0) return RARITIES[i] ?? "common";
  }
  return RARITIES[odds.length - 1] ?? "common";
}
