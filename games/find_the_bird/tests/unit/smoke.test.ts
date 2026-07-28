import { describe, expect, it } from "vitest";
import { gameConfig } from "../../game.config.ts";

describe("find_the_bird config", () => {
  it("declares the v2 shell contract for the FTB reskin", () => {
    expect(gameConfig.id).toBe("find_the_bird");
    expect(gameConfig.saga.levels).toBeGreaterThanOrEqual(54);
    expect(gameConfig.screens).toContain("SagaMap");
    expect(gameConfig.adPlacements).toContain("rewarded_hint");
    expect(gameConfig.analyticsEvents).toContain("level_complete");
  });
});
