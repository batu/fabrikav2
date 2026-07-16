import { describe, expect, it } from "vitest";
import { gameConfig } from "../../game.config.ts";

describe("shell_template config", () => {
  it("declares the v2 shell contract for the shell template", () => {
    expect(gameConfig.id).toBe("shell_template");
    expect(gameConfig.saga.levels).toBeGreaterThanOrEqual(20);
    expect(gameConfig.screens).toContain("SagaMap");
    expect(gameConfig.adPlacements).toContain("rewarded_hint");
    expect(gameConfig.analyticsEvents).toContain("level_complete");
  });
});
