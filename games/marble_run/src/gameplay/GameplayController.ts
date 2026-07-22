/**
 * Gameplay controller — the level-run slice of Sugar3D v1 `src/App.ts`, ported
 * as-is for fidelity. Owns one Stage (three.js) + one BoardScene per run, the
 * rAF render loop, pointer input (tap assist, precise-blocked-hit assist,
 * long-press route preview, pointer capture semantics), the hint flow, the
 * level-1 tutorial hand, and win/fail detection with the v1 modal-timing
 * delays.
 *
 * Adapted from v1 (audit trail for the fidelity gate):
 *  - The menu / decor board, four-finger debug panel, and screen routing are
 *    dropped — the fabrikav2 shell (Phaser scenes) owns those.
 *  - v1 `saveState` (coins/hearts/haptics) is replaced by injected shell hooks
 *    (`GameplayHooks`), so the shell economy + settings stay the source of
 *    truth (KTD7). `saveState.recordWin` and the ads-backed `saveFailedRun`
 *    flow become the outward `onWin` / `onFail` hooks — the shell drives the
 *    MRV2-5 win/fail overlays and fail-continue offers.
 *  - Haptics call `./haptics` (the `@capacitor/haptics` adapter) instead of the
 *    absent v1 `@fabrika/core/haptics`; call sites are unchanged.
 *  - `music` and the ads service are out of scope and not carried.
 * Input constants, the pending-pointer state machine, and the win/fail timing
 * are carried verbatim.
 */
import { GAMEPLAY_CAMERA_GROUND_ANGLE_DEG, HINT_COIN_COST, LEVEL_COIN_REWARD, LEVEL_COUNT, LONG_PRESS_ROUTE_MS, W3D } from '../three/constants';
import { gameState } from '../core/GameState';
import { LEVELS } from '../levels/levels.generated';
import { BoardEngine } from '../marble-board';
import type { Cell, TapChange } from '../marble-board';
import {
  absorbPlop,
  heartBreak,
  thud,
  unlockAudio,
  winFanfare,
  loseSting,
} from '../audio/Sfx';
import { BoardScene } from '../three/BoardScene';
import { Stage } from '../three/Stage';
import { GameHud } from './hud';
import { ImpactStyle, NotificationType, safeImpact, safeNotification } from './haptics';

interface PendingPointer {
  readonly pointerId: number;
  readonly cell: Cell;
  readonly holdCell: Cell;
  routeShown: boolean;
}

interface PointerTarget {
  readonly actionCell: Cell;
  readonly holdCell: Cell;
}

const TAP_ASSIST_RADIUS_PX = 46;
const PRECISE_BLOCKED_HIT_MAX_PX = 8;
const PRECISE_BLOCKED_HIT_ASSIST_RATIO = 0.25;

/** Injected shell seams: economy state + outcome routing (KTD7). */
export interface GameplayHooks {
  /** Current shell coin balance. */
  getCoins(): number;
  /** Spend `cost` coins; returns false when the balance is insufficient. */
  spendCoins(cost: number): boolean;
  /** The level (1-based id) cleared, plus the v1 coin reward. */
  onWin(levelId: number, coinsEarned: number): void;
  /** Last heart lost — the shell drives the fail overlay / continue offers. */
  onFail(levelId: number): void;
  /** Hint consumed (coins already spent). */
  onHintUsed?(): void;
  /** Open the shell in-game settings modal (Restart + Home). */
  openSettings(): void;
  /** True when this is the player's first-ever run of level 1 (tutorial gate). */
  isFirstLevel(): boolean;
}

export class GameplayController {
  readonly stage: Stage;
  private readonly hud: GameHud;
  private readonly hooks: GameplayHooks;
  private readonly canvas: HTMLCanvasElement;
  private readonly hudRoot: HTMLElement;
  private engine: BoardEngine | null = null;
  private board: BoardScene | null = null;
  private levelId = 1;
  private paused = false;
  private ended = false;
  private consecutiveBlocked = 0;
  private inputReadyAt = 0;
  private tutorialEl: HTMLElement | null = null;
  private tutorialCell: Cell | null = null;
  private lastTime = performance.now();
  private pendingPointer: PendingPointer | null = null;
  private longPressTimer: number | null = null;
  private failModalTimer: number | null = null;
  private winModalTimer: number | null = null;
  private rafHandle: number | null = null;
  private disposed = false;

  private readonly boundPointerDown: (e: PointerEvent) => void;
  private readonly boundPointerUp: (e: PointerEvent) => void;
  private readonly boundPointerCancel: (e: PointerEvent) => void;
  private readonly boundUnlockAudio: () => void;

