import { describe, it, expect } from "vitest";
import { bootGame } from "../../src/main.ts";
import { gameConfig } from "../../game.config.ts";
import { copy } from "../../design/copy.ts";

// Smoke test: the template must boot end-to-end (kernel flow machine + a mounted
// shell screen driven by generated copy) so a fresh `create-game` output is
// green from the first commit.
describe("_template smoke", () => {
  it("boots the kernel flow machine and mounts the placeholder screen", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const app = document.getElementById("app")!;

    const { machine, screen, config } = bootGame(app);

    expect(machine.state).toBe("boot");
    expect(config).toBe(gameConfig);
    expect(app.contains(screen)).toBe(true);
    expect(screen.textContent).toBe(copy["menu.play"]);
  });
});
