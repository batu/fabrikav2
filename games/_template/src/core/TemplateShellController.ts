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

type TemplateSurface = "menu" | "level" | "settings" | "pause" | "win" | "fail";
type SettingsOrigin = "menu" | "pause" | null;

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
  readonly adProvider: string;
}

export interface TemplateShellController {
  readonly sdk: TemplateSdk;
  snapshot(): TemplateShellSnapshot;
  startCurrent(): boolean;
  startLevel(levelId: number): boolean;
  selectNode(levelId: number): boolean;
  pause(): boolean;
  resume(): boolean;
  openSettings(): boolean;
  backFromSettings(): boolean;
  setSetting(key: TemplateSettingKey, enabled: boolean): void;
  win(): boolean;
  lose(): boolean;
  next(): boolean;
  retry(): boolean;
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
    const rewardAmount = persisted.completedLevels.includes(completedLevel) ? 0 : 5;
    const nextLevel = Math.min(LEVEL_COUNT, completedLevel + 1);
    if (rewardAmount > 0) {
      persisted = {
        ...persisted,
        currentLevel: nextLevel,
        completedLevels: normalizedCompleted([...persisted.completedLevels, completedLevel], nextLevel),
        currency: persisted.currency + rewardAmount,
      };
      persist();
    }
    sdk.levelCompleted(completedLevel, persisted.currency, rewardAmount);
    machine.complete();
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
      adProvider: sdk.adProvider.providerName,
    };
  }

  function driveSnapshot() {
    const current = snapshot();
    return {
      scene: current.scene,
      status: current.status,
      inputReady: current.inputReady,
      settingsOpen: current.settingsOpen,
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
    next(): boolean {
      if (surface !== "win") return false;
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
        },
        state,
        { pollMs: 0, maxPolls: 1 },
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
