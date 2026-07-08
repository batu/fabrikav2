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
    expect(screen.root.dataset.scene).toBe("menu");
    expect(screen.root.dataset.surface).toBe("menu");
    expect(app.querySelector(".fab-home-menu")).not.toBeNull();
    expect(app.querySelectorAll(".block-blast-screen__title")).toHaveLength(1);
    expect(app.querySelectorAll(".block-blast-menu-header")).toHaveLength(0);

    app.querySelector<HTMLButtonElement>("[data-fab-action='play']")?.click();
    expect(controller.snapshot()).toMatchObject({ scene: "playing", status: "playing" });
    expect(screen.root.dataset.scene).toBe("playing");
    expect(screen.root.dataset.surface).toBe("game");
    expect(app.querySelector(".fab-home-menu")).toBeNull();
    expect(app.querySelector(".block-blast-screen__stat[data-stat='target'] .block-blast-screen__stat-value")?.textContent).toBe(
      "Reach 40",
    );
  });
});
