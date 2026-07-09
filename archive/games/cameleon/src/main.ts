import "@fabrikav2/ui/ui.css";
import "../design/tokens.css";
import "./shell/cameleon.css";

import { createFlowMachine, FlowStates } from "@fabrikav2/kernel";
import { assignWindowBindings, maybeRunInsituTour } from "@fabrikav2/testkit/testing";

import { gameConfig } from "../game.config.ts";
import {
  CAMELEON_DEVICE_TOUR_STATES,
  createCameleonController,
  snapshotMatchesCameleonTourState,
  type CameleonController,
} from "./game/CameleonController.ts";
import { copy } from "../design/copy.ts";
import { loadLevelDefinition, DEFAULT_CAMELEON_LEVEL_ID, type LevelFetch } from "./game/levelLoader.ts";
import {
  levelIdForNumber,
  levelNumberForId,
  nextLevelIdAfter,
  type CameleonLevelDefinition,
  type CameleonLevelId,
} from "./game/level.ts";
import { mountCameleonPhaser, type CameleonPhaserRuntime } from "./game/phaserRuntime.ts";
import { parseCameleonQuery, type CameleonQueryParams } from "./game/query.ts";
import { cameleonSaveState, type CameleonProgressStore } from "./game/saveState.ts";
import { mountCameleonScreen, type CameleonScreen } from "./shell/CameleonScreen.ts";
import { createCameleonHarness } from "./shell/harness.ts";

export interface CameleonBootOptions {
  readonly level?: CameleonLevelDefinition;
  readonly levelUrl?: string;
  readonly fetcher?: LevelFetch;
  readonly query?: Partial<CameleonQueryParams>;
  readonly saveState?: CameleonProgressStore;
  readonly startRuntime?: boolean;
}

export interface CameleonBoot {
  readonly machine: ReturnType<typeof createFlowMachine>;
  readonly controller: CameleonController;
  readonly screen: CameleonScreen;
  readonly runtime: CameleonPhaserRuntime | null;
  readonly config: typeof gameConfig;
  destroy(): void;
}

export async function bootGame(mountInto: HTMLElement, options: CameleonBootOptions = {}): Promise<CameleonBoot> {
  const machine = createFlowMachine({ optionalStates: [FlowStates.Paused] });
  const fetcher = options.fetcher ?? fetch;
  const staticLevel = options.level !== undefined;
  const level = options.level ?? await loadLevelDefinition(options.levelUrl ?? DEFAULT_CAMELEON_LEVEL_ID, fetcher);
  const query = {
    ...parseCameleonQuery(typeof window === "undefined" ? "" : window.location.search),
    ...options.query,
  };
  const controller = createCameleonController({
    level,
    query,
    saveState: options.saveState ?? cameleonSaveState,
    flowMachine: machine,
    env: import.meta.env.MODE === "test" ? "test" : "development",
  });
  let runtime: CameleonPhaserRuntime | null = null;

  const mountRuntime = async (): Promise<void> => {
    if (options.startRuntime === false) return;
    try {
      runtime = await mountCameleonPhaser({ canvas: screen.canvas, controller });
    } catch (error) {
      // The DOM shell + harness must stay alive even if the canvas renderer
      // fails to boot; the tour and controller are renderer-independent.
      console.error("[cameleon] phaser mount failed", error);
    }
  };

  const switchToLevel = async (levelId: CameleonLevelId, start: boolean): Promise<void> => {
    if (!controller.isLevelUnlocked(levelId)) {
      screen.showToast(copy["toast.locked"]);
      return;
    }
    if (staticLevel && levelId === controller.level.id) {
      if (start) controller.startLevel(levelNumberForId(levelId));
      return;
    }
    if (staticLevel) {
      screen.showToast(copy["toast.locked"]);
      return;
    }
    try {
      const nextLevel = await loadLevelDefinition(levelId, fetcher);
      runtime?.destroy();
      runtime = null;
      controller.setLevel(nextLevel);
      if (start) controller.startLevel(levelNumberForId(levelId));
      await mountRuntime();
    } catch (error) {
      console.error("[cameleon] level switch failed", error);
      screen.showToast(copy["toast.loadFailed"]);
    }
  };

  const startCurrentUnlockedLevel = (): void => {
    if (staticLevel) {
      controller.startLevel(levelNumberForId(controller.level.id));
      return;
    }
    void switchToLevel(levelIdForNumber(controller.snapshot().unlockedLevel), true);
  };

  const continueAfterResult = (): void => {
    const nextLevelId = nextLevelIdAfter(controller.snapshot().levelId);
    if (!nextLevelId) {
      controller.gotoMenu();
      return;
    }
    void switchToLevel(nextLevelId, true);
  };

  const screen = mountCameleonScreen({
    mountInto,
    onModeSelect: (mode) => controller.setPlayMode(mode),
    onDirectionSelect: (direction) => controller.setDirection(direction),
    onStartLevel: (levelId) => void switchToLevel(levelId, true),
    onStart: () => startCurrentUnlockedLevel(),
    onContinue: () => continueAfterResult(),
    onRetry: () => controller.startLevel(1),
    onConfirmAim: () => controller.confirmAim(),
    onPause: () => controller.pause(),
    onResume: () => controller.resume(),
    onQuitToMenu: () => controller.gotoMenu(),
    onSettingsOpen: () => controller.openSettings(),
    onSettingsClose: () => controller.closeSettings(),
  });
  const unsubscribe = controller.subscribe(() => {
    // A throwing listener must never poison controller.notify() — that would
    // reject every subsequent driveTo and kill the insitu tour mid-run.
    try {
      screen.refresh(controller.snapshot());
    } catch (error) {
      console.error("[cameleon] screen refresh failed", error);
    }
  });
  await mountRuntime();

  return {
    machine,
    controller,
    screen,
    get runtime() {
      return runtime;
    },
    config: gameConfig,
    destroy(): void {
      unsubscribe();
      runtime?.destroy();
      screen.destroy();
    },
  };
}

export function harnessWindowKeyForGame(gameId: string): string {
  return `__${gameId.toUpperCase()}_HARNESS__`;
}

const TEST_HARNESS_ENABLED: boolean =
  import.meta.env.MODE !== "production" ||
  import.meta.env.VITE_ENABLE_TEST_HARNESS === "true";

const appRoot = typeof document !== "undefined" ? document.getElementById("app") : null;
if (appRoot) {
  void bootGame(appRoot)
    .then((boot) => {
      if (!TEST_HARNESS_ENABLED) return;
      const harnessWindowKey = harnessWindowKeyForGame(gameConfig.id);
      const harness = createCameleonHarness({
        buildVersion: "dev",
        packageId: "com.basegamelab.cameleon.dev",
        controller: boot.controller,
        screen: boot.screen,
      });
      assignWindowBindings(window as unknown as Record<string, unknown>, {
        [harnessWindowKey]: harness,
      });
      void maybeRunInsituTour(harness, {
        // The committed XCUITest runner waits on exactly the six canonical
        // tourstate markers; zone/found-beat states remain harness-only.
        states: CAMELEON_DEVICE_TOUR_STATES,
        snapshotMatchesState: snapshotMatchesCameleonTourState,
      });
    })
    .catch((error: unknown) => {
      console.error(error);
    });
}
