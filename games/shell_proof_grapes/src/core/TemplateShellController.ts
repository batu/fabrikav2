import {
  FlowStates,
  createFlowMachine,
  loadPersistedJson,
  savePersistedJson,
} from "@fabrikav2/kernel";
import type { AnalyticsEvent } from "@fabrikav2/sdk/analytics";
import type { HarnessSaveProfile } from "@fabrikav2/testkit/harness";
import { driveTo as driveToState } from "@fabrikav2/testkit/testing";
import { gameConfig } from "../../game.config.ts";
import { createTemplateSdk, type TemplateSdk, type TemplateSettingKey } from "../sdk/TemplateSdk.ts";

type TemplateSurface = "menu" | "level" | "shop" | "settings" | "pause" | "win" | "fail";
type SettingsOrigin = "menu" | "pause" | null;

export type TemplateShopItemStatus = "available" | "owned" | "locked";

export interface TemplateShopItem {
  readonly id: string;
  readonly status: TemplateShopItemStatus;
}

interface TemplateSettings {
  readonly music: boolean;
  readonly sfx: boolean;
  readonly haptics: boolean;
}

interface PersistedTemplateState {
  readonly currentLevel: number;
  readonly completedLevels: number[];
  readonly currency: number;
  readonly settings: TemplateSettings;
}

export interface TemplateShellSnapshot extends PersistedTemplateState {
  readonly activeLevel: number | null;
  readonly surface: TemplateSurface;
  readonly scene: string;
  readonly status: "idle" | "playing" | "paused" | "won" | "lost";
  readonly inputReady: boolean;
  readonly settingsOpen: boolean;
  readonly settingsOrigin: SettingsOrigin;
  readonly shopOpen: boolean;
  /** Synthetic read-only second currency (state.secondary-currency binding). */
  readonly secondaryCurrency: number;
  /** Read-only sample catalog statuses (state.shop-items binding). */
  readonly shopItems: readonly TemplateShopItem[];
  readonly adProvider: string;
  /** Win claim machine: earned reward (state.reward-amount) + claim idempotency. */
  readonly rewardAmount: number;
  readonly rewardClaimed: boolean;
  readonly rewardClaimedDouble: boolean;
  /** Whether the deterministic proof rewarded-ad seam can currently grant. */
  readonly adAvailable: boolean;
  /** Fail rescue machine: coin-continue cost/affordability + IAP bundle state. */
  readonly continueCost: number;
  readonly continueAffordable: boolean;
  readonly bundleAvailable: boolean;
  readonly bundlePrice: string | null;
}

export interface TemplateShellController {
  readonly sdk: TemplateSdk;
  snapshot(): TemplateShellSnapshot;
  startCurrent(): boolean;
  startLevel(levelId: number): boolean;
  selectNode(levelId: number): boolean;
  pause(): boolean;
  resume(): boolean;
  openShop(): boolean;
  backFromShop(): boolean;
  openSettings(): boolean;
  backFromSettings(): boolean;
  setSetting(key: TemplateSettingKey, enabled: boolean): void;
  win(): boolean;
  lose(): boolean;
  /** Grant the earned reward once and unlock Next. No-op if already claimed. */
  claim(): boolean;
  /** Watch the deterministic rewarded ad; grant 2x once iff the ad is granted. */
  claimDouble(): Promise<boolean>;
  next(): boolean;
  retry(): boolean;
  /** Fail rescue: spend the configured coins to resume, once and only if affordable. */
  continueCoins(): boolean;
  /** Fail rescue: purchase the IAP bundle over the proof seam; resume on success. */
  purchaseBundle(): Promise<boolean>;
  home(): boolean;
  driveTo(state: string): Promise<boolean>;
  gotoState(state: string): boolean;
  sagaNodes(): readonly number[];
  unlockAll(): void;
  grantCoins(amount: number): void;
  resetSave(): void;
  seedSave(profile: HarnessSaveProfile): void;
  trace(): readonly AnalyticsEvent[];
  drainTrace(): AnalyticsEvent[];
}

export interface CreateTemplateShellControllerOptions {
  readonly storageKey?: string;
  readonly now?: () => number;
}

