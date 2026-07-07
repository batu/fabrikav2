import { describe, expect, it } from "vitest";
import {
  createTapTenController,
  TAP_TEN_GOAL,
  TAP_TEN_MAX_MISSES,
} from "../../src/game/tapTen.ts";

describe("tap_ten rules", () => {
  it("wins deterministically by tapping the lit tile ten times", () => {
    let now = 1;
    const controller = createTapTenController({
      env: "test",
      sessionId: "rules-win",
      now: () => now++,
    });

    controller.startLevel(1);
    while (controller.snapshot().scene === "playing") {
      controller.tapTile(controller.snapshot().litTile);
    }

    expect(controller.snapshot()).toMatchObject({
      scene: "complete",
      status: "won",
      score: TAP_TEN_GOAL,
      coins: 1,
    });
    expect(controller.drainEvents().map((event) => event.name)).toContain("level_complete");
  });

  it("fails deterministically after three wrong tiles", () => {
    let now = 1;
    const controller = createTapTenController({
      env: "test",
      sessionId: "rules-fail",
      now: () => now++,
    });

    controller.startLevel(1);
    while (controller.snapshot().scene === "playing") {
      controller.tapTile((controller.snapshot().litTile + 1) % 4);
    }

    expect(controller.snapshot()).toMatchObject({
      scene: "failed",
      status: "lost",
      misses: TAP_TEN_MAX_MISSES,
    });
    expect(controller.drainEvents().map((event) => event.name)).toContain("level_fail");
  });
});