  constructor(container: HTMLElement, hooks: GameplayHooks) {
    this.hooks = hooks;

    // The three.js canvas fills the container behind the DOM HUD; the Phaser
    // canvas underneath renders nothing during gameplay (KTD2).
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mr-three-canvas';
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '1',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(this.canvas);

    this.hudRoot = document.createElement('div');
    this.hudRoot.className = 'mr-gameplay-ui';
    Object.assign(this.hudRoot.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '3',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(this.hudRoot);

    this.stage = new Stage(this.canvas);
    this.stage.setViewOffsetYRatio(0.035);
    this.stage.setDebugCamera('dimetric', GAMEPLAY_CAMERA_GROUND_ANGLE_DEG, 90);

    this.hud = new GameHud(this.hudRoot, {
      onHint: () => this.showHint(),
      onSettings: () => this.hooks.openSettings(),
    });

    this.boundPointerDown = (e) => this.onPointerDown(e);
    this.boundPointerUp = (e) => this.onPointerUp(e);
    this.boundPointerCancel = (e) => this.onPointerCancel(e);
    this.boundUnlockAudio = () => unlockAudio();
    this.canvas.addEventListener('pointerdown', this.boundPointerDown);
    this.canvas.addEventListener('pointerup', this.boundPointerUp);
    this.canvas.addEventListener('pointercancel', this.boundPointerCancel);
    this.canvas.addEventListener('lostpointercapture', this.boundPointerCancel);
    window.addEventListener('pointerdown', this.boundUnlockAudio);

    this.lastTime = performance.now();
    this.rafHandle = requestAnimationFrame(() => this.loop());
  }

  // ── Level lifecycle ─────────────────────────────────────────────

  /** Start a level run. `levelId` is 1-based (shell progression + 1). */
  startLevel(levelId: number): void {
    this.levelId = Math.min(Math.max(levelId, 1), LEVEL_COUNT);
    this.paused = false;
    this.ended = false;
    this.consecutiveBlocked = 0;
    this.cancelPendingPointer();
    this.clearBoard();

    this.engine = new BoardEngine(LEVELS[this.levelId - 1]);
    this.board = new BoardScene(this.engine, {
      onAbsorbed: (change) => this.handleAbsorbed(change),
      onBlockedImpact: (change) => this.handleBlockedImpact(change),
    });
    this.stage.world.add(this.board.root);
    const { w, d } = this.board.boardSize();
    this.stage.frameBoard(w, d);
    this.board.refreshGateLiveness();

    const spawnDelay = this.engine.remainingCount() * W3D.SPAWN_STAGGER_S * 1000;
    this.inputReadyAt = performance.now() + spawnDelay + 450;

    this.hud.showGameHud(this.levelId, this.engine.totalHearts(), this.engine.remainingCount(), this.hooks.getCoins());

    if (this.levelId === 1 && this.hooks.isFirstLevel()) this.showTutorialHand();
  }

  pause(): void {
    this.paused = true;
  }

  /** Hide/show the vida HUD chrome — used when a shell overlay (win/fail/
   *  settings) takes over, so it isn't painted above the overlay. The three
   *  board keeps rendering underneath. */
  setHudVisible(visible: boolean): void {
    this.hudRoot.style.display = visible ? '' : 'none';
  }

  resume(): void {
    this.paused = false;
  }

  private clearBoard(): void {
    this.clearFailModalTimer();
    this.clearWinModalTimer();
    this.cancelPendingPointer();
    if (this.board) {
      this.stage.world.remove(this.board.root);
      this.board.dispose();
      this.board = null;
    }
    this.engine = null;
    this.tutorialEl = null;
    this.tutorialCell = null;
  }

  // ── Input ───────────────────────────────────────────────────────

  private onPointerDown(e: PointerEvent): void {
    if (this.paused || this.ended) return;
    if (!this.engine || !this.board) return;
    if (performance.now() < this.inputReadyAt) return;
    e.preventDefault();
    if (this.pendingPointer) return;
    this.hud.hideRouteBlockedPrompt();
    const target = this.resolvePointerTarget(e);
    if (!target || !this.engine.marbleAt(target.actionCell)) return;
    if (this.tutorialCell && !sameCell(target.actionCell, this.tutorialCell)) {
      this.hapticImpact(ImpactStyle.Light);
      this.pulseTutorial();
      return;
    }

    this.pendingPointer = {
      pointerId: e.pointerId,
      cell: target.actionCell,
      holdCell: target.holdCell,
      routeShown: false,
    };
    this.stage.renderer.domElement.setPointerCapture(e.pointerId);
    this.longPressTimer = window.setTimeout(() => {
      if (!this.engine || !this.board || !this.pendingPointer) return;
      const preview = this.engine.previewTap(this.pendingPointer.holdCell);
      this.pendingPointer.routeShown = true;
      if (preview) {
        this.hud.hideRouteBlockedPrompt();
        this.board.showRoutePreview(preview);
      } else {
        this.board.showBlockedRoutePreview(this.pendingPointer.holdCell);
        this.hud.showRouteBlockedPrompt();
      }
      if (this.pendingPointer.routeShown) this.hapticImpact(ImpactStyle.Light);
    }, LONG_PRESS_ROUTE_MS);
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.pendingPointer || this.pendingPointer.pointerId !== e.pointerId) return;
    e.preventDefault();
    const pending = this.pendingPointer;
    this.cancelPendingPointer();
    if (pending.routeShown) return;
    this.tapCell(pending.cell);
  }

