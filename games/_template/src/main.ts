import { createFlowMachine } from "@fabrikav2/kernel";
import { assignWindowBindings } from "@fabrikav2/testkit/testing";
import { gameConfig } from "../game.config.ts";
import { copy } from "../design/copy.ts";
import { mountPlaceholderScreen } from "./shell/PlaceholderScreen.ts";
import { createTemplateHarness } from "./shell/harness.ts";

/**
 * Boot the game: stand up the kernel screen-flow machine and mount the
 * placeholder shell screen. A real port replaces the placeholder with the
 * declared `gameConfig.screens` from `@fabrikav2/ui` and wires the machine's
 * transitions to gameplay. Returned so the unit smoke test can assert on it.
 */
export function bootGame(mountInto: HTMLElement) {
  const machine = createFlowMachine();
  const screen = mountPlaceholderScreen({ mountInto, label: copy["menu.play"] });
  return { machine, screen, config: gameConfig };
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
  bootGame(appRoot);

  if (TEST_HARNESS_ENABLED) {
    // Fixed, game-agnostic window key (no create-game substitution needed —
    // `@fabrikav2/testkit/playwright` `waitForHarness` takes the key as a
    // caller-supplied argument, not a hardcoded name).
    const harness = createTemplateHarness({ buildVersion: "dev", packageId: `com.fabrikav2.${gameConfig.id}` });
    assignWindowBindings(window as unknown as Record<string, unknown>, {
      __GAME_HARNESS__: harness,
    });
    void import("./testing/insituTour.ts").then(({ maybeRunInsituTour }) => maybeRunInsituTour(harness));
  }
}
