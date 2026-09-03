import { describe, expect, it } from "vitest";
import { mulberry32 } from "@fabrikav2/kernel";
import { ENERGY, OFFLINE } from "../../content/economy.ts";
import { RARITIES } from "../../content/rarity.ts";
import { PULL_COST_CRYSTALS, RIFT_TIERS, oddsFor } from "../../content/rift.ts";
import { rarityFromOdds } from "../../src/game/economy/items.ts";
import {
  applyOffline,
  canEnterLevel,
  completeLevel,
  defaultSave,
  discardPending,
  enterLevel,
  failLevel,
  pull,
  skipCost,
  skipUpgrade,
  startUpgrade,
  tick,
  usePending,
} from "../../src/game/economy/save.ts";

const T0 = 1_700_000_000_000;

describe("economy", () => {
  it("rift odds tables each sum to 100 and slide toward rare ages", () => {
    for (const tier of RIFT_TIERS) {
      expect(tier.odds.length).toBe(RARITIES.length);
      expect(tier.odds.reduce((a, b) => a + b, 0)).toBe(100);
    }
    expect(oddsFor(0)[0]?.percent).toBeGreaterThan(oddsFor(6)[0]?.percent ?? 0);
    expect(oddsFor(6)[9]?.percent).toBeGreaterThan(0);
  });

  it("rarityFromOdds matches the table in the limit", () => {
    const rand = mulberry32(5);
    const counts = new Map<string, number>();
    const n = 20000;
    for (let i = 0; i < n; i += 1) {
      const r = rarityFromOdds(rand, RIFT_TIERS[2]?.odds ?? []);
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    expect(((counts.get("common") ?? 0) / n) * 100).toBeCloseTo(30, 0);
    expect(counts.has("immortal")).toBe(false);
  });

  it("energy regenerates on tick and never blocks a 30 minute session", () => {
    let s = defaultSave(T0);
    for (let i = 0; i < ENERGY.cap; i += 1) s = enterLevel(s, 1, T0);
    expect(canEnterLevel(s, 1)).toBe(false);
    s = tick(s, T0 + ENERGY.regenSeconds * 1000 * 3);
    expect(s.energy).toBe(3);
    s = tick(s, T0 + ENERGY.regenSeconds * 1000 * 1000);
    expect(s.energy).toBe(ENERGY.cap);
  });

  it("pull, use, and discard move crystals, gold, and gear", () => {
    const rand = mulberry32(11);
    let s = defaultSave(T0);
    const before = s.crystals;
    const pulled = pull(s, rand);
    s = pulled.state;
    expect(s.crystals).toBe(before - PULL_COST_CRYSTALS);
    expect(s.pending).toEqual(pulled.item);
    const used = usePending(s);
    s = used.state;
    expect(s.pending).toBeNull();
    const slot = pulled.item.slot;
    expect(s.loadout[pulled.item.cls][slot].id).toBe(pulled.item.id);
    expect(s.gold).toBeGreaterThan(pulled.state.gold);
    const again = pull(s, rand);
    const discarded = discardPending(again.state);
    expect(discarded.gold).toBeGreaterThan(0);
    expect(discarded.state.pending).toBeNull();
  });

  it("rift upgrade takes real time and gems skip it", () => {
    let s = { ...defaultSave(T0), gold: 10_000 };
    s = startUpgrade(s, T0);
    expect(s.rift.upgradeEndsAt).toBe(T0 + 30_000);
    expect(tick(s, T0 + 10_000).rift.tier).toBe(0);
    expect(tick(s, T0 + 30_000).rift.tier).toBe(1);
    expect(skipCost(s, T0 + 5_000)).toBe(1);
    const skipped = skipUpgrade(s, T0 + 5_000);
    expect(skipped.rift.tier).toBe(1);
    expect(skipped.gems).toBe(s.gems - 1);
  });

  it("offline income accrues from the highest cleared level with a cap", () => {
    const cleared = completeLevel(defaultSave(T0), 1, { gold: 10, crystals: 2 });
    expect(cleared.reward.firstClear).toBe(true);
    expect(cleared.state.gems).toBeGreaterThan(defaultSave(T0).gems);
    const away = applyOffline(cleared.state, T0 + 2 * 3600 * 1000);
    expect(away.grant?.gold).toBe(OFFLINE.goldPerHourBase * 2);
    const capped = applyOffline(cleared.state, T0 + 40 * 3600 * 1000);
    expect(capped.grant?.seconds).toBe(OFFLINE.capHours * 3600);
    expect(applyOffline(defaultSave(T0), T0 + 3600 * 1000).grant).toBeNull();
  });
});

describe("energy countdown", () => {
  it("counts down from the regen interval after a level entry, not from a minute", async () => {
    const { createMageMasterController } = await import("../../src/game/MageMasterController.ts");
    const { ENERGY } = await import("../../content/economy.ts");
    const controller = createMageMasterController({ now: () => 1_000_000, storageKey: "mm-test-countdown" });
    controller.enterLevel(1);
    expect(controller.snapshot().energyNextIn).toBe(ENERGY.regenSeconds);
  });
});

describe("defeat fallback", () => {
  it("losing the newest level drops progression by one, never below the first level", () => {
    const base = { ...defaultSave(0), highestCleared: 4 };
    const loot = { gold: 0, crystals: 0 };
    expect(failLevel(base, loot, 5).highestCleared).toBe(3);
    expect(failLevel(base, loot, 2).highestCleared).toBe(4);
    expect(failLevel({ ...base, highestCleared: 0 }, loot, 1).highestCleared).toBe(0);
  });
});
