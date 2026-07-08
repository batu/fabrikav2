import {
  captureCanvasPng,
  createPerfRecorder,
  seedStatesFromConfig,
  wrapSnapshot,
  type CaptureResult,
  type GameHarness,
  type GameVerbHandler,
  type PerfSample,
  type SnapshotEnvelope,
} from "@fabrikav2/testkit/harness";
import { driveTo as driveToState } from "@fabrikav2/testkit/testing";

import { gameConfig } from "../../game.config.ts";
import { createBlockBlastController, type BlockBlastController } from "../game/BlockBlastFlow.ts";
import type { BlockBlastSnapshot } from "../game/types.ts";
import type { BlockBlastScreen } from "./BlockBlastScreen.ts";

export type BlockBlastVerb = "selectSlot" | "tapCell";

export interface BlockBlastHarness extends GameHarness<BlockBlastVerb> {
  snapshotEnvelope(): SnapshotEnvelope;
}

export interface BlockBlastHarnessOptions {
  readonly buildVersion: string;
  readonly packageId: string;
  readonly controller?: BlockBlastController;
  readonly screen?: BlockBlastScreen;
}

export function createBlockBlastHarness(meta: BlockBlastHarnessOptions): BlockBlastHarness {
  const controller = meta.controller ?? createBlockBlastController({ env: "test", sessionId: "block-blast-harness" });
  const perf = createPerfRecorder();
  const states = seedStatesFromConfig(gameConfig);

  const selectSlot: GameVerbHandler<[number]> = {
    run(slotIndex: number) {
      return controller.selectSlot(slotIndex);
    },
    clientPoint(slotIndex: number) {
      if (!meta.screen) return { x: 80 + slotIndex * 110, y: 560 };
      return meta.screen.slotClientPoint(slotIndex);
    },
  };

  const tapCell: GameVerbHandler<[number, number]> = {
    run(anchorX: number, anchorY: number) {
      return controller.tapCell(anchorX, anchorY);
    },
    clientPoint(anchorX: number, anchorY: number) {
      if (!meta.screen) return { x: 42 + anchorX * 40, y: 42 + anchorY * 40 };
      return meta.screen.cellClientPoint(anchorX, anchorY);
    },
  };

  function snapshot(): BlockBlastSnapshot {
    return controller.snapshot();
  }

  function startLevel(id: number): void {
    controller.startStage(id);
  }

  function driveTo(state: string): Promise<boolean> {
    return driveToState(
      {
        gotoMenu: () => controller.gotoMenu(),
        startLevel,
        openSettings: () => controller.openSettings(),
        pause: () => controller.pause(),
        autoWin: () => controller.winLevel(),
        autoFail: () => controller.failLevel(),
        snapshot: () => ({ ...snapshot() }),
      },
      state,
    );
  }

  return {
    gotoState(state: string): void {
      if (!states.includes(state as (typeof states)[number])) {
        throw new Error(`gotoState: "${state}" is not a declared gameConfig.screens state.`);
      }
      switch (state) {
        case "menu":
          controller.gotoMenu();
          break;
        case "level":
          controller.startStage(1);
          break;
        case "settings":
          controller.gotoMenu();
          controller.openSettings();
          break;
        case "pause":
          controller.startStage(1);
          controller.pause();
          break;
        case "win":
          controller.startStage(1);
          void controller.winLevel();
          break;
        case "fail":
          controller.startStage(1);
          void controller.failLevel();
          break;
      }
    },
    startLevel,
    snapshot,
    sagaNodes(): readonly number[] {
      const unlocked = snapshot().unlockedStage;
      return Array.from({ length: unlocked }, (_, index) => index + 1);
    },
    unlockAll(): void {
      controller.unlockAll();
    },
    grantCoins(amount: number): void {
      controller.grantCoins(amount);
    },
    resetSave(): void {
      controller.resetSave();
    },
    seedSave(profile): void {
      controller.seedSave(profile);
    },
    verbs: { selectSlot, tapCell },
    winLevel: () => controller.winLevel(),
    failLevel: () => controller.failLevel(),
    driveTo,
    capture(): CaptureResult {
      if (!meta.screen) throw new Error("capture requires the mounted Block Blast screen.");
      return captureCanvasPng(meta.screen.canvas);
    },
    perf(): PerfSample {
      return perf.sample();
    },
    drainEvents() {
      return controller.drainEvents();
    },
    snapshotEnvelope(): SnapshotEnvelope {
      return wrapSnapshot(snapshot(), meta);
    },
  };
}
