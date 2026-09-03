import "@fabrikav2/ui/ui.css";
import "../design/tokens.css";
import "./shell/mage-master.css";
import "./shell/mage-master-minimal.css";

import { assignWindowBindings, maybeRunInsituTour } from "@fabrikav2/testkit/testing";
import { gameConfig } from "../game.config.ts";
import { createMageMasterController } from "./game/MageMasterController.ts";
import { mountMageMasterScreen } from "./shell/MageMasterScreen.ts";
import { createMageMasterHarness } from "./shell/harness.ts";
import { installDevDrive } from "./dev/devDrive.ts";
import { itemPower } from "./game/economy/items.ts";

export function bootGame(mountInto: HTMLElement) {
  const controller = createMageMasterController({ env: import.meta.env.MODE === "test" ? "test" : "development" });
  const screen = mountMageMasterScreen({ mountInto, controller });
  return { controller, screen, config: gameConfig };
}

export function harnessWindowKeyForGame(gameId: string): string {
  return `__${gameId.toUpperCase()}_HARNESS__`;
}

const TEST_HARNESS_ENABLED: boolean = import.meta.env.MODE !== "production" || import.meta.env.VITE_ENABLE_TEST_HARNESS === "true";

const appRoot = typeof document !== "undefined" ? document.getElementById("app") : null;
if (appRoot) {
  const boot = bootGame(appRoot);
  if (TEST_HARNESS_ENABLED) {
    const harness = createMageMasterHarness({
      buildVersion: "dev",
      packageId: `com.basegamelab.${gameConfig.id}`,
      controller: boot.controller,
      screen: boot.screen,
    });
    assignWindowBindings(window as unknown as Record<string, unknown>, {
      [harnessWindowKeyForGame(gameConfig.id)]: harness,
    });
    void maybeRunInsituTour(harness);
    if (import.meta.env.DEV) {
      installDevDrive(harness);
      // Dev-only handle for eval-driven inspection (fast-forwarding a battle, reading views).
      (window as unknown as Record<string, unknown>).__MM_DEV = { controller: boot.controller, screen: boot.screen, harness, itemPower };
    }
  }
}
