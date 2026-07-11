import "@fabrikav2/ui/ui.css";
import "./shell/template-shell.css";
import { assignWindowBindings, maybeRunInsituTour } from "@fabrikav2/testkit/testing";
import { gameConfig } from "../game.config.ts";
import { createTemplateShellController } from "./core/TemplateShellController.ts";
import { createTemplateHarness } from "./shell/harness.ts";
import { mountTemplateShell } from "./shell/TemplateShell.ts";

/** Boot the editor-neutral functional shell and expose its state owner to tests. */
export function bootGame(
  mountInto: HTMLElement,
  options: { readonly enableTestOutcomes?: boolean } = {},
) {
  const controller = createTemplateShellController();
  const shell = mountTemplateShell({
    mountInto,
    controller,
    enableTestOutcomes: options.enableTestOutcomes,
  });
  return { machine: controller.machine, controller, shell, config: gameConfig };
}

export function harnessWindowKeyForGame(gameId: string): string {
  return `__${gameId.toUpperCase()}_HARNESS__`;
}

const TEST_HARNESS_ENABLED: boolean =
  import.meta.env.MODE !== "production" || import.meta.env.VITE_ENABLE_TEST_HARNESS === "true";

const TEST_OUTCOMES_ENABLED: boolean =
  import.meta.env.VITE_ENABLE_TEST_OUTCOMES === "true" ||
  (import.meta.env.DEV && new URLSearchParams(window.location.search).get("diagnostics") === "1");

const appRoot = typeof document !== "undefined" ? document.getElementById("app") : null;
if (appRoot) {
  const game = bootGame(appRoot, { enableTestOutcomes: TEST_OUTCOMES_ENABLED });
  if (TEST_HARNESS_ENABLED) {
    const harness = createTemplateHarness({
      buildVersion: "dev",
      packageId: `com.fabrikav2.${gameConfig.id}`,
      controller: game.controller,
    });
    assignWindowBindings(window as unknown as Record<string, unknown>, {
      [harnessWindowKeyForGame(gameConfig.id)]: harness,
    });
    void maybeRunInsituTour(harness);
  }
}