const STORAGE_KEY = "fabrikav2.template-shell";
const LEVEL_COUNT = gameConfig.saga.levels;
const DRIVE_STATES = gameConfig.screens;
/** Synthetic shared controller value behind the optional second currency counter. */
const SECONDARY_CURRENCY_VALUE = 12;
/** Deterministic proof economics for the win-claim and fail-rescue machines. */
const REWARD_BASE = 5;
const CONTINUE_COST = 10;
/** Catalog id of the fail-rescue IAP bundle (a `rescue`-group proof product). */
const BUNDLE_PRODUCT_ID = "rescue_bundle";
/** Read-only sample shop items; ids match the proof catalog and never mutate. */
const SHOP_ITEMS: readonly TemplateShopItem[] = Object.freeze([
  Object.freeze({ id: "item_alpha", status: "available" as const }),
  Object.freeze({ id: "item_beta", status: "owned" as const }),
  Object.freeze({ id: "item_gamma", status: "locked" as const }),
]);
const DEFAULT_STATE: PersistedTemplateState = {
  currentLevel: 2,
  completedLevels: [1],
  currency: 25,
  settings: { music: true, sfx: true, haptics: true },
};

function cloneDefaultState(): PersistedTemplateState {
  return {
    currentLevel: DEFAULT_STATE.currentLevel,
    completedLevels: [...DEFAULT_STATE.completedLevels],
    currency: DEFAULT_STATE.currency,
    settings: { ...DEFAULT_STATE.settings },
  };
}

function isValidPersistedState(value: Partial<PersistedTemplateState>): boolean {
  return (
    typeof value.currentLevel === "number" &&
    Number.isInteger(value.currentLevel) &&
    value.currentLevel >= 1 &&
    value.currentLevel <= LEVEL_COUNT &&
    Array.isArray(value.completedLevels) &&
    value.completedLevels.every((level) => typeof level === "number" && Number.isInteger(level)) &&
    typeof value.currency === "number" &&
    Number.isFinite(value.currency) &&
    typeof value.settings === "object" &&
    value.settings !== null &&
    typeof value.settings.music === "boolean" &&
    typeof value.settings.sfx === "boolean" &&
    typeof value.settings.haptics === "boolean"
  );
}

function normalizedCompleted(levels: readonly number[], currentLevel: number): number[] {
  return [
    ...new Set(
      levels.filter(
        (level) => level >= 1 && (level < currentLevel || (currentLevel === LEVEL_COUNT && level === currentLevel)),
      ),
    ),
  ].sort((a, b) => a - b);
}

/**
 * One owner for gameplay flow, visible surfaces, durable synthetic state, and
 * SDK traces. The DOM renderer and harness both only call this object.
 */
