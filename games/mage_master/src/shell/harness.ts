import {
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
import { createMageMasterController, type MageMasterController, type MageMasterSnapshot } from "../game/MageMasterController.ts";
import type { MageMasterScreen } from "./MageMasterScreen.ts";

export type MageMasterVerb = "enterLevel" | "pull" | "equip" | "discard" | "upgradeRift" | "skipTimer" | "openRift" | "openMages" | "home";

export interface MageMasterHarness extends GameHarness<MageMasterVerb> {
  snapshot(): MageMasterSnapshot;
  snapshotEnvelope(): SnapshotEnvelope<MageMasterSnapshot>;
  /** Motion evidence: consecutive canvas frames as data URLs. */
  captureFrames(count: number, everyMs: number): Promise<string[]>;
}

export interface MageMasterHarnessOptions {
  readonly buildVersion: string;
  readonly packageId: string;
  readonly controller?: MageMasterController;
  readonly screen?: MageMasterScreen;
}

export function createMageMasterHarness(meta: MageMasterHarnessOptions): MageMasterHarness {
  const controller = meta.controller ?? createMageMasterController({ env: "test" });
  const perf = createPerfRecorder();
  const states = seedStatesFromConfig(gameConfig);
  const point = (action: string) => (): { x: number; y: number } => meta.screen?.clientPoint(action) ?? { x: 0, y: 0 };

  const verb = <Args extends readonly unknown[]>(run: (...args: Args) => unknown, action?: string): GameVerbHandler<Args> =>
    action ? { run, clientPoint: point(action) } : { run };

  const enterLevel: GameVerbHandler<[number?]> = {
    run(level?: number) {
      return controller.enterLevel(level);
    },
    clientPoint(level?: number) {
      return meta.screen?.clientPoint(level ? `level-${level}` : "play") ?? { x: 0, y: 0 };
    },
  };

  function gotoMenu(): void {
    const snap = controller.snapshot();
    if (snap.surface === "battle") controller.pause();
    if (controller.snapshot().surface === "pause") controller.quitBattle();
    if (controller.snapshot().surface === "settings") controller.closeSettings();
    if (controller.snapshot().surface === "win") controller.next();
    if (controller.snapshot().surface === "fail") controller.retry();
    if (controller.snapshot().surface === "battle") controller.quitBattle();
    controller.home();
  }

  async function winLevel(): Promise<boolean> {
    if (controller.snapshot().surface !== "battle") {
      gotoMenu();
      controller.grantResources({ energy: 10 });
      controller.enterLevel(1);
    }
    return controller.resolveBattle("win") && controller.snapshot().scene === "complete";
  }

  async function failLevel(): Promise<boolean> {
    if (controller.snapshot().surface !== "battle") {
      gotoMenu();
      controller.grantResources({ energy: 10 });
      controller.enterLevel(Math.max(1, controller.snapshot().unlockedLevel));
    }
    return controller.resolveBattle("lose") && controller.snapshot().scene === "failed";
  }

  return {
    gotoState(state: string) {
      if (!states.includes(state as (typeof states)[number])) throw new Error(`gotoState: "${state}" is not a declared screen`);
      void this.driveTo?.(state);
    },
    startLevel(id: number) {
      gotoMenu();
      controller.grantResources({ energy: 10 });
      controller.enterLevel(id);
    },
    snapshot() {
      return controller.snapshot();
    },
    sagaNodes() {
      return Array.from({ length: controller.snapshot().unlockedLevel }, (_v, i) => i + 1);
    },
    unlockAll() {
      controller.unlockAll();
    },
    grantCoins(amount: number) {
      controller.grantCoins(amount);
    },
    resetSave() {
      controller.resetSave();
    },
    seedSave(profile) {
      controller.resetSave();
      controller.grantResources({ gold: profile.coins ?? 50, energy: 10, crystals: 100, gems: 30 });
      if (profile.unlockedLevel && profile.unlockedLevel > 1) {
        for (let level = 1; level < profile.unlockedLevel; level += 1) {
          controller.enterLevel(level);
          controller.resolveBattle("win");
          controller.next();
          controller.home();
        }
      }
      if (profile.music !== undefined) controller.setSetting("music", profile.music);
      if (profile.sfx !== undefined) controller.setSetting("sfx", profile.sfx);
      if (profile.haptics !== undefined) controller.setSetting("haptics", profile.haptics);
    },
    verbs: {
      enterLevel,
      pull: verb(() => controller.pull(), "pull"),
      equip: verb(() => controller.useItem(), "reveal-use"),
      discard: verb(() => controller.discardItem(), "reveal-discard"),
      upgradeRift: verb(() => controller.upgradeRift(), "upgrade-rift"),
      skipTimer: verb(() => controller.skipUpgrade(), "skip-upgrade"),
      openRift: verb(() => controller.openRift(), "nav-rift"),
      openMages: verb(() => controller.openMages(), "nav-mages"),
      home: verb(() => controller.home(), "nav-home"),
    },
    winLevel,
    failLevel,
    async driveTo(state: string) {
      return driveToState(
        {
          gotoMenu,
          startLevel: (id) => {
            gotoMenu();
            controller.grantResources({ energy: 10 });
            controller.enterLevel(id);
          },
          openSettings: () => {
            controller.openSettings();
          },
          pause: () => {
            controller.pause();
          },
          autoWin: winLevel,
          autoFail: failLevel,
          snapshot: () => {
            const s = controller.snapshot();
            return { scene: s.scene, status: s.status, inputReady: s.inputReady, settingsOpen: s.settingsOpen };
          },
        },
        state,
        { pollMs: 0, maxPolls: 1 },
      );
    },
    perf(): PerfSample {
      return perf.sample();
    },
    async capture(): Promise<CaptureResult> {
      const frames = await meta.screen?.captureBattleFrames(1, 0);
      const src = frames?.[0] ?? "";
      const base64 = src.replace(/^data:image\/png;base64,/, "");
      return { pngBase64: base64, width: 0, height: 0 };
    },
    captureFrames(count: number, everyMs: number) {
      return meta.screen?.captureBattleFrames(count, everyMs) ?? Promise.resolve([]);
    },
    drainEvents() {
      return controller.drainTrace();
    },
    snapshotEnvelope() {
      return wrapSnapshot(controller.snapshot(), meta);
    },
  };
}
