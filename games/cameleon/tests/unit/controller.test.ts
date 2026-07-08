import { FlowStates } from "@fabrikav2/kernel";
import { describe, expect, it } from "vitest";

import { createCameleonController } from "../../src/game/CameleonController.ts";
import { rectCenter } from "../../src/game/level.ts";
import { loadLidoFixture } from "./lidoFixture.ts";

describe("Cameleon controller", () => {
  it("turns a hide tap into found feedback and analytics", () => {
    const level = loadLidoFixture();
    const controller = createCameleonController({ level, env: "test", now: () => 1000 });
    controller.startLevel(1);

    expect(controller.tapWorld(rectCenter(level.hides[0]!.rect))).toBe("hit");

    const snap = controller.snapshot();
    expect(snap.foundCount).toBe(1);
    expect(snap.feedback).toMatchObject({ kind: "hit", id: "li-01" });
    expect(snap.hides.find((hide) => hide.id === "li-01")).toMatchObject({
      phase: "found",
      visibleBody: "white",
    });
    expect(controller.drainEvents().map((event) => event.name)).toEqual([
      "session_start",
      "level_start",
      "hide_found",
    ]);
  });

  it("classifies decoys and misses with feedback in scarce-ammo modes", () => {
    const level = loadLidoFixture();
    const controller = createCameleonController({
      level,
      query: { mode: "shoot" },
      env: "test",
    });
    controller.startLevel(1);

    expect(controller.tapWorld(rectCenter(level.decoys[0]!.rect))).toBe("decoy");
    expect(controller.snapshot()).toMatchObject({
      ammo: 13,
      feedback: expect.objectContaining({ kind: "decoy", id: "dc-rules-pictograms" }),
    });

    expect(controller.tapWorld({ x: 18, y: 1380 })).toBe("miss");
    expect(controller.snapshot()).toMatchObject({
      ammo: 12,
      feedback: expect.objectContaining({ kind: "miss" }),
    });
  });

  it("wins once eight hides are revealed", async () => {
    const level = loadLidoFixture();
    const controller = createCameleonController({ level, env: "test" });

    await expect(controller.winLevel()).resolves.toBe(true);

    expect(controller.snapshot()).toMatchObject({
      scene: FlowStates.Complete,
      status: "won",
      foundCount: 8,
      inputReady: false,
      tourState: "win",
    });
    expect(controller.drainEvents().map((event) => event.name)).toContain("level_win");
  });

  it("clamps scroll to the wide-scene bounds", () => {
    const level = loadLidoFixture();
    const controller = createCameleonController({ level, env: "test" });
    controller.setViewport({ width: 390, height: 844 });
    controller.startLevel(1);

    controller.scrollTo(9000);
    expect(controller.snapshot().scrollX).toBe(4410);
    expect(controller.snapshot().tourState).toBe("zone5");

    controller.scrollTo(-100);
    expect(controller.snapshot().scrollX).toBe(0);
  });
});
