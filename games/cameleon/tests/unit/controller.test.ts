import { createFlowMachine, FlowStates } from "@fabrikav2/kernel";
import { describe, expect, it } from "vitest";

import { createCameleonController } from "../../src/game/CameleonController.ts";
import { rectCenter } from "../../src/game/level.ts";
import { loadCameleonLevelFixture, loadLidoFixture } from "./lidoFixture.ts";

describe("Cameleon controller", () => {
  it("mirrors menu, gameplay, win, and fail transitions into the kernel flow machine", async () => {
    const level = loadLidoFixture();
    const flowMachine = createFlowMachine({ optionalStates: [FlowStates.Paused] });
    const controller = createCameleonController({ level, flowMachine, env: "test" });

    expect(flowMachine.state).toBe(FlowStates.Menu);
    expect(controller.snapshot().scene).toBe(FlowStates.Menu);

    controller.startLevel(1);
    expect(flowMachine.state).toBe(FlowStates.Playing);
    expect(controller.snapshot().scene).toBe(FlowStates.Playing);

    controller.pause();
    expect(flowMachine.state).toBe(FlowStates.Paused);
    expect(controller.snapshot().scene).toBe(FlowStates.Paused);

    controller.resume();
    await expect(controller.winLevel()).resolves.toBe(true);
    expect(flowMachine.state).toBe(FlowStates.Complete);
    expect(controller.snapshot().scene).toBe(FlowStates.Complete);

    controller.gotoMenu();
    await expect(controller.failLevel()).resolves.toBe(true);
    expect(flowMachine.state).toBe(FlowStates.Failed);
    expect(controller.snapshot().scene).toBe(FlowStates.Failed);
  });

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
    const events = controller.drainEvents();
    expect(events.map((event) => event.name)).toEqual([
      "session_start",
      "level_start",
      "hide_found",
    ]);
    expect(events.find((event) => event.name === "hide_found")?.params).toMatchObject({
      level_id: "lido",
      hide_id: "li-01",
      found_count: 1,
      mode: "tap",
      dir: "screenprint",
    });
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
      feedback: expect.objectContaining({ kind: "decoy", id: "dc-rules-board" }),
    });

    expect(controller.tapWorld({ x: 18, y: 1380 })).toBe("miss");
    expect(controller.snapshot()).toMatchObject({
      ammo: 12,
      feedback: expect.objectContaining({ kind: "miss" }),
    });

    const events = controller.drainEvents();
    expect(events.find((event) => event.name === "decoy_hit")?.params).toMatchObject({
      level_id: "lido",
      decoy_id: "dc-rules-board",
      found_count: 0,
      mode: "shoot",
      dir: "screenprint",
    });
    expect(events.find((event) => event.name === "miss")?.params).toMatchObject({
      level_id: "lido",
      found_count: 0,
      mode: "shoot",
      dir: "screenprint",
    });
  });

  it("keeps tap misses free but dims the hint after three wrong taps inside ten seconds", () => {
    let now = 1_000;
    const level = loadLidoFixture();
    const controller = createCameleonController({ level, env: "test", now: () => now });
    controller.startLevel(1);

    expect(controller.snapshot().ammo).toBeNull();

    expect(controller.tapWorld({ x: 18, y: 1380 })).toBe("miss");
    now += 2_000;
    expect(controller.tapWorld(rectCenter(level.decoys[0]!.rect))).toBe("decoy");
    now += 2_000;
    expect(controller.tapWorld({ x: 24, y: 1380 })).toBe("miss");

    expect(controller.snapshot()).toMatchObject({
      ammo: null,
      tapMissMockery: true,
    });

    now += 10_001;
    expect(controller.tapWorld({ x: 30, y: 1380 })).toBe("miss");
    expect(controller.snapshot().tapMissMockery).toBe(false);
  });

  it("uses confirm aim and charges double ammo only for confirmed misses", () => {
    const level = loadLidoFixture();
    const controller = createCameleonController({
      level,
      query: { mode: "confirm" },
      env: "test",
    });
    controller.startLevel(1);

    expect(controller.snapshot()).toMatchObject({
      mode: "confirm",
      ammo: 16,
      maxAmmo: 16,
      aim: expect.objectContaining({ armed: false }),
    });

    expect(controller.aimAtWorld({ x: 18, y: 1380 })).toBe(true);
    expect(controller.confirmAim()).toBe("miss");
    expect(controller.snapshot()).toMatchObject({
      ammo: 14,
      feedback: expect.objectContaining({ kind: "miss" }),
    });

    expect(controller.aimAtWorld(rectCenter(level.decoys[0]!.rect))).toBe(true);
    expect(controller.confirmAim()).toBe("decoy");
    expect(controller.snapshot().ammo).toBe(13);
  });

  it("fails shoot mode only when darts are exhausted before eight finds", () => {
    const level = loadLidoFixture();
    const controller = createCameleonController({
      level,
      query: { mode: "shoot" },
      env: "test",
    });
    controller.startLevel(1);

    for (const hide of level.hides.slice(0, 7)) controller.revealHide(hide.id);
    expect(controller.snapshot()).toMatchObject({ foundCount: 7, ammo: 14, scene: FlowStates.Playing });

    for (let index = 0; index < 14; index += 1) {
      controller.tapWorld({ x: 18, y: 1380 });
    }

    expect(controller.snapshot()).toMatchObject({
      scene: FlowStates.Failed,
      status: "lost",
      ammo: 0,
      foundCount: 7,
    });
  });

  it("tracks the 1.4s found beat and makes input interruptible after 0.9s", () => {
    let now = 5_000;
    const level = loadLidoFixture();
    const controller = createCameleonController({ level, env: "test", now: () => now });
    controller.startLevel(1);

    expect(controller.tapWorld(rectCenter(level.hides[0]!.rect))).toBe("hit");
    expect(controller.snapshot().foundBeat).toMatchObject({
      hideId: "li-01",
      elapsedMs: 0,
      phase: "hit-stop",
      interruptible: false,
    });
    expect(controller.tapWorld(rectCenter(level.hides[1]!.rect))).toBe("ignored");

    now += 80;
    expect(controller.snapshot().foundBeat?.phase).toBe("stamp");
    now += 130;
    expect(controller.snapshot().foundBeat?.phase).toBe("peel");
    now += 260;
    expect(controller.snapshot().foundBeat?.phase).toBe("shock");
    now += 220;
    expect(controller.snapshot().foundBeat?.phase).toBe("ragdoll");
    expect(controller.snapshot().inputReady).toBe(false);

    now = 5_901;
    expect(controller.snapshot()).toMatchObject({
      inputReady: true,
      foundBeat: expect.objectContaining({ interruptible: true, phase: "ragdoll" }),
    });
    expect(controller.tapWorld(rectCenter(level.hides[1]!.rect))).toBe("hit");

    now += 1_500;
    expect(controller.snapshot().foundBeat?.phase).toBe("done");
  });

  it("emits one-shot idle shimmer for the nearest unfound hide after sixty seconds", () => {
    let now = 10_000;
    const level = loadLidoFixture();
    const controller = createCameleonController({ level, env: "test", now: () => now });
    controller.setViewport({ width: 390, height: 844 });
    controller.startLevel(1);
    controller.scrollTo(0);

    now += 59_999;
    controller.tick();
    expect(controller.snapshot().idleShimmer).toBeNull();

    now += 1;
    controller.tick();
    const first = controller.snapshot().idleShimmer;
    expect(first).toMatchObject({ sequence: 1, hideId: "li-04" });

    now += 1_000;
    controller.tick();
    expect(controller.snapshot().idleShimmer).toBe(first);

    now += 45_000;
    controller.tick();
    expect(controller.snapshot().idleShimmer).toMatchObject({ sequence: 2, hideId: "li-04" });
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
    expect(controller.drainEvents().find((event) => event.name === "level_win")?.params).toMatchObject({
      level_id: "lido",
      found_count: 8,
      mode: "tap",
      dir: "screenprint",
    });
  });

  it("unlocks the next saga level after a win and preserves progress across a level switch", async () => {
    const bathhouse = loadCameleonLevelFixture("bathhouse");
    const waterpark = loadCameleonLevelFixture("waterpark");
    const controller = createCameleonController({ level: bathhouse, env: "test" });

    expect(controller.snapshot()).toMatchObject({
      levelId: "bathhouse",
      levelNumber: 1,
      unlockedLevel: 1,
      nextLevelId: "waterpark",
      coins: 0,
    });
    expect(controller.isLevelUnlocked("waterpark")).toBe(false);

    await expect(controller.winLevel()).resolves.toBe(true);
    expect(controller.snapshot()).toMatchObject({
      scene: FlowStates.Complete,
      unlockedLevel: 2,
      coins: 1,
    });
    expect(controller.isLevelUnlocked("waterpark")).toBe(true);

    controller.setLevel(waterpark);
    expect(controller.snapshot()).toMatchObject({
      scene: FlowStates.Menu,
      levelId: "waterpark",
      levelNumber: 2,
      unlockedLevel: 2,
      coins: 1,
    });
  });

  it("marks a spotless result when all ten hides are revealed", () => {
    const level = loadLidoFixture();
    const controller = createCameleonController({ level, env: "test" });
    controller.startLevel(1);

    for (const hide of level.hides) {
      controller.revealHide(hide.id);
    }

    expect(controller.snapshot()).toMatchObject({
      scene: FlowStates.Complete,
      foundCount: 10,
      spotless: true,
    });
  });

  it("clamps scroll to the wide-scene bounds", () => {
    const level = loadLidoFixture();
    const controller = createCameleonController({ level, env: "test" });
    controller.setViewport({ width: 390, height: 844 });
    controller.startLevel(1);

    controller.scrollTo(9000);
    expect(controller.snapshot().scrollX).toBe(3930);
    expect(controller.snapshot().tourState).toBe("zone5");

    controller.scrollTo(-100);
    expect(controller.snapshot().scrollX).toBe(0);
  });

  it("switches visual direction without resetting finds or scroll", () => {
    const level = loadLidoFixture();
    const controller = createCameleonController({ level, env: "test" });
    controller.setViewport({ width: 390, height: 844 });
    controller.startLevel(1);
    controller.scrollTo(2100);
    controller.revealHide("li-01");

    controller.setDirection("screenprint");

    expect(controller.snapshot()).toMatchObject({
      dir: "screenprint",
      foundCount: 1,
      scrollX: 2100,
    });
    expect(controller.snapshot().hides.find((hide) => hide.id === "li-02")?.painted.key).toBe("lido.screenprint.li-02.painted");
    // single production direction: re-selecting the active direction is a no-op
    expect(controller.drainEvents().find((event) => event.name === "dir_selected")).toBeUndefined();
  });
});
