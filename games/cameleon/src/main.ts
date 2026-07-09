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
import { loadLevelDefinition, LIDO_LEVEL_URL, type LevelFetch } from "./game/levelLoader.ts";
import type { CameleonLevelDefinition } from "./game/level.ts";
import { mountCameleonPhaser, type CameleonPhaserRuntime } from "./game/phaserRuntime.ts";
import { parseCameleonQuery, type CameleonQueryParams } from "./game/query.ts";
import { mountCameleonScreen, type CameleonScreen } from "./shell/CameleonScreen.ts";
import { createCameleonHarness } from "./shell/harness.ts";

export interface CameleonBootOptions {
  readonly level?: CameleonLevelDefinition;
  readonly levelUrl?: string;
  readonly fetcher?: LevelFetch;
  readonly query?: Partial<CameleonQueryParams>;
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
  const level = options.level ?? await loadLevelDefinition(options.levelUrl ?? LIDO_LEVEL_URL, options.fetcher);
  const query = {
    ...parseCameleonQuery(typeof window === "undefined" ? "" : window.location.search),
    ...options.query,
  };
  const controller = createCameleonController({
    level,
    query,
    flowMachine: machine,
    env: import.meta.env.MODE === "test" ? "test" : "development",
  });
  const screen = mountCameleonScreen({
    mountInto,
    onModeSelect: (mode) => controller.setPlayMode(mode),
    onDirectionSelect: (direction) => controller.setDirection(direction),
    onStart: () => controller.startLevel(1),
    onContinue: () => controller.gotoMenu(),
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
  let runtime: CameleonPhaserRuntime | null = null;
  if (options.startRuntime !== false) {
    try {
      runtime = await mountCameleonPhaser({ canvas: screen.canvas, controller });
    } catch (error) {
      // The DOM shell + harness must stay alive even if the canvas renderer
      // fails to boot; the tour and controller are renderer-independent.
      console.error("[cameleon] phaser mount failed", error);
    }
  }

  return {
    machine,
    controller,
    screen,
    runtime,
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
