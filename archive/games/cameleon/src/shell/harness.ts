import {
  captureCanvasPng,
  createPerfRecorder,
  seedStatesFromConfig,
  wrapSnapshot,
  type CaptureResult,
  type GameHarness,
  type GameVerbHandler,
  type HarnessSaveProfile,
  type PerfSample,
  type SnapshotEnvelope,
} from "@fabrikav2/testkit/harness";

import { gameConfig } from "../../game.config.ts";
import {
  CAMELEON_TOUR_STATES,
  type CameleonController,
  type CameleonSnapshot,
  type CameleonTourState,
} from "../game/CameleonController.ts";
import { buildCameleonSagaNodes, type CameleonScreen } from "./CameleonScreen.ts";

export type CameleonVerb = "scrollTo" | "tapWorld" | "revealHide" | "winLevel" | "failLevel" | "driveTo";

export interface CameleonHarnessOptions {
  readonly buildVersion: string;
  readonly packageId: string;
  readonly controller: CameleonController;
  readonly screen: CameleonScreen;
}

export interface CameleonHarness extends GameHarness<CameleonVerb> {
  snapshot(): CameleonSnapshot;
  snapshotEnvelope(): SnapshotEnvelope<CameleonSnapshot>;
}

export function createCameleonHarness(options: CameleonHarnessOptions): CameleonHarness {
  const states = seedStatesFromConfig(gameConfig);
  const perf = createPerfRecorder();
  const controller = options.controller;

  const scrollTo: GameVerbHandler<[number]> = {
    run(x: number): void {
      controller.scrollTo(x);
    },
  };

  const tapWorld: GameVerbHandler<[number, number]> = {
    run(x: number, y: number) {
      return controller.tapWorld({ x, y });
    },
    clientPoint(x: number, y: number) {
      return worldClientPoint(options.screen.canvas, controller.snapshot(), x, y);
    },
  };

  const revealHide: GameVerbHandler<[string]> = {
    run(id: string): boolean {
      return controller.revealHide(id);
    },
  };

  const winLevel: GameVerbHandler = {
    run(): Promise<boolean> {
      return controller.winLevel();
    },
  };

  const failLevel: GameVerbHandler = {
    run(): Promise<boolean> {
      return controller.failLevel();
    },
  };

  const driveTo: GameVerbHandler<[string]> = {
    run(state: string): Promise<boolean> {
      if (!isCameleonTourState(state)) return Promise.resolve(false);
      return controller.driveToTourState(state);
    },
  };

  return {
    gotoState(state: string): void {
      if (!states.includes(state as (typeof states)[number])) {
        throw new Error(`gotoState: "${state}" is not a declared Cameleon screen.`);
      }
      if (state === "HomeMenu" || state === "SagaMap") controller.gotoMenu();
      if (state === "Settings") controller.openSettings();
      if (state === "PauseOverlay") {
        controller.startLevel(1);
        controller.pause();
      }
      if (state === "ResultCard") void controller.winLevel();
      if (state === "Toast") options.screen.showToast("Toast");
    },
    startLevel(id = 1): void {
      controller.startLevel(id);
    },
    snapshot(): CameleonSnapshot {
      return controller.snapshot();
    },
    sagaNodes(): readonly (string | number)[] {
      return buildCameleonSagaNodes(controller.snapshot().unlockedLevel).map((node) => node.id);
    },
    unlockAll(): void {
      controller.seedSave({ unlockedLevel: gameConfig.saga.levels });
    },
    grantCoins(amount: number): void {
      controller.grantCoins(amount);
    },
    resetSave(): void {
      controller.resetSave();
    },
    seedSave(profile: HarnessSaveProfile): void {
      controller.seedSave(profile);
    },
    verbs: { scrollTo, tapWorld, revealHide, winLevel, failLevel, driveTo },
    winLevel(): Promise<boolean> {
      return controller.winLevel();
    },
    failLevel(): Promise<boolean> {
      return controller.failLevel();
    },
    driveTo(state: string): Promise<boolean> {
      if (!isCameleonTourState(state)) return Promise.resolve(false);
      return controller.driveToTourState(state);
    },
    capture(): CaptureResult {
      return captureCanvasPng(options.screen.canvas);
    },
    perf(): PerfSample {
      return perf.sample();
    },
    drainEvents() {
      return controller.drainEvents();
    },
    snapshotEnvelope(): SnapshotEnvelope<CameleonSnapshot> {
      return wrapSnapshot(controller.snapshot(), options);
    },
  };
}

function isCameleonTourState(state: string): state is CameleonTourState {
  return (CAMELEON_TOUR_STATES as readonly string[]).includes(state);
}

function worldClientPoint(
  canvas: HTMLCanvasElement,
  snapshot: CameleonSnapshot,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / snapshot.viewport.width;
  const scaleY = rect.height / snapshot.viewport.height;
  return {
    x: rect.left + (worldX - snapshot.scrollX) * scaleX,
    y: rect.top + worldY * scaleY,
  };
}
