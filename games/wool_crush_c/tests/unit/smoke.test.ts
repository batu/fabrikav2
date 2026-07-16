import { describe, expect, it } from "vitest";
import { gameConfig } from "../../game.config.ts";

describe("wool_crush_c config", () => {
  it("declares the v2 shell contract for the shell template", () => {
    expect(gameConfig.id).toBe("wool_crush_c");
    expect(gameConfig.saga.levels).toBeGreaterThanOrEqual(20);
    expect(gameConfig.screens).toContain("SagaMap");
    expect(gameConfig.adPlacements).toContain("rewarded_hint");
    expect(gameConfig.analyticsEvents).toContain("level_complete");
  });
});
