import { describe, it, expect } from "vitest";
import { bootGame } from "../../src/main.ts";
import { gameConfig } from "../../game.config.ts";
import { copy } from "../../design/copy.ts";

describe("tap_ten smoke", () => {
  it("boots the kernel flow machine and mounts the Tap Ten screen", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const app = document.getElementById("app")!;

    const { machine, screen, controller, config } = bootGame(app);

    expect(machine.state).toBe("boot");
    expect(config).toBe(gameConfig);
    expect(app.contains(screen.root)).toBe(true);
    expect(screen.root.textContent).toContain(copy["game.title"]);
    expect(controller.snapshot()).toMatchObject({ scene: "menu", inputReady: true });
  });
});
