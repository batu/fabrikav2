import { describe, expect, it } from "vitest";
import { mulberry32 } from "@fabrikav2/kernel";
import {
  averageDamagePerSwing,
  burnDps,
  chanceToRating,
  chillSlow,
  combinedDps,
  critChance,
  dodgeChance,
  blockChance,
  effectiveHealth,
  exposeAmount,
  physicalDps,
  timeToKill,
} from "../../content/combat.ts";
import { enemyDefinition } from "../../content/enemies.ts";
import { PRIMARY_BASE, WEAPON_ELEMENTAL_BASE } from "../../content/items.ts";
import { MAGE_CLASSES, mageDefinition } from "../../content/mages.ts";
import { RARITIES, RARITY_RULES, RARITY_TABLE, rarityDefinition } from "../../content/rarity.ts";
import { STAT_KEYS } from "../../content/stats.ts";
import { itemStats, mageStats, rollItem, starterLoadouts, type Item } from "../../src/game/economy/items.ts";
import { SAVE_VERSION, defaultSave, isValidSave, migrateSave } from "../../src/game/economy/save.ts";
import { createBattle, type PartyMember } from "../../src/game/sim/battle.ts";

/**
 * Conformance with refs/balance/mage-masters-combat-math.xlsx (v0.2).
 * The numbers below are the workbook's own: the worked example on the
 * "How Combat Works" tab and the four scenarios on the Overview tab.
 */
describe("combat math: workbook calculator", () => {
  const warrior = { atk: 100, atkSpeed: 1.2, critRating: 120, critDamage: 1.75 };

  it("turns ratings into capped chances with diminishing returns", () => {
    expect(critChance(100)).toBeCloseTo(0.5, 6);
    expect(critChance(120)).toBeCloseTo(120 / 220, 6);
    expect(critChance(1_000_000)).toBe(0.75);
    expect(dodgeChance(1_000_000)).toBe(0.6);
    expect(blockChance(1_000_000)).toBe(0.75);
    expect(dodgeChance(0)).toBe(0);
    expect(critChance(chanceToRating(0.25))).toBeCloseTo(0.25, 9);
  });

  it("worked example: Warrior vs Grunt is a 3-second clean kill", () => {
    const grunt = { hp: 500, dodgeRating: 0, blockRating: 0, hpRegen: 0 };
    expect(averageDamagePerSwing(warrior, grunt)).toBeCloseTo(140.9, 1);
    const dps = physicalDps(warrior, grunt);
    expect(dps).toBeCloseTo(169.1, 1);
    expect(timeToKill(grunt.hp, dps, grunt.hpRegen)).toBeCloseTo(2.96, 2);
    expect(effectiveHealth(grunt)).toBe(500);
  });

  it("scenario: Shielded enemy (dodge 33, block 43) halves the swing", () => {
    const shielded = { hp: 500, dodgeRating: 33, blockRating: 43, hpRegen: 0 };
    const dodge = 33 / 133;
    const block = 43 / 143;
    expect(averageDamagePerSwing(warrior, shielded)).toBeCloseTo(100 * (1 + (120 / 220) * 0.75) * (1 - dodge) * (1 - block * 0.5), 6);
    expect(effectiveHealth(shielded)).toBeCloseTo(500 / ((1 - dodge) * (1 - block * 0.5)), 6);
  });

  it("scenario: Tank (3000 hp, dodge 25, block 67) has ~4,700 effective health", () => {
    const tank = { hp: 3000, dodgeRating: 25, blockRating: 67, hpRegen: 0 };
    expect(dodgeChance(25)).toBeCloseTo(0.2, 6);
    expect(effectiveHealth(tank)).toBeCloseTo(3000 / (0.8 * (1 - (67 / 167) * 0.5)), 6);
    expect(effectiveHealth(tank)).toBeGreaterThan(4600);
    expect(effectiveHealth(tank)).toBeLessThan(4800);
  });

  it("scenario: the regeneration wall is unkillable", () => {
    const weak = { atk: 50, atkSpeed: 1.2, critRating: 0, critDamage: 1.5 };
    const wall = { hp: 500, dodgeRating: 0, blockRating: 0, hpRegen: 80 };
    expect(physicalDps(weak, wall)).toBe(60);
    expect(timeToKill(wall.hp, physicalDps(weak, wall), wall.hpRegen)).toBeNull();
  });

  it("elemental layer: Fire + Arcane at 100 Elemental Damage combine to ~229 DPS", () => {
    expect(burnDps(100)).toBeCloseTo(30, 9);
    expect(burnDps(100, 1)).toBeCloseTo(10, 9);
    expect(burnDps(100, 99)).toBeCloseTo(30, 9);
    expect(chillSlow(100)).toBeCloseTo(0.2, 9);
    expect(chillSlow(1000)).toBe(0.5);
    expect(exposeAmount(100)).toBeCloseTo(0.15, 9);
    expect(exposeAmount(1000)).toBe(0.6);
    const grunt = { hp: 500, dodgeRating: 0, blockRating: 0, hpRegen: 0 };
    const combined = combinedDps(physicalDps(warrior, grunt), burnDps(100), exposeAmount(100));
    expect(combined).toBeCloseTo((169.09 + 30) * 1.15, 1);
    expect(timeToKill(500, combined, 0)).toBeCloseTo(2.18, 2);
  });
});

