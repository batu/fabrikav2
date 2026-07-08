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

    expect(boot.machine.state).toBe("boot");
    expect(boot.config).toBe(gameConfig);
    expect(app.contains(boot.screen.root)).toBe(true);
    expect(boot.screen.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(boot.controller.snapshot()).toMatchObject({
      bodies: "white",
      dir: "night",
      mode: "confirm",
    });

    boot.destroy();
  });
});
