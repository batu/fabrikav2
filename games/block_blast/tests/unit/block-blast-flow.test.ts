import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { BLOCK_BLAST_STAGE_PRESETS } from "../../content/stages.ts";
import { createBlockBlastController } from "../../src/game/BlockBlastFlow.ts";
import { installMemoryStorage } from "./testStorage.ts";

describe("BlockBlastFlow controller", () => {
  beforeEach(() => {
    installMemoryStorage();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defines twenty staged saga nodes plus deterministic objectives", () => {
    expect(BLOCK_BLAST_STAGE_PRESETS).toHaveLength(20);
    expect(BLOCK_BLAST_STAGE_PRESETS.map((stage) => stage.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(BLOCK_BLAST_STAGE_PRESETS.every((stage) => stage.seed > 0)).toBe(true);
    expect(BLOCK_BLAST_STAGE_PRESETS.every((stage) => stage.objective.kind !== "endless")).toBe(true);
  });

  it("places a valid piece, scores, replaces the slot, and records analytics", () => {
    const controller = createBlockBlastController({ env: "test", sessionId: "unit-place" });
    controller.startStage(1);
    const before = controller.snapshot();
    const slotIndex = before.handPieceIds.findIndex((pieceId) => pieceId !== null);
    const placement = controller.getValidPlacements(slotIndex)[0]!;

    const result = controller.placePiece({ slotIndex, ...placement });

    const after = controller.snapshot();
    expect(result.ok).toBe(true);
    expect(result.points).toBeGreaterThan(0);
    expect(after.score).toBe(result.points);
    expect(after.placements).toBe(1);
    expect(after.handPieceIds[slotIndex]).not.toBeNull();
    expect(controller.drainEvents().some((event) => event.name === "block_place")).toBe(true);
  });

  it("solves every saga stage with the deterministic greedy driver", async () => {
    for (const stage of BLOCK_BLAST_STAGE_PRESETS) {
      localStorage.clear();
      const controller = createBlockBlastController({ env: "test", sessionId: `stage-${stage.id}` });
      controller.startStage(stage.id);

      await expect(controller.winLevel(), `stage ${stage.id}`).resolves.toBe(true);
      const snap = controller.snapshot();
      expect(snap.scene, `stage ${stage.id}`).toBe("complete");
      expect(snap.completedStages).toContain(stage.id);
    }
  });

  it("reaches fail through the deterministic no-fit evaluator", async () => {
    const controller = createBlockBlastController({ env: "test", sessionId: "unit-fail" });
    controller.startStage(1);

    await expect(controller.failLevel()).resolves.toBe(true);

    expect(controller.snapshot()).toMatchObject({ scene: "failed", status: "lost", inputReady: false });
  });

  it("persists best score and unlocked saga progress", async () => {
    const first = createBlockBlastController({ env: "test", sessionId: "persist-a" });
    first.startStage(1);
    await first.winLevel();
    const firstSnap = first.snapshot();
    expect(firstSnap.bestScore).toBeGreaterThan(0);
    expect(firstSnap.unlockedStage).toBe(2);

    const second = createBlockBlastController({ env: "test", sessionId: "persist-b" });
    const secondSnap = second.snapshot();
    expect(secondSnap.bestScore).toBe(firstSnap.bestScore);
    expect(secondSnap.unlockedStage).toBe(2);
  });
});