describe("combat math: rarity & gear", () => {
  it("ten ages: magnitude is growth^(age-1), substats are min(max, floor(age/2))", () => {
    expect(RARITY_TABLE.map((r) => r.substats)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
    expect(rarityDefinition("common").magnitude).toBe(1);
    expect(rarityDefinition("uncommon").magnitude).toBeCloseTo(1.6, 9);
    expect(rarityDefinition("ultimate").magnitude).toBeCloseTo(1.6 ** 9, 6);
    expect(rarityDefinition("ultimate").magnitude).toBeGreaterThan(68);
  });

  it("every stat rolls between the roll floor and the ceiling, and weapons carry Elemental Damage", () => {
    const rand = mulberry32(3);
    for (const rarity of RARITIES) {
      const mult = rarityDefinition(rarity).magnitude;
      for (let i = 0; i < 40; i += 1) {
        const weapon = rollItem(rand, { slot: "weapon", cls: "warrior", rarity, id: `w${i}` });
        const armor = rollItem(rand, { slot: "armor", cls: "tank", rarity, id: `a${i}` });
        const atkCeiling = PRIMARY_BASE.weapon.value * mult;
        expect(weapon.primary.value).toBeGreaterThanOrEqual(Math.floor(atkCeiling * RARITY_RULES.rollFloor));
        expect(weapon.primary.value).toBeLessThanOrEqual(Math.ceil(atkCeiling));
        expect(weapon.elemental?.stat).toBe("elem");
        expect(weapon.elemental?.value).toBeGreaterThanOrEqual(Math.floor(WEAPON_ELEMENTAL_BASE * mult * RARITY_RULES.rollFloor));
        expect(weapon.elemental?.value).toBeLessThanOrEqual(Math.ceil(WEAPON_ELEMENTAL_BASE * mult));
        expect(armor.elemental).toBeUndefined();
        expect(weapon.substats.length).toBe(rarityDefinition(rarity).substats);
        expect(armor.substats.length).toBe(rarityDefinition(rarity).substats);
      }
    }
  });

  it("no stat block carries a defense stat", () => {
    expect(STAT_KEYS).not.toContain("def");
    for (const cls of MAGE_CLASSES) expect(Object.keys(mageDefinition(cls).base)).toEqual([...STAT_KEYS]);
    expect(Object.keys(enemyDefinition("slime_king").base).sort()).toEqual([...STAT_KEYS].sort());
  });
});

describe("combat math: the sim matches the calculator", () => {
  function party(): PartyMember[] {
    const loadouts = starterLoadouts();
    return MAGE_CLASSES.map((cls) => {
      const w = loadouts[cls].weapon.weapon;
      if (!w) throw new Error("starter weapon missing traits");
      return { cls, stats: mageStats(cls, loadouts[cls]), range: w.range, pattern: w.pattern, element: w.element };
    });
  }

  it("the warrior's average swing on goblin grunts equals the closed form", () => {
    const stats = mageStats("warrior", starterLoadouts().warrior);
    const grunt = enemyDefinition("goblin_grunt").base;
    const expected = averageDamagePerSwing(
      { atk: stats.atk, atkSpeed: stats.atkSpeed, critRating: stats.critChance, critDamage: stats.critDamage },
      { hp: grunt.hp, dodgeRating: grunt.dodge, blockRating: grunt.block, hpRegen: grunt.hpRegen },
    );
    let swings = 0;
    let total = 0;
    let burnMax = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const battle = createBattle({ level: 1, party: party(), seed });
      const kinds = new Map(battle.view().units.map((u) => [u.id, u.kind]));
      const warriorId = battle.view().units.find((u) => u.kind === "warrior")?.id;
      for (let t = 0; t < 120 && battle.phase !== "won" && battle.phase !== "lost"; t += 1 / 30) {
        battle.step(1 / 30);
        for (const u of battle.view().units) kinds.set(u.id, u.kind);
        for (const e of battle.drainEvents()) {
          if (e.type === "hit" && e.sourceId === warriorId && kinds.get(e.targetId) === "goblin_grunt") {
            if (e.kind === "damage") {
              swings += 1;
              total += e.amount;
            } else if (e.kind === "burn") burnMax = Math.max(burnMax, e.amount);
          }
          if (e.type === "dodge" && e.sourceId === warriorId && kinds.get(e.targetId) === "goblin_grunt") swings += 1;
        }
      }
    }
    expect(swings).toBeGreaterThan(2500);
    const observed = total / swings;
    expect(Math.abs(observed - expected) / expected).toBeLessThan(0.03);
    // Burn ticks never exceed Elemental Damage × Burn Rate × Maximum Stacks.
    expect(burnMax).toBeGreaterThan(0);
    expect(burnMax).toBeLessThanOrEqual(Math.round(burnDps(stats.elem)) + 1);
  });
});