  private onPointerCancel(e: PointerEvent): void {
    if (this.pendingPointer?.pointerId !== e.pointerId) return;
    e.preventDefault();
    this.cancelPendingPointer();
  }

  private cancelPendingPointer(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.pendingPointer = null;
    this.hud.hideRouteBlockedPrompt();
  }

  private resolvePointerTarget(e: PointerEvent): PointerTarget | null {
    if (!this.board || !this.engine) return null;
    const assistedMovableCell = this.nearestProjectedMovableCell(e.clientX, e.clientY);
    const planeCell = this.pointerPlaneCell(e.clientX, e.clientY);
    // Precise pick first: in dimetric, a marble's upper half hovers over
    // the cell BEHIND it — plane-mapping alone mis-taps there.
    const hit = this.stage.pickObject(e.clientX, e.clientY, this.board.marbleMeshes());
    if (hit) {
      const id = (hit.userData as { marbleId?: number }).marbleId;
      if (id !== undefined) {
        const cell = this.board.cellOfMarble(id);
        if (cell) {
          const preview = this.engine.previewTap(cell);
          if (preview) return { actionCell: cell, holdCell: cell };
          if (planeCell && !sameCell(planeCell, cell) && this.engine.previewTap(planeCell)) {
            return { actionCell: planeCell, holdCell: cell };
          }
          if (
            planeCell
            && sameCell(planeCell, cell)
            && this.isPreciseBlockedHit(cell, assistedMovableCell, e.clientX, e.clientY)
          ) {
            return { actionCell: cell, holdCell: cell };
          }
          const actionCell = assistedMovableCell ?? cell;
          return { actionCell, holdCell: cell };
        }
      }
    }
    if (assistedMovableCell) return { actionCell: assistedMovableCell, holdCell: assistedMovableCell };
    if (!planeCell) return null;
    return { actionCell: planeCell, holdCell: planeCell };
  }

  private pointerPlaneCell(clientX: number, clientY: number): Cell | null {
    if (!this.board) return null;
    const world = this.stage.pointerToWorld(clientX, clientY, 0.15 + W3D.MARBLE_R);
    if (!world) return null;
    const local = this.board.root.worldToLocal(world.clone());
    return this.board.worldToCell(local);
  }

  private isPreciseBlockedHit(
    hitCell: Cell,
    assistedCell: Cell | null,
    clientX: number,
    clientY: number,
  ): boolean {
    if (!assistedCell) return true;
    const hitPoint = this.cellClientPoint(hitCell);
    const assistPoint = this.cellClientPoint(assistedCell);
    if (!hitPoint || !assistPoint) return true;

    const hitDistance = Math.hypot(hitPoint.x - clientX, hitPoint.y - clientY);
    const assistDistance = Math.hypot(assistPoint.x - clientX, assistPoint.y - clientY);
    const preciseRadius = Math.min(
      PRECISE_BLOCKED_HIT_MAX_PX,
      assistDistance * PRECISE_BLOCKED_HIT_ASSIST_RATIO,
    );
    return hitDistance <= preciseRadius;
  }

  private nearestProjectedMovableCell(clientX: number, clientY: number): Cell | null {
    if (!this.engine) return null;
    let best: { cell: Cell; distance: number } | null = null;
    for (const marble of this.engine.movableMarbles()) {
      const point = this.cellClientPoint(marble.cell);
      if (!point) continue;
      const distance = Math.hypot(point.x - clientX, point.y - clientY);
      if (distance > TAP_ASSIST_RADIUS_PX) continue;
      if (!best || distance < best.distance) best = { cell: marble.cell, distance };
    }
    return best?.cell ?? null;
  }

