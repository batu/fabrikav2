import "@fabrikav2/ui/ui.css";
import "../design/tokens.css";
import "./shell/tapTen.css";

import { createFlowMachine } from "@fabrikav2/kernel";
import { assignWindowBindings, maybeRunInsituTour } from "@fabrikav2/testkit/testing";
import { gameConfig } from "../game.config.ts";
import { createTapTenController } from "./game/tapTen.ts";
import { mountTapTenScreen } from "./shell/TapTenScreen.ts";
import { createTapTenHarness } from "./shell/harness.ts";

/**
 * Boot the game: stand up the kernel screen-flow machine, the deterministic
 * Tap Ten state model, and the visible Canvas2D screen. Returned so tests and
 * the debug harness can share the same controller instance.
 */
export function bootGame(mountInto: HTMLElement) {
  const machine = createFlowMachine();
  const controller = createTapTenController({
    env: import.meta.env.MODE === "test" ? "test" : "development",
  });
  const screen = mountTapTenScreen({ mountInto, controller });
  return { machine, controller, screen, config: gameConfig };
}

export function harnessWindowKeyForGame(gameId: string): string {
  return `__${gameId.toUpperCase()}_HARNESS__`;
}

// Non-production (or explicit opt-in) gate for the debug harness — mirrors
// marble_run's `core/Constants.ts` `TEST_HARNESS_ENABLED` (card vFSI5FwY: a
// fresh `create-game` output must be device-verifiable out of the box, not
// only games that hand-ported the gate).
const TEST_HARNESS_ENABLED: boolean =
  import.meta.env.MODE !== "production" ||
  import.meta.env.VITE_ENABLE_TEST_HARNESS === "true";

// Browser entrypoint (index.html loads this module). No-ops under a non-DOM or
// unmounted test import, where #app does not exist yet.
const appRoot = typeof document !== "undefined" ? document.getElementById("app") : null;
if (appRoot) {
  const boot = bootGame(appRoot);

  if (TEST_HARNESS_ENABLED) {
    // Match tools/verify-device's browser-lane convention:
    // __${manifest.game.toUpperCase()}_HARNESS__. create-game keeps
    // manifest.game aligned with gameConfig.id.
    const harnessWindowKey = harnessWindowKeyForGame(gameConfig.id);
    const harness = createTapTenHarness({
      buildVersion: "dev",
      packageId: `com.fabrikav2.${gameConfig.id}`,
      controller: boot.controller,
      screen: boot.screen,
    });
    assignWindowBindings(window as unknown as Record<string, unknown>, {
      [harnessWindowKey]: harness,
    });
    void maybeRunInsituTour(harness);
  }
}
