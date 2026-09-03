import { ENERGY } from "../../content/economy.ts";
import { loadPersistedJson, mulberry32, savePersistedJson } from "@fabrikav2/kernel";
import { createAnalytics, createRingBufferSink, type AnalyticsEvent, type RingBufferSink } from "@fabrikav2/sdk/analytics";
import { createHaptics, NotificationType } from "@fabrikav2/sdk/haptics";
import type { IapService } from "@fabrikav2/sdk/iap";
import { LEVEL_COUNT, STAGES_PER_LEVEL } from "../../content/levels.ts";
import { MAGE_CLASSES, type MageClass } from "../../content/mages.ts";
import { riftTier } from "../../content/rift.ts";
import type { GemGrant } from "../../content/shop.ts";
import { gameConfig } from "../../game.config.ts";
import { mageStats, type Item, type Loadout } from "./economy/items.ts";
import {
  applyOffline,
  canEnterLevel,
  canPull,
  canSkipUpgrade,
  canStartUpgrade,
  completeLevel,
  defaultSave,
  discardPending,
  enterLevel,
  failLevel,
  isValidSave,
  pull,
  setSetting,
  withSettingsDefaults,
  skipCost,
  skipUpgrade,
  startUpgrade,
  tick,
  touch,
  unlockedLevel,
  usePending,
  type LevelReward,
  type OfflineGrant,
  type SaveSettings,
  type SaveState,
} from "./economy/save.ts";
import { createGemIapService } from "./shop.ts";
import { createBattle, simulateBattle, type Battle, type PartyMember, FIXED_STEP } from "./sim/battle.ts";
import type { BattleEvent, BattleView, Loot } from "./sim/types.ts";

export type Surface = "menu" | "rift" | "mages" | "shop" | "battle" | "pause" | "settings" | "win" | "fail";
export type Scene = "menu" | "playing" | "paused" | "complete" | "failed";

export interface PartySnapshot {
  readonly cls: MageClass;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
}

export interface MageMasterSnapshot {
  readonly scene: Scene;
  readonly status: "idle" | "playing" | "paused" | "won" | "lost";
  readonly inputReady: boolean;
  readonly settingsOpen: boolean;
  readonly surface: Surface;
  readonly level: number;
  readonly stage: number;
  readonly stageCount: number;
  readonly energy: number;
  readonly energyNextIn: number;
  readonly gold: number;
  readonly crystals: number;
  readonly gems: number;
  readonly riftTier: number;
  readonly riftUpgradeRemaining: number | null;
  readonly pending: Item | null;
  readonly highestCleared: number;
  readonly unlockedLevel: number;
  readonly party: readonly PartySnapshot[];
  readonly loadout: Readonly<Record<MageClass, Loadout>>;
  readonly settings: SaveSettings;
  readonly reward: LevelReward | null;
  readonly loot: Loot | null;
  readonly offline: OfflineGrant | null;
  readonly revealOpen: boolean;
  readonly pulls: number;
  readonly speed: 1 | 2;
}

export interface MageMasterController {
  snapshot(): MageMasterSnapshot;
  subscribe(listener: () => void): () => void;
  /** Wall-clock tick: energy regen, rift timer. Safe to call every second. */
  tick(now?: number): void;
  home(): boolean;
  openRift(): boolean;
  openMages(): boolean;
  openShop(): boolean;
  openSettings(): boolean;
  closeSettings(): boolean;
  setSetting(key: keyof SaveSettings, value: boolean): void;
  enterLevel(level?: number): boolean;
  pause(): boolean;
  resume(): boolean;
  quitBattle(): boolean;
  next(): boolean;
  retry(): boolean;
  pull(): boolean;
  useItem(): boolean;
  discardItem(): boolean;
  dismissReveal(): void;
  upgradeRift(): boolean;
  skipUpgrade(): boolean;
  claimOffline(): void;
  /** App returned to the foreground: accrue offline income and timers. */
  wake(): void;
  toggleSpeed(): void;
  /** Battle clock: called by the renderer each frame with seconds elapsed. */
  advanceBattle(dtSeconds: number): void;
  battleView(): BattleView | null;
  /** Fraction of the next fixed step already elapsed (0..1) — render interpolation between 30 Hz ticks. */
  battleAlpha(): number;
  drainBattleEvents(): BattleEvent[];
  /** Headless: run the active (or a fresh) battle to completion. */
  resolveBattle(outcome: "win" | "lose"): boolean;
  resetSave(): void;
  grantCoins(amount: number): void;
  grantResources(patch: Partial<Pick<SaveState, "gold" | "crystals" | "gems" | "energy">>): void;
  /** Sandbox purchase fulfilment: credit a gem pack and report the faucet. */
  purchaseGems(gems: number, productId: string): void;
  unlockAll(): void;
  drainTrace(): AnalyticsEvent[];
  readonly haptics: ReturnType<typeof createHaptics>;
  /** The store the shop page and its tests share (sandbox provider). */
  readonly iap: IapService<GemGrant>;
}

