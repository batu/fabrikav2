import { describe, expect, it } from "vitest";
import { gameConfig } from "../../game.config.ts";

describe("wool_crush_x config", () => {
  it("declares the v2 shell contract for the shell template", () => {
    expect(gameConfig.id).toBe("wool_crush_x");
    expect(gameConfig.saga.levels).toBe(3);
    expect(gameConfig.features.hints).toBe(false);
    expect(gameConfig.screens).toContain("SagaMap");
    expect(gameConfig.adPlacements).toContain("rewarded_hint");
    expect(gameConfig.analyticsEvents).toContain("level_complete");
  });
});