  tapCell(cell: Cell): TapChange | null {
    if (!this.engine || !this.board) return null;
    if (this.paused || this.ended) return null;
    if (this.engine.gameStatus() !== 'playing') return null;
    unlockAudio();
    this.board.clearRoutePreview();

    const marble = this.engine.marbleAt(cell);
    if (marble) {
      if (this.board.isBlockedMarbleAnimating(marble.id)) return null;
    }

    const change = this.engine.tap(cell);
    if (!change) return null;

    this.board.animateChange(change);
    this.board.refreshGateLiveness();

    if (change.kind === 'rolled') {
      this.consecutiveBlocked = 0;
      if (this.tutorialEl) {
        this.tutorialEl.remove();
        this.tutorialEl = null;
        this.tutorialCell = null;
      }
      this.hapticImpact(ImpactStyle.Light);
      this.hud.popStreak(change.streak);
    } else {
      this.consecutiveBlocked += 1;
      if (this.consecutiveBlocked >= 2 && !change.failed) {
        window.setTimeout(() => {
          if (!this.engine || !this.board) return;
          if (this.engine.gameStatus() !== 'playing') return;
          const movable = this.engine.movableMarbles();
          if (movable.length > 0) this.board.pulseHint(movable[0].cell);
        }, 450);
      }
      thud();
    }
    return change;
  }

  private handleBlockedImpact(change: Extract<TapChange, { kind: 'blocked' }>): void {
    if (!this.engine || !this.board) return;
    heartBreak();
    this.hapticMistake(change.failed);
    this.hud.setHearts(change.heartsLeft);
    if (change.failed) {
      const failedEngine = this.engine;
      const failedBoard = this.board;
      const failedLevel = this.levelId;
      this.clearFailModalTimer();
      this.failModalTimer = window.setTimeout(() => {
        this.failModalTimer = null;
        if (this.ended) return;
        if (this.engine !== failedEngine || this.board !== failedBoard || this.levelId !== failedLevel) return;
        if (this.engine.gameStatus() !== 'failed') return;
        this.emitFail();
      }, 420);
    }
  }

  private handleAbsorbed(change: Extract<TapChange, { kind: 'rolled' }>): void {
    if (!this.engine) return;
    const absorbedBoard = this.board;
    const absorbedEngine = this.engine;
    absorbPlop(change.streak);
    this.hapticCombo(change.streak);
    const colorRemaining = this.engine.allMarbles().some((m) => m.color === change.color);
    if (!colorRemaining) {
      window.setTimeout(() => {
        if (this.board !== absorbedBoard || this.engine !== absorbedEngine) return;
        this.board?.breakCompletedColor(change.color);
      }, 240);
    }
    if (change.won) {
      const wonLevel = this.levelId;
      this.clearWinModalTimer();
      this.winModalTimer = window.setTimeout(() => {
        this.winModalTimer = null;
        if (this.ended) return;
        if (this.engine !== absorbedEngine || this.board !== absorbedBoard || this.levelId !== wonLevel) return;
        if (this.engine.gameStatus() !== 'won') return;
        this.emitWin();
      }, 300);
    }
  }

  private emitWin(): void {
    if (!this.engine || this.ended) return;
    this.ended = true;
    winFanfare();
    this.hapticNotification(NotificationType.Success);
    this.hapticImpact(ImpactStyle.Medium, 85);
    this.hooks.onWin(this.levelId, LEVEL_COIN_REWARD);
  }

  private emitFail(): void {
    if (this.ended) return;
    this.ended = true;
    loseSting();
    this.hapticNotification(NotificationType.Error);
    this.hooks.onFail(this.levelId);
  }

  showHint(): void {
    if (!this.engine || !this.board) return;
    if (this.engine.gameStatus() !== 'playing') return;
    if (this.board.hasRoutePreview()) return;
    const movable = this.engine.movableMarbles();
    if (movable.length === 0) return;
    const preview = this.engine.previewTap(movable[0].cell);
    if (!preview) return;
    if (!this.hooks.spendCoins(HINT_COIN_COST)) {
      this.hapticImpact(ImpactStyle.Light);
      return;
    }
    this.hud.setCoins(this.hooks.getCoins());
    this.hooks.onHintUsed?.();
    this.board.showRoutePreview(preview);
    this.hapticImpact(ImpactStyle.Light);
  }

