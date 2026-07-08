import { runLoop } from "./loop.js";
import { applyTap, arrowsRemaining, initialState, loadLevel, type GameState, type LevelSpec } from "./state.js";
import { getLevel, TOTAL_LEVELS } from "./levels.js";
import { computeViewport, type RenderStyle } from "./render.js";
import { solve } from "./solver.js";
import { headCell, type Coord } from "./path.js";
import { slitherOutcome } from "./slither.js";
import type { Progress } from "./persist.js";
import type { JuiceSettings } from "./juice.js";

export interface GameHooks {
  getProgress(): Progress;
  onLevelComplete(level: LevelSpec): void;
  onLevelFailed(level: LevelSpec): void;
  onSettingsRequested(): void;
  onSelectLevel(levelId: number): void;
  onTutorialDone(): void;
  onFullCompletion(seconds: number): void;
  onJuiceChange(juice: JuiceSettings): void;
}

export interface ArrowSnapshot {
  readonly status: GameState["status"];
  readonly inputReady: boolean;
  readonly level: number;
  readonly lives: number;
  readonly arrowsRemaining: number;
  readonly board: {
    readonly cols: number;
    readonly rows: number;
  };
}

const FALLBACK_STYLE: RenderStyle = {
  bg: "#fbf7ef",
  ink: "#182235",
  lavender: "#9b8cff",
  heart: "#e85b8c",
  error: "#e5484d",
  accentSoft: "#d9d0bd",
  activeBlue: "#4a5fff",
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function readStyle(): RenderStyle {
  const source = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string =>
    source.getPropertyValue(name).trim() || fallback;
  return {
    bg: token("--bg", FALLBACK_STYLE.bg),
    ink: token("--ink", FALLBACK_STYLE.ink),
    lavender: token("--lavender", FALLBACK_STYLE.lavender),
    heart: token("--heart", FALLBACK_STYLE.heart),
    error: token("--error", FALLBACK_STYLE.error),
    accentSoft: token("--accent-soft", FALLBACK_STYLE.accentSoft),
    activeBlue: token("--active-blue", FALLBACK_STYLE.activeBlue),
  };
}

export class GameController {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hooks: GameHooks;
  private readonly state = initialState();
  private stopLoop: (() => void) | null = null;
  private currentLevel: LevelSpec | null = null;
  private terminalReported = false;

  constructor(canvas: HTMLCanvasElement, hooks: GameHooks) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("GameController: 2d canvas context unavailable");
    this.ctx = ctx;
    this.hooks = hooks;
    this.resize();
    this.clearCanvas();
  }

  startLevel(levelId: number): boolean {
    const level = getLevel(levelId);
    if (!level) return false;
    this.stop();
    this.resize();
    this.currentLevel = level;
    this.terminalReported = false;
    loadLevel(this.state, level);
    this.stopLoop = runLoop({
      canvas: this.canvas,
      ctx: this.ctx,
      state: this.state,
      style: readStyle(),
      onLevelComplete: () => this.reportComplete(),
      onLevelFailed: () => this.reportFailed(),
      onRestart: () => this.restartLevel(),
      onSelectLevel: (flatIndex) => this.hooks.onSelectLevel(flatIndex),
      getActiveLevel: () => this.currentLevel,
      firstRun: !this.hooks.getProgress().tutorialSeen,
      onTutorialDone: () => this.hooks.onTutorialDone(),
      totalLevels: TOTAL_LEVELS,
      isLastLevel: () => this.currentLevel?.index === TOTAL_LEVELS,
      getProgress: () => this.hooks.getProgress(),
      onFullCompletion: (seconds) => this.hooks.onFullCompletion(seconds),
      onSettingsRequested: () => this.hooks.onSettingsRequested(),
      useShellResults: true,
      onJuiceChange: (juice) => this.hooks.onJuiceChange(juice),
    });
    return true;
  }

  restartLevel(): void {
    if (!this.currentLevel) return;
    this.startLevel(this.currentLevel.index);
  }

  stop(): void {
    if (this.stopLoop) {
      this.stopLoop();
      this.stopLoop = null;
    }
  }

  showIdle(): void {
    this.stop();
    this.currentLevel = null;
    this.state.status = "idle";
    this.state.level = 0;
    this.clearCanvas();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width || window.innerWidth || 1));
    const cssH = Math.max(1, Math.floor(rect.height || window.innerHeight || 1));
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  tapCell(x: number, y: number): boolean {
    const result = applyTap(this.state, x, y);
    if (!result) return false;
    if (result.failed) this.reportFailed();
    else if (result.completed) this.reportComplete();
    return true;
  }

  async winLevel(stepMs = 40): Promise<boolean> {
    if (!this.currentLevel || this.state.status !== "playing") return false;
    const paths = [...this.state.grid.arrows.values()];
    const order = solve(this.state.grid.cols, this.state.grid.rows, paths);
    if (!order) return false;
    for (const cell of order) {
      if (this.gameStatus() !== "playing") break;
      this.tapCell(cell.x, cell.y);
      if (stepMs > 0) await sleep(stepMs);
    }
    return this.gameStatus() === "won";
  }

  async failLevel(stepMs = 40): Promise<boolean> {
    if (!this.currentLevel || this.state.status !== "playing") return false;
    while (this.gameStatus() === "playing") {
      const blocked = this.firstBlockedHead();
      if (!blocked) return false;
      this.tapCell(blocked.x, blocked.y);
      if (stepMs > 0) await sleep(stepMs);
    }
    return this.gameStatus() === "lost";
  }

  cellClientPoint(x: number, y: number): { x: number; y: number } | null {
    if (this.state.status === "idle") return null;
    this.resize();
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.width / dpr;
    const cssH = this.canvas.height / dpr;
    const vp = computeViewport(this.state.grid, cssW, cssH);
    if (x < 0 || y < 0 || x >= this.state.grid.cols || y >= this.state.grid.rows) return null;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + vp.gx + x * vp.cell + vp.cell / 2,
      y: rect.top + vp.gy + y * vp.cell + vp.cell / 2,
    };
  }

  snapshot(): ArrowSnapshot {
    return {
      status: this.state.status,
      inputReady: this.state.status === "playing" && !this.terminalReported,
      level: this.state.level,
      lives: this.state.lives,
      arrowsRemaining: arrowsRemaining(this.state),
      board: {
        cols: this.state.grid.cols,
        rows: this.state.grid.rows,
      },
    };
  }

  currentLevelId(): number {
    return this.currentLevel?.index ?? 0;
  }

  private firstBlockedHead(): Coord | null {
    for (const path of this.state.grid.arrows.values()) {
      if (slitherOutcome(this.state.grid, path).kind === "collide") {
        return headCell(path);
      }
    }
    return null;
  }

  private gameStatus(): GameState["status"] {
    return this.state.status;
  }

  private reportComplete(): void {
    if (this.terminalReported || !this.currentLevel) return;
    this.terminalReported = true;
    this.hooks.onLevelComplete(this.currentLevel);
  }

  private reportFailed(): void {
    if (this.terminalReported || !this.currentLevel) return;
    this.terminalReported = true;
    this.hooks.onLevelFailed(this.currentLevel);
  }

  private clearCanvas(): void {
    this.resize();
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.width / dpr;
    const cssH = this.canvas.height / dpr;
    this.ctx.fillStyle = readStyle().bg;
    this.ctx.fillRect(0, 0, cssW, cssH);
  }
}
