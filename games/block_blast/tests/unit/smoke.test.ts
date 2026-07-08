import { describe, it, expect } from "vitest";
import { bootGame } from "../../src/main.ts";
import { gameConfig } from "../../game.config.ts";

describe("block_blast smoke", () => {
  it("boots the kernel flow machine, controller, and shell screen", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const app = document.getElementById("app")!;

    const { machine, screen, controller, config } = bootGame(app);

    expect(machine.state).toBe("boot");
    expect(config).toBe(gameConfig);
    expect(app.contains(screen.root)).toBe(true);
    expect(controller.snapshot()).toMatchObject({ scene: "menu", unlockedStage: 1 });
    expect(app.querySelector(".fab-home-menu")).not.toBeNull();
  });
});