describe("combat math: save migration", () => {
  it("re-rolls version-1 items under the new stat model and keeps progress", () => {
    const fresh = defaultSave(0);
    const legacyItem = (item: Item, extra: { stat: string; value: number }[]): Item =>
      ({ ...item, elemental: undefined, substats: extra as Item["substats"] }) as Item;
    const legacy = {
      ...fresh,
      version: 1,
      gold: 1234,
      highestCleared: 7,
      loadout: {
        tank: {
          weapon: { ...legacyItem(fresh.loadout.tank.weapon, []), rarity: "epic" as const },
          armor: legacyItem(fresh.loadout.tank.armor, [{ stat: "def", value: 12 }, { stat: "dodge", value: 0.04 }]),
        },
        warrior: fresh.loadout.warrior,
        support: fresh.loadout.support,
      },
      pending: { ...legacyItem(fresh.loadout.warrior.weapon, [{ stat: "critChance", value: 0.05 }]), id: "p1", rarity: "rare" as const },
    };
    expect(isValidSave(legacy as never)).toBe(false);
    const migrated = migrateSave(legacy as never) as typeof fresh;
    expect(isValidSave(migrated)).toBe(true);
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.gold).toBe(1234);
    expect(migrated.highestCleared).toBe(7);
    expect(migrated.loadout.tank.weapon.rarity).toBe("epic");
    expect(migrated.loadout.tank.weapon.weapon).toEqual(legacy.loadout.tank.weapon.weapon);
    expect(migrated.loadout.tank.weapon.elemental?.value).toBeGreaterThan(0);
    expect(migrated.pending?.rarity).toBe("rare");
    expect(migrated.pending?.id).toBe("p1");
    for (const cls of MAGE_CLASSES) {
      for (const item of [migrated.loadout[cls].weapon, migrated.loadout[cls].armor]) {
        expect(Object.keys(itemStats(item))).not.toContain("def");
        expect(item.substats.length).toBe(rarityDefinition(item.rarity).substats);
      }
    }
    // Already-current saves pass through untouched.
    expect(migrateSave(fresh)).toBe(fresh);
  });
});