export function createTemplateShellController(
  options: CreateTemplateShellControllerOptions = {},
): TemplateShellController {
  const storageKey = options.storageKey ?? STORAGE_KEY;
  let persisted = loadPersistedJson(storageKey, cloneDefaultState, isValidPersistedState);
  persisted = {
    ...persisted,
    completedLevels: normalizedCompleted(persisted.completedLevels, persisted.currentLevel),
    settings: { ...persisted.settings },
  };

  const machine = createFlowMachine({ optionalStates: [FlowStates.Paused] });
  let surface: TemplateSurface = "menu";
  let settingsOrigin: SettingsOrigin = null;
  // Win-claim sub-state. Set when the win surface is entered; the reward is
  // granted on claim, never on win, so Next stays gated until a claim succeeds
  // and neither claim path can grant twice.
  let rewardAmount = 0;
  let rewardClaimed = false;
  let rewardClaimedDouble = false;
  // Re-entrancy guards for the two async seams (rewarded ad, IAP bundle) so a
  // double tap cannot fire two grants/purchases before the first settles.
  let claimPending = false;
  let bundlePending = false;
  const sdk = createTemplateSdk({
    now: options.now,
    audioSettings: persisted.settings,
    isHapticsEnabled: () => persisted.settings.haptics,
  });

  machine.events.on("menu:enter", () => {
    surface = "menu";
    settingsOrigin = null;
  });
  machine.events.on("level:start", () => {
    surface = "level";
    settingsOrigin = null;
  });
  machine.events.on("level:complete", () => {
    surface = "win";
  });
  machine.events.on("level:fail", () => {
    surface = "fail";
  });
  // The flow machine begins at Boot; the functional shell's first visible
  // surface is always Progression Home.
  machine.toMenu();

  function persist(): void {
    savePersistedJson(storageKey, persisted);
  }

  function enterLevel(levelId: number): boolean {
    if (!machine.can("start")) return false;
    machine.start(String(levelId));
    sdk.levelStarted(levelId);
    return true;
  }

  function enterCurrentLevel(): boolean {
    return enterLevel(persisted.currentLevel);
  }

  function activeLevel(): number | null {
    if (machine.state === FlowStates.Menu || machine.currentLevelId === undefined) return null;
    return Number(machine.currentLevelId);
  }

  function status(): TemplateShellSnapshot["status"] {
    if (surface === "level") return "playing";
    if (surface === "pause") return "paused";
    if (surface === "win") return "won";
    if (surface === "fail") return "lost";
    return "idle";
  }

  function isTerminalProgression(): boolean {
    return persisted.currentLevel === LEVEL_COUNT && persisted.completedLevels.includes(persisted.currentLevel);
  }

  function home(): boolean {
    if (surface === "settings" && settingsOrigin === "menu") {
      surface = "menu";
      settingsOrigin = null;
      return true;
    }
    if (surface === "shop") {
      surface = "menu";
      return true;
    }
    if (machine.state === FlowStates.Menu) {
      surface = "menu";
      settingsOrigin = null;
      return true;
    }
    if (!machine.can("toMenu")) return false;
    machine.toMenu();
    return true;
  }

  function drive(target: string): boolean {
    switch (target) {
      case "menu":
        return home();
      case "level":
        home();
        return enterCurrentLevel();
      case "shop":
        home();
        return openShop();
      case "settings":
        home();
        return openSettings();
      case "pause":
        home();
        if (!enterCurrentLevel()) return false;
        return pause();
      case "win":
        home();
        if (!enterCurrentLevel()) return false;
        return win();
      case "fail":
        home();
        if (!enterCurrentLevel()) return false;
        return lose();
      default:
        return false;
    }
  }

  function openSettings(): boolean {
    if (surface !== "menu" && surface !== "pause") return false;
    settingsOrigin = surface;
    surface = "settings";
    return true;
  }

  function openShop(): boolean {
    // The Shop opens only from Home; Back always returns Home.
    if (surface !== "menu") return false;
    surface = "shop";
    return true;
  }

  function pause(): boolean {
    if (surface !== "level" || !machine.can("pause")) return false;
    machine.pause();
    surface = "pause";
    sdk.paused();
    return true;
  }

  function win(): boolean {
    if (surface !== "level" || !machine.can("complete")) return false;
    const completedLevel = activeLevel() ?? persisted.currentLevel;
    const alreadyCompleted = persisted.completedLevels.includes(completedLevel);
    // The earned reward is exposed now but granted only on claim; a replay (or a
    // final-level re-win) earns nothing, preserving reward idempotency.
    rewardAmount = alreadyCompleted ? 0 : REWARD_BASE;
    rewardClaimed = false;
    rewardClaimedDouble = false;
    claimPending = false;
    const nextLevel = Math.min(LEVEL_COUNT, completedLevel + 1);
    // Progression advances on completion (the level is genuinely cleared); only
    // the coin grant is deferred to the claim step.
    if (!alreadyCompleted) {
      persisted = {
        ...persisted,
        currentLevel: nextLevel,
        completedLevels: normalizedCompleted([...persisted.completedLevels, completedLevel], nextLevel),
      };
      persist();
    }
    sdk.levelCompleted(completedLevel);
    machine.complete();
    return true;
  }

  function claim(): boolean {
    if (surface !== "win" || rewardClaimed || claimPending) return false;
    rewardClaimed = true;
    if (rewardAmount > 0) {
      persisted = { ...persisted, currency: persisted.currency + rewardAmount };
      persist();
      sdk.rewardClaimed(rewardAmount, persisted.currency, false);
    }
    return true;
  }

  async function claimDouble(): Promise<boolean> {
    if (surface !== "win" || rewardClaimed || claimPending) return false;
    claimPending = true;
    let granted = false;
    try {
      granted = (await sdk.adProvider.showRewardedAd()).granted;
    } finally {
      claimPending = false;
    }
    // The surface may have changed while the ad was on screen; only grant if the
    // player is still on an unclaimed win, and only if the ad actually granted.
    if (surface !== "win" || rewardClaimed || !granted) return false;
    rewardClaimed = true;
    rewardClaimedDouble = true;
    const doubled = rewardAmount * 2;
    if (doubled > 0) {
      persisted = { ...persisted, currency: persisted.currency + doubled };
      persist();
      sdk.rewardClaimed(doubled, persisted.currency, true);
    }
    return true;
  }

  function lose(): boolean {
    if (surface !== "level" || !machine.can("fail")) return false;
    sdk.levelFailed(activeLevel() ?? persisted.currentLevel);
    machine.fail();
    return true;
  }

  function resetSave(): void {
    persisted = cloneDefaultState();
    sdk.syncAudioSettings(persisted.settings);
    persist();
    home();
  }

  function startLevel(levelId: number): boolean {
    if (!Number.isInteger(levelId) || levelId < 1 || levelId > LEVEL_COUNT || !home()) return false;
    persisted = {
      ...persisted,
      currentLevel: levelId,
      completedLevels: Array.from({ length: levelId - 1 }, (_value, index) => index + 1),
    };
    persist();
    return enterCurrentLevel();
  }

  function snapshot(): TemplateShellSnapshot {
    const iapSnapshot = sdk.iap.snapshot();
    const bundleEntry = iapSnapshot.products.find((entry) => entry.product.id === BUNDLE_PRODUCT_ID);
    const bundleStore = bundleEntry?.storeProduct ?? null;
    const bundleAvailable = iapSnapshot.state === "ready" && bundleStore !== null;
    return {
      ...persisted,
      completedLevels: [...persisted.completedLevels],
      settings: { ...persisted.settings },
      activeLevel: activeLevel(),
      surface,
      scene: machine.state,
      status: status(),
      inputReady: surface === "level",
      settingsOpen: surface === "settings",
      settingsOrigin,
      shopOpen: surface === "shop",
      secondaryCurrency: SECONDARY_CURRENCY_VALUE,
      shopItems: SHOP_ITEMS,
      adProvider: sdk.adProvider.providerName,
      rewardAmount,
      rewardClaimed,
      rewardClaimedDouble,
      adAvailable: sdk.isRewardedAdAvailable(),
      continueCost: CONTINUE_COST,
      continueAffordable: persisted.currency >= CONTINUE_COST,
      bundleAvailable,
      bundlePrice: bundleStore?.priceString ?? null,
    };
  }

  function driveSnapshot() {
    const current = snapshot();
    return {
      scene: current.scene,
      status: current.status,
      inputReady: current.inputReady,
      settingsOpen: current.settingsOpen,
      shopOpen: current.shopOpen,
    };
  }

  return {
    sdk,
    snapshot,
    startCurrent(): boolean {
      if (surface !== "menu") return false;
      return enterCurrentLevel();
    },
    startLevel,
    selectNode(levelId: number): boolean {
      if (surface !== "menu" || levelId !== persisted.currentLevel) return false;
      return enterCurrentLevel();
    },
    pause,
    resume(): boolean {
      if (surface !== "pause" || !machine.can("resume")) return false;
      machine.resume();
      surface = "level";
      sdk.resumed();
      return true;
    },
    openShop,
    backFromShop(): boolean {
      if (surface !== "shop") return false;
      surface = "menu";
      return true;
    },
    openSettings,
    backFromSettings(): boolean {
      if (surface !== "settings" || settingsOrigin === null) return false;
      surface = settingsOrigin;
      settingsOrigin = null;
      return true;
    },
    setSetting(key: TemplateSettingKey, enabled: boolean): void {
      if (persisted.settings[key] === enabled) return;
      persisted = { ...persisted, settings: { ...persisted.settings, [key]: enabled } };
      persist();
      sdk.settingChanged(key, enabled);
    },
    win,
    lose,
    claim,
    claimDouble,
    next(): boolean {
      // Next is unavailable until a claim path has succeeded; then it advances
      // exactly once (or returns Home on the terminal level).
      if (surface !== "win" || !rewardClaimed) return false;
      if (isTerminalProgression()) return home();
      if (!machine.can("next")) return false;
      machine.next(String(persisted.currentLevel));
      sdk.levelStarted(persisted.currentLevel);
      return true;
    },
    retry(): boolean {
      if (surface !== "fail" || !machine.can("retry")) return false;
      machine.retry();
      sdk.levelStarted(activeLevel() ?? persisted.currentLevel);
      return true;
    },
    continueCoins(): boolean {
      // Spend the configured coins to resume, once and only when affordable.
      // After resume the surface leaves fail, so a second tap is a no-op.
      if (surface !== "fail" || persisted.currency < CONTINUE_COST || !machine.can("retry")) return false;
      persisted = { ...persisted, currency: persisted.currency - CONTINUE_COST };
      persist();
      machine.retry();
      sdk.continueUsed(CONTINUE_COST, persisted.currency);
      sdk.levelStarted(activeLevel() ?? persisted.currentLevel);
      return true;
    },
    async purchaseBundle(): Promise<boolean> {
      if (surface !== "fail" || bundlePending || !machine.can("retry")) return false;
      // IapService.purchase keys on the store SKU, not the catalog id.
      const storeProductId = sdk.iap
        .snapshot()
        .products.find((entry) => entry.product.id === BUNDLE_PRODUCT_ID)?.product.productId;
      if (storeProductId === undefined) return false;
      bundlePending = true;
      let purchased = false;
      try {
        purchased = (await sdk.iap.purchase(storeProductId)).status === "purchased";
      } finally {
        bundlePending = false;
      }
      // The bundle grants no currency (proof scope); a successful purchase only
      // resumes the level. An unavailable/failed purchase leaves Retry working.
      if (surface !== "fail" || !purchased) return false;
      machine.retry();
      sdk.levelStarted(activeLevel() ?? persisted.currentLevel);
      return true;
    },
    home,
    driveTo(state: string): Promise<boolean> {
      return driveToState(
        {
          gotoMenu: () => {
            home();
          },
          startLevel: () => {
            home();
            enterCurrentLevel();
          },
          openSettings: () => {
            openSettings();
          },
          pause: () => {
            pause();
          },
          autoWin: async () => win(),
          autoFail: async () => lose(),
          snapshot: driveSnapshot,
          // Declared custom-state navigation: the proof shell adds "shop"
          // without changing the legacy default state list in testkit.
          states: DRIVE_STATES,
          gotoState: (target: string) => {
            drive(target);
          },
        },
        state,
        {
          pollMs: 0,
          maxPolls: 1,
          predicates: { shop: (snap) => snap.shopOpen === true },
        },
      );
    },
    gotoState(state: string): boolean {
      return drive(state);
    },
    sagaNodes(): readonly number[] {
      return Array.from({ length: LEVEL_COUNT }, (_value, index) => index + 1);
    },
    unlockAll(): void {
      persisted = {
        ...persisted,
        currentLevel: LEVEL_COUNT,
        completedLevels: Array.from({ length: LEVEL_COUNT - 1 }, (_value, index) => index + 1),
      };
      persist();
    },
    grantCoins(amount: number): void {
      persisted = { ...persisted, currency: Math.max(0, persisted.currency + amount) };
      persist();
    },
    resetSave,
    seedSave(profile: HarnessSaveProfile): void {
      const currentLevel = Math.min(LEVEL_COUNT, Math.max(1, profile.unlockedLevel ?? DEFAULT_STATE.currentLevel));
      persisted = {
        currentLevel,
        completedLevels: normalizedCompleted(
          Array.from({ length: Math.max(0, currentLevel - 1) }, (_value, index) => index + 1),
          currentLevel,
        ),
        currency: profile.coins ?? DEFAULT_STATE.currency,
        settings: {
          music: profile.music ?? DEFAULT_STATE.settings.music,
          sfx: profile.sfx ?? DEFAULT_STATE.settings.sfx,
          haptics: profile.haptics ?? DEFAULT_STATE.settings.haptics,
        },
      };
      sdk.syncAudioSettings(persisted.settings);
      persist();
      home();
    },
    trace(): readonly AnalyticsEvent[] {
      return sdk.trace();
    },
    drainTrace(): AnalyticsEvent[] {
      return sdk.drainTrace();
    },
  };
}
