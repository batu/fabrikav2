import { describe, expect, it } from "vitest";
import { bootGame } from "../../src/main.ts";
import { gameConfig } from "../../game.config.ts";

describe("_template smoke", () => {
  it("boots the functional shell at Progression Home", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const app = document.getElementById("app")!;

    const { controller, config, shell } = bootGame(app);

    expect(config).toBe(gameConfig);
    expect(controller.snapshot()).toMatchObject({ surface: "menu", scene: "menu" });
    expect(app.contains(shell.root)).toBe(true);
    expect(shell.root.querySelector('[data-fab-action="play"]')).not.toBeNull();
  });
});
