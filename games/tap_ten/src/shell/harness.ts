import { FlowStates } from '@fabrikav2/kernel';
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
} from '@fabrikav2/testkit/harness';
import { driveTo as driveToState } from '@fabrikav2/testkit/testing';

import { gameConfig } from '../../game.config.ts';
import {
  createTapTenController,
  TAP_TEN_GOAL,
  TAP_TEN_MAX_MISSES,
  TAP_TEN_TILE_COUNT,
  type TapTenController,
  type TapTenSnapshot,
} from '../game/tapTen.ts';
import type { TapTenScreen } from './TapTenScreen.ts';

export type TapTenVerb = 'tapTile';

export interface TapTenHarness extends GameHarness<TapTenVerb> {
  /** The stamped snapshot envelope (wrong-package guard). Ports keep this. */
  snapshotEnvelope(): SnapshotEnvelope;
}

export interface TapTenHarnessOptions {
  readonly buildVersion: string;
  readonly packageId: string;
  readonly controller?: TapTenController;
  readonly screen?: TapTenScreen;
}

export function createTapTenHarness(meta: TapTenHarnessOptions): TapTenHarness {
  const controller = meta.controller ?? createTapTenController({ env: 'test', sessionId: 'tap-ten-harness' });
  const perf = createPerfRecorder();
  const states = seedStatesFromConfig(gameConfig);

  function gotoMenu(): void {
    controller.gotoMenu();
  }

  function startLevel(id: number): void {
    controller.startLevel(id);
  }

  function openSettings(): void {
    controller.openSettings();
  }

  function pause(): void {
    controller.pause();
  }

  const tapTile: GameVerbHandler<[number]> = {
    run(tile: number) {
      return controller.tapTile(tile);
    },
    clientPoint(tile: number) {
      if (meta.screen) return meta.screen.tileClientPoint(tile);
      const normalized = Math.max(0, Math.min(TAP_TEN_TILE_COUNT - 1, Math.trunc(tile)));
      return {
        x: normalized % 2 === 0 ? 80 : 240,
        y: normalized < 2 ? 80 : 240,
      };
    },
  };

  function snapshot(): TapTenSnapshot {
    return controller.snapshot();
  }

  function solveWin(): void {
    for (let i = 0; i < TAP_TEN_GOAL && snapshot().scene === FlowStates.Playing; i += 1) {
      controller.tapTile(snapshot().litTile);
    }
  }

  function solveFail(): void {
    for (let i = 0; i < TAP_TEN_MAX_MISSES && snapshot().scene === FlowStates.Playing; i += 1) {
      controller.tapTile((snapshot().litTile + 1) % TAP_TEN_TILE_COUNT);
    }
  }

  async function winLevel(): Promise<boolean> {
    if (snapshot().scene !== FlowStates.Playing) controller.startLevel(snapshot().levelId);
    solveWin();
    return snapshot().scene === FlowStates.Complete;
  }

  async function failLevel(): Promise<boolean> {
    if (snapshot().scene !== FlowStates.Playing) controller.startLevel(snapshot().levelId);
    solveFail();
    return snapshot().scene === FlowStates.Failed;
  }

  function driveTo(state: string): Promise<boolean> {
    return driveToState(
      {
        gotoMenu,
        startLevel,
        openSettings,
        pause,
        autoWin: () => winLevel(),
        autoFail: () => failLevel(),
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
        case 'menu':
          gotoMenu();
          break;
        case 'level':
          startLevel(1);
          break;
        case 'settings':
          gotoMenu();
          openSettings();
          break;
        case 'pause':
          startLevel(1);
          pause();
          break;
        case 'win':
          startLevel(1);
          solveWin();
          break;
        case 'fail':
          startLevel(1);
          solveFail();
          break;
      }
    },
    startLevel,
    snapshot,
    sagaNodes(): readonly number[] {
      return [1];
    },
    unlockAll(): void {
      controller.grantCoins(1);
    },
    grantCoins(amount: number): void {
      controller.grantCoins(amount);
    },
    verbs: { tapTile },
    winLevel,
    failLevel,
    driveTo,
    capture(): CaptureResult {
      if (!meta.screen) throw new Error('capture requires the mounted Tap Ten screen.');
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
