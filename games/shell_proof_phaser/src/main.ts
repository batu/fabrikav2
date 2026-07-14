import "@fabrikav2/ui/ui.css";
import "./shell/template-shell.css";
import {
  createShellEvidenceProbe,
  evidenceProbeWindowKeyForGame,
} from "@fabrikav2/testkit/harness";
import { assignWindowBindings } from "@fabrikav2/testkit/testing";
import { gameConfig } from "../game.config.ts";
import { createTemplateShellController } from "./core/TemplateShellController.ts";
import { createTemplateHarness } from "./shell/harness.ts";
import { maybeRunTemplateInsituTour } from "./shell/insituTour.ts";
import "./shell/renderers/phaser-projection.css";
import { mountTemplateShell } from "./shell/TemplateShell.ts";

declare const __FABRIKAV2_SELECTED_PROJECTION__: {
  readonly publicationId: string;
  readonly projectionId: string;
};

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

const appRoot = typeof document !== "undefined" ? document.getElementById("app") : null;
if (appRoot) {
  const controller = createTemplateShellController();
  void import("./shell/renderers/PhaserProjection.ts").then(({ mountPhaserProjection }) => mountPhaserProjection({
    mountInto: appRoot,
    controller,
    identity: __FABRIKAV2_SELECTED_PROJECTION__,
  })).then((shell) => {
    const evidenceProbe = createShellEvidenceProbe({
      gameId: gameConfig.id,
      contractId: "shell-presentation-v2",
      rendererProfile: "phaser-native",
      readers: {
        state: () => controller.snapshot().surface,
        revision: () => shell.identity.projectionId,
        ready: shell.ready,
        viewport: () => ({
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        }),
        actions: () => shell.actions().map((action) => ({
          actionId: action.actionId,
          instanceId: action.instanceId,
          ...action.rect,
          visible: action.visible,
          disabled: action.disabled,
        })),
      },
    });
    assignWindowBindings(window as unknown as Record<string, unknown>, {
      [evidenceProbeWindowKeyForGame(gameConfig.id)]: evidenceProbe,
    });
    if (TEST_HARNESS_ENABLED) {
      const harness = createTemplateHarness({
        buildVersion: shell.identity.projectionId.slice(7, 15),
        packageId: `com.fabrikav2.${gameConfig.id}`,
        controller,
        render: shell.render,
      });
      assignWindowBindings(window as unknown as Record<string, unknown>, {
        [harnessWindowKeyForGame(gameConfig.id)]: harness,
      });
      void maybeRunTemplateInsituTour(harness);
    }
  }).catch((error: unknown) => {
    console.error("[fabrikav2:projection-failed]", error);
    appRoot.textContent = error instanceof Error ? error.message : "Phaser projection failed to boot.";
  });
}
