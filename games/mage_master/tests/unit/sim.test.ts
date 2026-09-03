import { describe, expect, it } from "vitest";
import { MAGE_CLASSES } from "../../content/mages.ts";
import { LEVEL_COUNT, levelExponent, levelSpec } from "../../content/levels.ts";
import { createBattle, simulateBattle, type PartyMember } from "../../src/game/sim/battle.ts";
import { mageStats, rollItem, starterLoadouts, type Loadout } from "../../src/game/economy/items.ts";
import { mulberry32 } from "@fabrikav2/kernel";
import type { MageClass } from "../../content/mages.ts";
import type { Rarity } from "../../content/rarity.ts";

function partyFrom(loadouts: Record<MageClass, Loadout>): PartyMember[] {
  return MAGE_CLASSES.map((cls) => {
    const l = loadouts[cls];
    const weapon = l.weapon.weapon;
    if (!weapon) throw new Error("starter weapon missing traits");
    return { cls, stats: mageStats(cls, l), range: weapon.range, pattern: weapon.pattern, element: weapon.element };
  });
}

function gearedParty(rarity: Rarity, seed = 7): PartyMember[] {
  const rand = mulberry32(seed);
  const loadouts = {} as Record<MageClass, Loadout>;
  const starter = starterLoadouts();
  for (const cls of MAGE_CLASSES) {
    const traits = starter[cls].weapon.weapon;
    loadouts[cls] = {
      weapon: rollItem(rand, { slot: "weapon", cls, rarity, id: `w-${cls}`, traits }),
      armor: rollItem(rand, { slot: "armor", cls, rarity, id: `a-${cls}` }),
    };
  }
  return partyFrom(loadouts);
}

describe("battle sim", () => {
  it("starter party wins level 1 deterministically", () => {
    const battle = createBattle({ level: 1, party: partyFrom(starterLoadouts()), seed: 1 });
    const phase = simulateBattle(battle);
    expect(phase).toBe("won");
    const view = battle.view();
    expect(view.stage).toBe(4);
    expect(view.loot.gold).toBeGreaterThan(0);
  });

  it("emits the moment events a renderer needs", () => {
    const battle = createBattle({ level: 1, party: partyFrom(starterLoadouts()), seed: 2 });
    const seen = new Set<string>();
    let t = 0;
    while (battle.phase !== "won" && battle.phase !== "lost" && t < 600) {
      battle.step(1 / 30);
      for (const e of battle.drainEvents()) seen.add(e.type);
      t += 1 / 30;
    }
    for (const type of ["spawn", "attack", "hit", "death", "stageStart", "stageClear", "advance", "levelWin"]) {
      expect(seen.has(type), `missing event ${type}`).toBe(true);
    }
  });

  it("same seed replays identically", () => {
    const a = createBattle({ level: 3, party: partyFrom(starterLoadouts()), seed: 99 });
    const b = createBattle({ level: 3, party: partyFrom(starterLoadouts()), seed: 99 });
    simulateBattle(a);
    simulateBattle(b);
    expect(a.view().loot).toEqual(b.view().loot);
    expect(a.view().elapsed).toBeCloseTo(b.view().elapsed, 6);
  });

  it("starter gear loses deep levels; high gear clears the ladder", () => {
    const starter = createBattle({ level: 8, party: partyFrom(starterLoadouts()), seed: 3 });
    expect(simulateBattle(starter)).toBe("lost");
    const geared = createBattle({ level: LEVEL_COUNT, party: gearedParty("astral"), seed: 3 });
    expect(simulateBattle(geared)).toBe("won");
  });
});

describe("unit separation", () => {
  it("living units never stack on the same point during a fight", () => {
    const battle = createBattle({ level: 2, party: partyFrom(starterLoadouts()), seed: 5 });
    let minDistance = Number.POSITIVE_INFINITY;
    for (let t = 0; t < 20; t += 1 / 30) {
      battle.step(1 / 30);
      battle.drainEvents();
      const alive = battle.view().units.filter((u) => u.alive);
      for (let i = 0; i < alive.length; i += 1) {
        for (let j = i + 1; j < alive.length; j += 1) {
          const a = alive[i]!;
          const b = alive[j]!;
          minDistance = Math.min(minDistance, Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y));
        }
      }
    }
    expect(minDistance).toBeGreaterThan(8);
  });
});

describe("separation and reach", () => {
  it("melee mages still land hits with the wider ally separation radius", () => {
    const battle = createBattle({ level: 1, party: partyFrom(starterLoadouts()), seed: 3 });
    const melee = new Set(
      battle
        .view()
        .units.filter((u) => u.side === "party" && u.range === "melee")
        .map((u) => u.id),
    );
    expect(melee.size).toBeGreaterThan(0);
    let meleeHits = 0;
    for (let t = 0; t < 12; t += 1 / 30) {
      battle.step(1 / 30);
      for (const e of battle.drainEvents()) if (e.type === "hit" && e.sourceId && melee.has(e.sourceId)) meleeHits += 1;
    }
    expect(meleeHits).toBeGreaterThan(0);
  });
});

describe("endless levels", () => {
  it("builds any level past the authored ladder with capped waves and slower scaling", () => {
    const spec = levelSpec(37);
    expect(spec.stages.length).toBe(4);
    for (const stage of spec.stages) expect(stage.spawns.length).toBeLessThanOrEqual(9);
    expect(levelExponent(LEVEL_COUNT + 10)).toBe(LEVEL_COUNT - 1 + 5);
    // Ultimate gear must make headway at level 25: at least one stage cleared inside four minutes.
    const battle = createBattle({ level: 25, party: gearedParty("ultimate"), seed: 1 });
    let cleared = 0;
    for (let t = 0; t < 240 && battle.phase !== "won" && battle.phase !== "lost"; t += 1 / 30) {
      battle.step(1 / 30);
      for (const e of battle.drainEvents()) if (e.type === "stageClear") cleared += 1;
    }
    expect(cleared).toBeGreaterThanOrEqual(1);
  });
});