  private showTutorialHand(): void {
    if (!this.engine || !this.board) return;
    const movable = this.engine.movableMarbles();
    if (movable.length === 0) return;
    const target = movable[0].cell;
    const point = this.cellClientPoint(target);
    if (!point) return;
    this.tutorialCell = target;
    this.tutorialEl?.remove();
    this.tutorialEl = this.hud.showTutorialHand(point);
    const preview = this.engine.previewTap(target);
    if (preview) this.board.showRoutePreview(preview);
  }

  private pulseTutorial(): void {
    if (!this.tutorialEl) return;
    this.tutorialEl.classList.remove('tutorial-reject');
    void this.tutorialEl.offsetWidth;
    this.tutorialEl.classList.add('tutorial-reject');
    window.setTimeout(() => this.tutorialEl?.classList.remove('tutorial-reject'), 420);
  }

  // ── Loop ────────────────────────────────────────────────────────

  private loop(): void {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    if (!this.paused) {
      this.board?.tick(dt);
    }
    this.stage.render();
    this.rafHandle = requestAnimationFrame(() => this.loop());
  }

  cellClientPoint(cell: Cell): { x: number; y: number } | null {
    if (!this.board) return null;
    const local = this.board.cellToWorld(cell, 0.15 + W3D.MARBLE_R);
    const world = this.board.root.localToWorld(local);
    return this.stage.worldToClient(world);
  }

  setAnimationSpeed(multiplier: number): void {
    this.board?.setAnimationSpeed(multiplier);
  }

  /** Test/harness surface — a subset of v1 `App.snapshot()`. */
  snapshot(): Record<string, unknown> {
    return {
      levelId: this.levelId,
      hearts: this.engine?.hearts() ?? null,
      remaining: this.engine?.remainingCount() ?? null,
      status: this.engine?.gameStatus() ?? 'none',
      streak: this.engine?.currentStreak() ?? 0,
      animating: this.board?.isAnimating() ?? false,
      spawningMarbles: this.board?.isSpawningMarbles() ?? false,
      inputReady: performance.now() >= this.inputReadyAt,
      coins: this.hooks.getCoins(),
      routePreviewVisible: this.board?.hasRoutePreview() ?? false,
      tutorialTarget: this.tutorialCell,
      paused: this.paused,
      ended: this.ended,
    };
  }

  engineRef(): BoardEngine | null {
    return this.engine;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.clearBoard();
    this.canvas.removeEventListener('pointerdown', this.boundPointerDown);
    this.canvas.removeEventListener('pointerup', this.boundPointerUp);
    this.canvas.removeEventListener('pointercancel', this.boundPointerCancel);
    this.canvas.removeEventListener('lostpointercapture', this.boundPointerCancel);
    window.removeEventListener('pointerdown', this.boundUnlockAudio);
    this.hud.dispose();
    this.stage.dispose();
    this.canvas.remove();
    this.hudRoot.remove();
  }

  private hapticImpact(style: ImpactStyle, delayMs = 0): void {
    if (!gameState.settings.hapticsOn) return;
    if (delayMs <= 0) {
      void safeImpact(style);
      return;
    }
    window.setTimeout(() => {
      if (gameState.settings.hapticsOn) void safeImpact(style);
    }, delayMs);
  }

  private hapticNotification(type: NotificationType): void {
    if (!gameState.settings.hapticsOn) return;
    void safeNotification(type);
  }

  private hapticCombo(streak: number): void {
    this.hapticImpact(comboImpactStyle(streak));
    if (streak >= 3) this.hapticImpact(ImpactStyle.Light, 55);
    if (streak >= 7) this.hapticImpact(ImpactStyle.Medium, 115);
  }

  private hapticMistake(failed: boolean): void {
    this.hapticImpact(failed ? ImpactStyle.Heavy : ImpactStyle.Medium);
    if (!failed) this.hapticImpact(ImpactStyle.Light, 70);
  }

  private clearFailModalTimer(): void {
    if (this.failModalTimer === null) return;
    window.clearTimeout(this.failModalTimer);
    this.failModalTimer = null;
  }

  private clearWinModalTimer(): void {
    if (this.winModalTimer === null) return;
    window.clearTimeout(this.winModalTimer);
    this.winModalTimer = null;
  }
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

function comboImpactStyle(streak: number): ImpactStyle {
  if (streak >= 7) return ImpactStyle.Heavy;
  if (streak >= 3) return ImpactStyle.Medium;
  return ImpactStyle.Light;
}
