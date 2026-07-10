import {
  createPerfRecorder,
  seedStatesFromConfig,
  wrapSnapshot,
  type GameHarness,
  type PerfSample,
  type SnapshotEnvelope,
} from "@fabrikav2/testkit/harness";
import { gameConfig } from "../../game.config.ts";
import {
  createTemplateShellController,
  type TemplateShellController,
  type TemplateShellSnapshot,
} from "../core/TemplateShellController.ts";

type TemplateVerb = never;

export interface TemplateHarness extends GameHarness<TemplateVerb> {
  snapshot(): TemplateShellSnapshot;
  snapshotEnvelope(): SnapshotEnvelope<TemplateShellSnapshot>;
}

export interface CreateTemplateHarnessOptions {
  readonly buildVersion: string;
  readonly packageId: string;
  readonly controller?: TemplateShellController;
}

/**
 * The same state owner that renders the shell is the harness's only mutation
 * path. Its helpers are setup tools; terminal Win/Lose still use the shell's
 * test-only lifecycle actions and confirm the resulting snapshot.
 */
export function createTemplateHarness(options: CreateTemplateHarnessOptions): TemplateHarness {
  const controller = options.controller ?? createTemplateShellController();
  const perf = createPerfRecorder();
  const states = seedStatesFromConfig(gameConfig);

  return {
    gotoState(state: string): void {
      if (!states.includes(state as (typeof states)[number])) {
        throw new Error(`gotoState: "${state}" is not a declared gameConfig.screens state.`);
      }
      controller.gotoState(state);
    },
    startLevel(_id: number): void {
      controller.gotoState("level");
    },
    snapshot(): TemplateShellSnapshot {
      return controller.snapshot();
    },
    sagaNodes(): readonly number[] {
      return controller.sagaNodes();
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
    verbs: {},
    async winLevel(): Promise<boolean> {
      if (controller.snapshot().surface !== "level") {
        controller.gotoState("level");
      }
      return controller.win() && controller.snapshot().scene === "complete";
    },
    async failLevel(): Promise<boolean> {
      if (controller.snapshot().surface !== "level") {
        controller.gotoState("level");
      }
      return controller.lose() && controller.snapshot().scene === "failed";
    },
    driveTo(state: string): Promise<boolean> {
      return controller.driveTo(state);
    },
    perf(): PerfSample {
      return perf.sample();
    },
    drainEvents() {
      return controller.drainTrace();
    },
    snapshotEnvelope(): SnapshotEnvelope<TemplateShellSnapshot> {
      return wrapSnapshot(controller.snapshot(), options);
    },
  };
}
