import { describe, expect, it } from "vitest";
import { gameConfig } from "../../game.config.ts";

describe("marble_run config", () => {
  it("declares the v2 shell contract for marble_run", () => {
    expect(gameConfig.id).toBe("marble_run");
    expect(gameConfig.saga.levels).toBeGreaterThanOrEqual(20);
    expect(gameConfig.screens).toContain("SagaMap");
    expect(gameConfig.adPlacements).toContain("rewarded_hint");
    expect(gameConfig.analyticsEvents).toContain("level_complete");
  });
});
