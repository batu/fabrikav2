import { describe, expect, it } from "vitest";

import capacitorConfig from "../../capacitor.config.ts";
import { gameConfig } from "../../game.config.ts";

describe("Cameleon game config", () => {
  it("declares the kit shell screens and four-node saga", () => {
    expect(gameConfig.screens).toEqual(["HomeMenu", "SagaMap", "Settings", "ResultCard", "PauseOverlay", "Toast"]);
    expect(gameConfig.saga).toEqual({ levels: 4 });
  });

  it("declares the Cameleon analytics event contract", () => {
    expect(gameConfig.analyticsEvents).toEqual([
      "level_start",
      "hide_found",
      "decoy_hit",
      "miss",
      "level_win",
      "mode_selected",
      "dir_selected",
    ]);
  });

  it("uses the dev native bundle id", () => {
    expect(capacitorConfig.appId).toBe("com.basegamelab.cameleon.dev");
  });
});
