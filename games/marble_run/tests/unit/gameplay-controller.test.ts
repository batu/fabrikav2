import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The three.js Stage + BoardScene need WebGL; mock them so the controller's
// logic (engine wiring, tap → change, win/fail timing, hint gating, dispose)
// runs headless. The marble-board engine itself is real.
vi.mock("../../src/three/Stage", () => ({
  Stage: class {
    world = { add: vi.fn(), remove: vi.fn() };
    renderer = { domElement: { setPointerCapture: vi.fn() } };
    setViewOffsetYRatio() {}
    setDebugCamera() {}
    frameBoard() {}
    render() {}
    dispose() {}
    pickObject() { return null; }
    pointerToWorld() { return null; }
    worldToClient() { return { x: 0, y: 0 }; }
  },
}));

interface MockBoardScene {
  root: unknown;
  disposed: boolean;
}

const boardHolder = vi.hoisted(() => ({ last: null as MockBoardScene | null }));

vi.mock("../../src/three/BoardScene", () => {
  class MockBoardSceneImpl {
    root = {};
    disposed = false;
    private readonly cb: {
      onAbsorbed: (c: unknown) => void;
      onBlockedImpact: (c: unknown) => void;
    };
    constructor(_engine: unknown, cb: MockBoardSceneImpl["cb"]) {
      this.cb = cb;
      boardHolder.last = this;
    }
    boardSize() { return { w: 5, d: 5 }; }
    refreshGateLiveness() {}
    marbleMeshes() { return []; }
    cellOfMarble() { return null; }
    clearRoutePreview() {}
    isBlockedMarbleAnimating() { return false; }
    // Drive the controller's outcome callbacks the way the real animated board
    // does when a change finishes.
    animateChange(change: { kind: string }) {
      if (change.kind === "rolled") this.cb.onAbsorbed(change);
      else this.cb.onBlockedImpact(change);
    }
    showRoutePreview() {}
    showBlockedRoutePreview() {}
    pulseHint() {}
    hasRoutePreview() { return false; }
    breakCompletedColor() {}
    dispose() { this.disposed = true; }
    tick() {}
    cellToWorld() { return {}; }
    worldToCell() { return null; }
    setAnimationSpeed() {}
    isAnimating() { return false; }
    isSpawningMarbles() { return false; }
  }
  return { BoardScene: MockBoardSceneImpl };
});

vi.mock("../../src/audio/Sfx", () => ({
  absorbPlop: vi.fn(),
  heartBreak: vi.fn(),
  thud: vi.fn(),
  unlockAudio: vi.fn(),
  winFanfare: vi.fn(),
  loseSting: vi.fn(),
  rollTic: vi.fn(),
  setRollingActive: vi.fn(),
  spawnTick: vi.fn(),
}));

import { GameplayController, type GameplayHooks } from "../../src/gameplay/GameplayController";
import { LEVELS } from "../../src/levels/levels.generated";
import { LEVEL_COIN_REWARD, HINT_COIN_COST } from "../../src/three/constants";
import { solveLevel } from "../../src/marble-board";
import { absorbPlop } from "../../src/audio/Sfx";
import type { Cell } from "../../src/marble-board";

function makeHooks(overrides: Partial<GameplayHooks> = {}): GameplayHooks & { coins: number } {
  const state = {
    coins: 0,
    getCoins(): number { return state.coins; },
    spendCoins(cost: number): boolean {
      if (state.coins < cost) return false;
      state.coins -= cost;
      return true;
    },
    onWin: vi.fn(),
    onFail: vi.fn(),
    onHintUsed: vi.fn(),
    openSettings: vi.fn(),
    isFirstLevel: () => false,
    ...overrides,
  };
  return state as unknown as GameplayHooks & { coins: number };
}

