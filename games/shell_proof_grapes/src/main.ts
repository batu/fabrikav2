import "@fabrikav2/ui/ui.css";
import "./shell/template-shell.css";
import {
  createShellEvidenceProbe,
  evidenceProbeWindowKeyForGame,
  readDomShellEvidenceActions,
  readDomShellEvidenceViewport,
} from "@fabrikav2/testkit/harness";
import { assignWindowBindings } from "@fabrikav2/testkit/testing";
import { gameConfig } from "../game.config.ts";
import { createTemplateShellController } from "./core/TemplateShellController.ts";
import { createTemplateHarness } from "./shell/harness.ts";
import { maybeRunTemplateInsituTour } from "./shell/insituTour.ts";
import { mountTemplateShell } from "./shell/TemplateShell.ts";

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
  return { controller, shell, config: gameConfig };
}

export function harnessWindowKeyForGame(gameId: string): string {
  return `__${gameId.toUpperCase()}_HARNESS__`;
}

const TEST_HARNESS_ENABLED: boolean =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_HARNESS === "true";

const TEST_OUTCOMES_ENABLED: boolean =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_OUTCOMES === "true";

const appRoot = typeof document !== "undefined" ? document.getElementById("app") : null;
if (appRoot) {
  const game = bootGame(appRoot, { enableTestOutcomes: TEST_OUTCOMES_ENABLED });
  // Renderer-neutral evidence probe: always bound (not harness-gated) so the
  // device lane can read state, action rectangles, revision, and readiness
  // from any running build. It is a tool — one snapshot query, no loops.
  const evidenceProbe = createShellEvidenceProbe({
    gameId: gameConfig.id,
    contractId: "shell-presentation-v2",
    rendererProfile: "dom-css",
    readers: {
      state: () => game.controller.snapshot().surface,
      // The seed design ships with the game; no projection revision is
      // selected until a lane publishes one.
      revision: () => null,
      ready: () => game.shell.root.dataset.fabState === game.controller.snapshot().surface,
      viewport: () => readDomShellEvidenceViewport(window),
      actions: () => readDomShellEvidenceActions(game.shell.root),
    },
  });
  assignWindowBindings(window as unknown as Record<string, unknown>, {
    [evidenceProbeWindowKeyForGame(gameConfig.id)]: evidenceProbe,
  });
  if (TEST_HARNESS_ENABLED) {
    const harness = createTemplateHarness({
      buildVersion: "dev",
      packageId: `com.fabrikav2.${gameConfig.id}`,
      controller: game.controller,
      render: game.shell.render,
    });
    assignWindowBindings(window as unknown as Record<string, unknown>, {
      [harnessWindowKeyForGame(gameConfig.id)]: harness,
    });
    // Seven-state tour: states AND the surface-grounded stability predicate
    // live together in the production wrapper the regression suite exercises.
    void maybeRunTemplateInsituTour(harness);
  }
}
