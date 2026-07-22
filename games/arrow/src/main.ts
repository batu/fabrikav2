import "@fabrikav2/ui/ui.css";
import "../design/tokens.css";
import "./shell/levelmap-bridge.css";
import { assignWindowBindings, maybeRunInsituTour } from "@fabrikav2/testkit/testing";
import { installLevelMapArt } from "../design/theme.js";
import { App, isHarnessEnabled } from "./shell/App.js";
import { gameConfig } from "../game.config.js";

installLevelMapArt();

export function harnessWindowKeyForGame(gameId: string): string {
  return `__${gameId.toUpperCase()}_HARNESS__`;
}

export function bootGame(canvas: HTMLCanvasElement, uiRoot: HTMLElement): App {
  const app = new App({ canvas, uiRoot });
  app.start();
  return app;
}

const canvas = typeof document !== "undefined"
  ? document.getElementById("scene") as HTMLCanvasElement | null
  : null;
const uiRoot = typeof document !== "undefined"
  ? document.getElementById("ui")
  : null;

if (canvas && uiRoot) {
  const app = bootGame(canvas, uiRoot);
  window.addEventListener("resize", () => app.resize());

  if (isHarnessEnabled) {
    const harness = app.harness();
    assignWindowBindings(window as unknown as Record<string, unknown>, {
      [harnessWindowKeyForGame(gameConfig.id)]: harness,
      __ARROW_GAME__: app,
    });
    void maybeRunInsituTour(harness);
  }
}