describe("GameplayController", () => {
  let container: HTMLElement;
  let controller: GameplayController | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    container = document.createElement("div");
    container.id = "game-container";
    document.body.appendChild(container);
    boardHolder.last = null;
  });

  afterEach(() => {
    controller?.dispose();
    controller = null;
    vi.useRealTimers();
  });

  it("mounts a level: builds a BoardEngine from LEVELS[0] and one BoardScene", () => {
    controller = new GameplayController(container, makeHooks());
    controller.startLevel(1);
    expect(controller.engineRef()).not.toBeNull();
    expect(controller.engineRef()!.remainingCount()).toBe(
      LEVELS[0].cells.join("").replace(/[^RBGYPO]/g, "").length,
    );
    expect(boardHolder.last).not.toBeNull();
  });

  it("applies the engine change and plays the absorb cue on a routable tap", () => {
    controller = new GameplayController(container, makeHooks());
    controller.startLevel(1);
    const engine = controller.engineRef()!;
    const cell = engine.movableMarbles()[0]!.cell;
    const change = controller.tapCell(cell);
    expect(change?.kind).toBe("rolled");
    expect(absorbPlop).toHaveBeenCalled();
  });

  it("fires onWin with the v1 coin reward once the board clears", () => {
    const hooks = makeHooks();
    controller = new GameplayController(container, hooks);
    controller.startLevel(1);
    for (const cell of solveLevel(LEVELS[0]).order) {
      controller.tapCell(cell);
    }
    expect(controller.engineRef()!.gameStatus()).toBe("won");
    vi.advanceTimersByTime(350); // v1 win-modal delay is 300ms
    expect(hooks.onWin).toHaveBeenCalledWith(1, LEVEL_COIN_REWARD);
  });

  it("fires onFail after the last heart is lost (v1 fail delay)", () => {
    // Find a level whose first tap is on a blocked marble, then drain hearts.
    let levelIndex = -1;
    let blockedCell: Cell | null = null;
    for (let i = 0; i < LEVELS.length; i += 1) {
      const probe = new GameplayController(container, makeHooks());
      probe.startLevel(i + 1);
      const engine = probe.engineRef()!;
      const blocked = engine.allMarbles().find((m) => engine.previewTap(m.cell) === null);
      probe.dispose();
      if (blocked) { levelIndex = i; blockedCell = blocked.cell; break; }
    }
    expect(blockedCell).not.toBeNull();

    const hooks = makeHooks();
    controller = new GameplayController(container, hooks);
    controller.startLevel(levelIndex + 1);
    const total = controller.engineRef()!.totalHearts();
    for (let i = 0; i < total; i += 1) controller.tapCell(blockedCell!);
    expect(controller.engineRef()!.gameStatus()).toBe("failed");
    vi.advanceTimersByTime(500); // v1 fail-modal delay is 420ms
    expect(hooks.onFail).toHaveBeenCalledWith(levelIndex + 1);
  });

  it("does nothing and opens no purchase surface when a hint cannot be afforded", () => {
    const hooks = makeHooks();
    controller = new GameplayController(container, hooks);
    controller.startLevel(1);

    hooks.coins = 0;
    controller.showHint();
    expect(hooks.onHintUsed).not.toHaveBeenCalled();
    expect(hooks.coins).toBe(0);
    expect(document.querySelector("#hint-booster-modal")).toBeNull();
    expect(document.querySelector(".home-page-shop")).toBeNull();

    hooks.coins = HINT_COIN_COST;
    controller.showHint();
    expect(hooks.onHintUsed).toHaveBeenCalledTimes(1);
    expect(hooks.coins).toBe(0);
  });

  it("disposes the board and cancels the loop on unmount", () => {
    controller = new GameplayController(container, makeHooks());
    controller.startLevel(1);
    const board = boardHolder.last!;
    controller.dispose();
    expect(board.disposed).toBe(true);
    expect(controller.engineRef()).toBeNull();
    expect(container.querySelector(".mr-three-canvas")).toBeNull();
    controller = null;
  });
});
