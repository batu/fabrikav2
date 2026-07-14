import { describe, expect, it } from "vitest";

import selectedRevision from "../../design/revision.json";
import { bootGame } from "../../src/main.ts";

describe("selected Grapes runtime projection", () => {
  it("renders the editor-authored sentinel and preserves projection identity across navigation", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const game = bootGame(document.getElementById("app")!, { enableTestOutcomes: true });

    expect(game.projection.projectionId).toBe(selectedRevision.projectionId);
    expect(game.shell.root.dataset.fabProjection).toBe(selectedRevision.projectionId);
    expect(game.shell.root.querySelector('[data-fab-instance="menu.title"]')?.textContent).toBe(
      "PHONE PROOF · GRAPES",
    );

    game.shell.root.querySelector<HTMLButtonElement>('[data-fab-instance="menu.play"]')!.click();
    expect(game.controller.snapshot().surface).toBe("level");
    expect(game.shell.root.dataset.fabProjection).toBe(selectedRevision.projectionId);
    expect(game.shell.root.querySelector('[data-fab-instance="level.pause"]')).not.toBeNull();
  });

  it("mounts every accepted instance across the complete seven-state journey", async () => {
    for (const state of ["menu", "level", "shop", "settings", "pause", "win", "fail"] as const) {
      document.body.innerHTML = '<div id="app"></div>';
      const game = bootGame(document.getElementById("app")!, { enableTestOutcomes: true });
      await expect(game.controller.driveTo(state)).resolves.toBe(true);
      game.shell.render();

      expect(game.shell.root.dataset.fabState).toBe(state);
      expect(game.shell.root.dataset.fabProjection).toBe(selectedRevision.projectionId);
      expect(game.shell.root.querySelectorAll("[data-fab-instance]").length).toBeGreaterThan(0);
      game.shell.dispose();
      game.projection.dispose();
    }
  });
});