export interface ControllerOptions {
  readonly storageKey?: string;
  readonly now?: () => number;
  readonly seed?: () => number;
  readonly env?: "development" | "test" | "production";
}

const STORAGE_KEY = "fabrikav2.mage_master.save";
const OUTCOME_DELAY = 0.9;

type GameEvent = "rift_pull" | "rift_upgrade" | "rift_skip" | "item_use" | "item_discard" | "offline_claim" | "battle_quit" | "gems_purchased";

export function createMageMasterController(options: ControllerOptions = {}): MageMasterController {
  const now = options.now ?? (() => Date.now());
  const seed = options.seed ?? (() => Math.floor(Math.random() * 2 ** 31));
  const storageKey = options.storageKey ?? STORAGE_KEY;
  const traceSink: RingBufferSink = createRingBufferSink();
  const analytics = createAnalytics<GameEvent>({
    env: options.env ?? "development",
    sessionId: `mm-${Math.floor(now() / 1000)}`,
    sinks: [traceSink],
    now,
    globalParams: { game_id: gameConfig.id },
  });
  const listeners = new Set<() => void>();

  let save: SaveState = withSettingsDefaults(loadPersistedJson(storageKey, () => defaultSave(now()), isValidSave));
  save = tick(save, now());
  const offlineResult = applyOffline(save, now());
  save = offlineResult.state;
  let offline: OfflineGrant | null = offlineResult.grant;
  let surface: Surface = "menu";
  let settingsOrigin: Surface = "menu";
  let battle: Battle | null = null;
  let battleLevel = 1;
  let battleRand = mulberry32(seed());
  let outcomeTimer = -1;
  let accumulator = 0;
  let reward: LevelReward | null = null;
  let loot: Loot | null = null;
  let revealOpen = false;
  let speed: 1 | 2 = 1;
  const eventQueue: BattleEvent[] = [];
  const haptics = createHaptics({ isEnabled: () => save.settings.haptics });
  const iap = createGemIapService();
  // Warm the store at boot so the shop opens with live prices, never "Unavailable".
  void iap.init();

  analytics.sessionStart({ first_open: save.pulls === 0 && save.highestCleared === 0 });

  const persist = (): void => {
    save = touch(save, now());
    savePersistedJson(storageKey, save);
  };
  const notify = (): void => {
    for (const l of listeners) l();
  };
  const commit = (): void => {
    persist();
    notify();
  };

  const party = (): PartyMember[] =>
    MAGE_CLASSES.map((cls) => {
      const l = save.loadout[cls];
      const traits = l.weapon.weapon ?? { range: "melee", pattern: "single", element: "fire" };
      return { cls, stats: mageStats(cls, l), range: traits.range, pattern: traits.pattern, element: traits.element };
    });

  const scene = (): Scene => {
    switch (surface) {
      case "battle":
        return "playing";
      case "pause":
        return "paused";
      case "win":
        return "complete";
      case "fail":
        return "failed";
      case "settings":
        return settingsOrigin === "pause" ? "paused" : "menu";
      default:
        return "menu";
    }
  };

  const finishBattle = (): void => {
    if (!battle) return;
    const view = battle.view();
    loot = { ...view.loot };
    if (battle.phase === "won") {
      const result = completeLevel(save, battleLevel, view.loot);
      save = result.state;
      reward = result.reward;
      analytics.levelComplete({ level_id: String(battleLevel), level_index: battleLevel - 1 });
      haptics.notification(NotificationType.Success);
      surface = "win";
    } else {
      save = failLevel(save, view.loot);
      reward = null;
      analytics.levelFail({ level_id: String(battleLevel), level_index: battleLevel - 1 });
      haptics.notification(NotificationType.Error);
      surface = "fail";
    }
    commit();
  };

  const startBattle = (level: number): boolean => {
    if (!canEnterLevel(save, level)) return false;
    save = enterLevel(save, level, now());
    battleLevel = level;
    battleRand = mulberry32(seed());
    battle = createBattle({ level, party: party(), seed: Math.floor(battleRand() * 2 ** 31) });
    eventQueue.length = 0;
    accumulator = 0;
    outcomeTimer = -1;
    reward = null;
    loot = null;
    surface = "battle";
    analytics.levelStart({ level_id: String(level), level_index: level - 1 });
    commit();
    return true;
  };

  const snapshot = (): MageMasterSnapshot => {
    const t = now();
    const view = battle?.view() ?? null;
    const partySnap: PartySnapshot[] = view
      ? view.units
          .filter((u) => u.side === "party")
          .map((u) => ({ cls: u.kind as MageClass, hp: Math.round(u.hp), maxHp: u.maxHp, alive: u.alive }))
      : MAGE_CLASSES.map((cls) => {
          const stats = mageStats(cls, save.loadout[cls]);
          return { cls, hp: stats.hp, maxHp: stats.hp, alive: true };
        });
    const energyNextIn =
      save.energy >= ENERGY.cap ? 0 : Math.max(0, Math.ceil((save.energyAt + ENERGY.regenSeconds * 1000 - t) / 1000));
    return {
      scene: scene(),
      status: surface === "battle" ? "playing" : surface === "pause" ? "paused" : surface === "win" ? "won" : surface === "fail" ? "lost" : "idle",
      inputReady: surface === "battle",
      settingsOpen: surface === "settings",
      surface,
      level: view?.level ?? battleLevel,
      stage: view?.stage ?? 1,
      stageCount: STAGES_PER_LEVEL,
      energy: save.energy,
      energyNextIn,
      gold: save.gold,
      crystals: save.crystals,
      gems: save.gems,
      riftTier: save.rift.tier,
      riftUpgradeRemaining: save.rift.upgradeEndsAt === null ? null : Math.max(0, Math.ceil((save.rift.upgradeEndsAt - t) / 1000)),
      pending: save.pending,
      highestCleared: save.highestCleared,
      unlockedLevel: unlockedLevel(save),
      party: partySnap,
      loadout: save.loadout,
      settings: save.settings,
      reward,
      loot,
      offline,
      revealOpen,
      pulls: save.pulls,
      speed,
    };
  };

  return {
    haptics,
    iap,
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener();
      return () => listeners.delete(listener);
    },
    tick(at = now()) {
      const before = save;
      save = tick(save, at);
      if (save !== before) {
        if (save.rift.tier !== before.rift.tier) haptics.notification(NotificationType.Success);
        commit();
      }
    },
    home() {
      if (surface === "battle" || surface === "pause") return false;
      surface = "menu";
      battle = null;
      revealOpen = false;
      notify();
      return true;
    },
    openRift() {
      if (surface !== "menu" && surface !== "mages") return false;
      surface = "rift";
      notify();
      return true;
    },
    openMages() {
      if (surface !== "menu" && surface !== "rift") return false;
      surface = "mages";
      notify();
      return true;
    },
    openShop() {
      if (surface !== "menu" && surface !== "rift" && surface !== "mages") return false;
      surface = "shop";
      notify();
      return true;
    },
    openSettings() {
      if (surface !== "menu" && surface !== "pause" && surface !== "rift" && surface !== "mages" && surface !== "shop") return false;
      settingsOrigin = surface;
      surface = "settings";
      notify();
      return true;
    },
    closeSettings() {
      if (surface !== "settings") return false;
      surface = settingsOrigin;
      notify();
      return true;
    },
    setSetting(key, value) {
      if (save.settings[key] === value) return;
      save = setSetting(save, key, value);
      haptics.impact();
      commit();
    },
    enterLevel(level = unlockedLevel(save)) {
      if (surface !== "menu") return false;
      return startBattle(level);
    },
    pause() {
      if (surface !== "battle") return false;
      surface = "pause";
      notify();
      return true;
    },
    resume() {
      if (surface !== "pause") return false;
      surface = "battle";
      notify();
      return true;
    },
    quitBattle() {
      if (surface !== "pause" && surface !== "battle") return false;
      analytics.track("battle_quit", { level_id: String(battleLevel) });
      battle = null;
      surface = "menu";
      commit();
      return true;
    },
    next() {
      if (surface !== "win") return false;
      const nextLevel = Math.min(LEVEL_COUNT, battleLevel + 1);
      battle = null;
      surface = "menu";
      if (battleLevel >= LEVEL_COUNT || !canEnterLevel(save, nextLevel)) {
        notify();
        return true;
      }
      return startBattle(nextLevel);
    },
    retry() {
      if (surface !== "fail") return false;
      battle = null;
      surface = "menu";
      if (!canEnterLevel(save, battleLevel)) {
        notify();
        return true;
      }
      return startBattle(battleLevel);
    },
    pull() {
      if (surface !== "rift" || !canPull(save)) return false;
      const result = pull(save, battleRand);
      save = result.state;
      revealOpen = true;
      analytics.track("rift_pull", { rarity: result.item.rarity, slot: result.item.slot, tier: save.rift.tier });
      analytics.resourceChange({ currency: "crystals", amount: -10, flow: "sink", reason: "rift_pull", balance: save.crystals });
      haptics.impact();
      commit();
      return true;
    },
    useItem() {
      if (!save.pending) return false;
      const result = usePending(save);
      save = result.state;
      revealOpen = false;
      analytics.track("item_use", { rarity: result.replaced.rarity });
      haptics.notification(NotificationType.Success);
      commit();
      return true;
    },
    discardItem() {
      if (!save.pending) return false;
      const result = discardPending(save);
      save = result.state;
      revealOpen = false;
      analytics.track("item_discard", { gold: result.gold });
      analytics.resourceChange({ currency: "gold", amount: result.gold, flow: "source", reason: "discard", balance: save.gold });
      commit();
      return true;
    },
    dismissReveal() {
      revealOpen = false;
      notify();
    },
    upgradeRift() {
      if (!canStartUpgrade(save)) return false;
      save = startUpgrade(save, now());
      analytics.track("rift_upgrade", { tier: save.rift.tier });
      haptics.impact();
      commit();
      return true;
    },
    skipUpgrade() {
      if (!canSkipUpgrade(save, now())) return false;
      const gems = skipCost(save, now());
      save = skipUpgrade(save, now());
      analytics.track("rift_skip", { gems, tier: save.rift.tier });
      haptics.notification(NotificationType.Success);
      commit();
      return true;
    },
    wake() {
      const t = now();
      const before = save;
      save = tick(save, t);
      const result = applyOffline(save, t);
      save = result.state;
      if (result.grant && surface !== "battle" && surface !== "pause") offline = result.grant;
      else if (result.grant) offline = result.grant;
      if (save !== before || result.grant) commit();
    },
    toggleSpeed() {
      speed = speed === 1 ? 2 : 1;
      haptics.impact();
      notify();
    },
    claimOffline() {
      if (!offline) return;
      analytics.track("offline_claim", { gold: offline.gold, crystals: offline.crystals, seconds: Math.round(offline.seconds) });
      offline = null;
      notify();
    },
    advanceBattle(dtSeconds) {
      if (!battle || surface !== "battle") return;
      if (battle.phase === "won" || battle.phase === "lost") {
        if (outcomeTimer < 0) outcomeTimer = 0;
        outcomeTimer += dtSeconds;
        if (outcomeTimer >= OUTCOME_DELAY) finishBattle();
        return;
      }
      accumulator += Math.min(dtSeconds, 0.25) * speed;
      while (accumulator >= FIXED_STEP) {
        battle.step(FIXED_STEP);
        accumulator -= FIXED_STEP;
      }
      eventQueue.push(...battle.drainEvents());
    },
    battleView() {
      return battle?.view() ?? null;
    },
    battleAlpha() {
      return battle ? Math.max(0, Math.min(1, accumulator / FIXED_STEP)) : 0;
    },
    drainBattleEvents() {
      return eventQueue.splice(0, eventQueue.length);
    },
    resolveBattle(outcome) {
      if (!battle) return false;
      // Solver-bound first: run the real sim. When the party's gear makes the
      // requested outcome impossible, force it so drive states stay reachable.
      const phase = simulateBattle(battle);
      const wanted = outcome === "win" ? "won" : "lost";
      if (phase !== wanted) {
        battle = createBattle({ level: battleLevel, party: party(), seed: Math.floor(battleRand() * 2 ** 31) });
        battle.forceOutcome(wanted);
      }
      eventQueue.length = 0;
      surface = "battle";
      finishBattle();
      return true;
    },
    resetSave() {
      save = defaultSave(now());
      battle = null;
      surface = "menu";
      offline = null;
      reward = null;
      loot = null;
      revealOpen = false;
      commit();
    },
    grantCoins(amount) {
      save = { ...save, gold: Math.max(0, save.gold + amount) };
      commit();
    },
    grantResources(patch) {
      save = { ...save, ...patch };
      commit();
    },
    purchaseGems(gems, productId) {
      save = { ...save, gems: save.gems + gems };
      analytics.track("gems_purchased", { product_id: productId, gems });
      analytics.resourceChange({ currency: "gems", amount: gems, flow: "source", reason: "purchase", balance: save.gems });
      haptics.notification(NotificationType.Success);
      commit();
    },
    unlockAll() {
      save = { ...save, highestCleared: LEVEL_COUNT - 1, energy: 10 };
      commit();
    },
    drainTrace() {
      return traceSink.drain();
    },
  };
}

export function riftTierLabel(tier: number): { gold?: number; seconds?: number } {
  const t = riftTier(tier);
  return { gold: t.upgradeGold, seconds: t.upgradeSeconds };
}
