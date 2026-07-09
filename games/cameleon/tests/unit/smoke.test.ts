import { describe, it, expect } from "vitest";
import { bootGame } from "../../src/main.ts";
import { gameConfig } from "../../game.config.ts";
import { loadLidoFixture } from "./lidoFixture.ts";

describe("Cameleon smoke", () => {
  it("boots the kernel flow machine, controller, and canvas shell", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const app = document.getElementById("app")!;

    const boot = await bootGame(app, {
      level: loadLidoFixture(),
      startRuntime: false,
      query: { bodies: "white", dir: "night", mode: "confirm" },
    });

    expect(boot.machine.state).toBe("menu");
    expect(boot.config).toBe(gameConfig);
    expect(app.contains(boot.screen.root)).toBe(true);
    expect(boot.screen.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(boot.controller.snapshot()).toMatchObject({
      bodies: "white",
      dir: "night",
      mode: "confirm",
    });
    expect(app.querySelector(".fab-home-menu")).not.toBeNull();
    expect(app.querySelectorAll(".fab-levelmap-node")).toHaveLength(4);
    app.querySelector<HTMLButtonElement>(".cameleon-screen__settings-open")?.click();
    expect(app.querySelector<HTMLButtonElement>(".cameleon-screen__mode-button[data-mode='confirm']")?.getAttribute("aria-pressed")).toBe("true");
    expect(app.querySelector<HTMLButtonElement>(".cameleon-screen__direction-button[data-direction='night']")?.getAttribute("aria-pressed")).toBe("true");
    app.querySelector<HTMLButtonElement>(".cameleon-screen__direction-button[data-direction='riso']")?.click();
    expect(boot.controller.snapshot().dir).toBe("riso");
    expect(app.querySelectorAll(".cameleon-screen__bench-slot")).toHaveLength(12);
    app.querySelector<HTMLButtonElement>(".cameleon-screen__modal-close")?.click();

    app.querySelector<HTMLButtonElement>(".cameleon-screen__play")?.click();
    expect(boot.controller.snapshot()).toMatchObject({
      scene: "playing",
      ammo: 16,
      maxAmmo: 16,
    });
    expect(app.querySelectorAll(".cameleon-screen__dart")).toHaveLength(16);
    expect(app.querySelector<HTMLButtonElement>(".cameleon-screen__confirm")?.disabled).toBe(true);

    expect(boot.controller.aimAtWorld({ x: 18, y: 1380 })).toBe(true);
    expect(app.querySelector<HTMLButtonElement>(".cameleon-screen__confirm")?.disabled).toBe(false);
    app.querySelector<HTMLButtonElement>(".cameleon-screen__confirm")?.click();
    expect(boot.controller.snapshot()).toMatchObject({
      ammo: 14,
      feedback: expect.objectContaining({ kind: "miss" }),
    });

    app.querySelector<HTMLButtonElement>(".cameleon-screen__pause-button")?.click();
    expect(app.querySelector("#cameleon-pause .fab-pause-card")).not.toBeNull();
    app.querySelector<HTMLButtonElement>("[data-fab-action='pause-resume']")?.click();
    expect(boot.controller.snapshot().scene).toBe("playing");

    await boot.controller.winLevel();
    expect(app.querySelector("#cameleon-result-win .fab-result-card")).not.toBeNull();

    boot.destroy();
  });
});
