import { describe, expect, it } from "vitest";
import { mulberry32 } from "@fabrikav2/kernel";
import { LEVEL_COUNT } from "../../content/levels.ts";
import { MAGE_CLASSES } from "../../content/mages.ts";
import { PULL_COST_CRYSTALS } from "../../content/rift.ts";
import { itemPower, mageStats } from "../../src/game/economy/items.ts";
import {
  canEnterLevel,
  canPull,
  canSkipUpgrade,
  canStartUpgrade,
  completeLevel,
  defaultSave,
  discardPending,
  enterLevel,
  failLevel,
  pull,
  skipUpgrade,
  startUpgrade,
  tick,
  usePending,
  type SaveState,
} from "../../src/game/economy/save.ts";
import { createBattle, simulateBattle, type PartyMember } from "../../src/game/sim/battle.ts";

/**
 * A greedy bot plays the real loop against wall-clock time: enter the highest
 * level, pull whenever it can, equip upgrades, discard the rest, upgrade the
 * Rift with spare gold, skip timers with gems. Battles cost their simulated
 * seconds; menu actions cost a few seconds each. This is the pacing gate for
 * "Batu can play for 30 minutes": energy must never wall the session and
 * progress must keep coming.
 */
function party(save: SaveState): PartyMember[] {
  return MAGE_CLASSES.map((cls) => {
    const l = save.loadout[cls];
    const w = l.weapon.weapon ?? { range: "melee", pattern: "single", element: "fire" };
    return { cls, stats: mageStats(cls, l), range: w.range, pattern: w.pattern, element: w.element };
  });
}

interface Log {
  levelsWon: number;
  levelsLost: number;
  pulls: number;
  equips: number;
  upgrades: number;
  skips: number;
  energyWaits: number;
  highest: number;
}

function playSession(seed: number, minutes: number): Log {
  const rand = mulberry32(seed);
  let now = 1_800_000_000_000;
  const end = now + minutes * 60_000;
  let save = defaultSave(now);
  const log: Log = { levelsWon: 0, levelsLost: 0, pulls: 0, equips: 0, upgrades: 0, skips: 0, energyWaits: 0, highest: 0 };
  const spend = (seconds: number): void => {
    now += seconds * 1000;
    save = tick(save, now);
  };
  let target = 1;
  while (now < end) {
    // Meta phase: pull everything, keep upgrades, fund the rift.
    while (canPull(save)) {
      const pulled = pull(save, rand);
      save = pulled.state;
      log.pulls += 1;
      const current = pulled.item.slot === "weapon" ? save.loadout[pulled.item.cls].weapon : save.loadout[pulled.item.cls].armor;
      if (itemPower(pulled.item) > itemPower(current)) {
        save = usePending(save).state;
        log.equips += 1;
      } else {
        save = discardPending(save).state;
      }
      spend(4);
    }
    if (canStartUpgrade(save)) {
      save = startUpgrade(save, now);
      log.upgrades += 1;
      spend(2);
    }
    if (canSkipUpgrade(save, now) && save.gems >= 10) {
      save = skipUpgrade(save, now);
      log.skips += 1;
    }
    // Battle phase.
    const level = Math.min(LEVEL_COUNT, target);
    if (!canEnterLevel(save, level)) {
      log.energyWaits += 1;
      spend(15);
      continue;
    }
    save = enterLevel(save, level, now);
    const battle = createBattle({ level, party: party(save), seed: Math.floor(rand() * 2 ** 31) });
    const phase = simulateBattle(battle, 240);
    spend(Math.min(240, battle.view().elapsed) + 6);
    const loot = battle.view().loot;
    if (phase === "won") {
      save = completeLevel(save, level, loot).state;
      log.levelsWon += 1;
      log.highest = Math.max(log.highest, level);
      target = Math.min(LEVEL_COUNT, level + 1);
    } else {
      save = failLevel(save, loot);
      log.levelsLost += 1;
      // Farm the previous level while gearing up, then retry.
      target = Math.max(1, level - 1);
    }
  }
  return log;
}

describe("session pacing", () => {
  it("a greedy 30-minute session keeps progressing and never idles on energy", () => {
    const logs = [1, 2, 3].map((seed) => playSession(seed, 30));
    console.info("pacing 30min", JSON.stringify(logs));
    for (const log of logs) {
      expect(log.levelsWon).toBeGreaterThanOrEqual(6);
      expect(log.highest).toBeGreaterThanOrEqual(3);
      expect(log.pulls).toBeGreaterThanOrEqual(8);
      expect(log.energyWaits).toBeLessThanOrEqual(2);
    }
  });

  it("the first pull happens within the first few minutes", () => {
    let save = defaultSave(0);
    expect(save.crystals).toBeGreaterThanOrEqual(PULL_COST_CRYSTALS);
    save = enterLevel(save, 1, 0);
    expect(canPull(save)).toBe(true);
  });
});
