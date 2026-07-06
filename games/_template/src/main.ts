import { createFlowMachine } from "@fabrikav2/kernel";
import { gameConfig } from "../game.config.ts";
import { copy } from "../design/copy.ts";
import { mountPlaceholderScreen } from "./shell/PlaceholderScreen.ts";

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

// Browser entrypoint (index.html loads this module). No-ops under a non-DOM or
// unmounted test import, where #app does not exist yet.
const appRoot = typeof document !== "undefined" ? document.getElementById("app") : null;
if (appRoot) bootGame(appRoot);
