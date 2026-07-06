/**
 * GameController: the self-contained GAMEPLAY half of Marble Run, ported
 * from v1's App orchestrator. Owns the Three.js Stage, the rAF loop,
 * pointer input, the in-game HUD (built as plain DOM in `hudRoot`), the
 * tutorial hand, the decorative menu board, and the win/fail settle timers.
 *
 * The v2 SHELL owns menus, result cards, settings, saga map, music, and the
 * rewarded-ad flow. This controller reports win/fail/pause/fail-save through
 * `GameHooks` and never records progress or mounts shell surfaces itself.
 */
import { createHaptics, ImpactStyle, NotificationType } from '@fabrikav2/sdk/haptics';
import type { GatedHaptics } from '@fabrikav2/sdk/haptics';
import {
  GAMEPLAY_CAMERA_GROUND_ANGLE_DEG,
  GAMEPLAY_CAMERA_YAW_DEG,
  HINT_COIN_COST,
  LEVEL_COIN_REWARD,
  LEVEL_COUNT,
  LONG_PRESS_ROUTE_MS,
  W3D,
} from '../core/Constants';
import { saveState } from '../core/SaveState';
import { BoardEngine } from '../engine/board';
import type { Cell, LevelDef, TapChange } from '../engine/types';
import { LEVELS } from '../levels/levels.generated';
import {
  absorbPlop,
  heartBreak,
  loseSting,
  thud,
  uiTap,
  unlockAudio,
  winFanfare,
} from '../audio/Sfx';
import { BoardScene } from './BoardScene';
import { Stage } from './Stage';

export interface GameHooks {
  /** Fired once when the level is WON (after the win animation settles). The shell records the win, shows the ResultCard, runs the coin-fly, then calls refreshHudCoins(). */
  onWin(info: { levelId: number; reward: number; isFinalLevel: boolean }): void;
  /** Fired once when the level is FAILED (after the fail animation settles). The shell shows the lose ResultCard. */
  onFail(info: { levelId: number }): void;
  /** Fired when the player taps the HUD pause control. The shell drives the flow machine's pause(). */
  onPauseRequested(): void;
  /** Fired when the player taps the HUD "watch ad to continue" affordance on a fail. The shell runs the rewarded-ad flow and returns whether it was granted; if granted, the controller refills hearts and resumes. */
  requestFailSave(): Promise<boolean>;
  /** Rewarded-ad-instead-of-pay for a hint. The shell runs the rewarded-ad flow
   *  and resolves true if the player earned a free hint (skip the coin cost). */
  requestRewardedHint(): Promise<boolean>;
  /** Report a soft-currency spend to the shell (which owns the analytics SDK). */
  onCoinsSpent(amount: number, reason: string): void;
}

type Mode = 'idle' | 'menu' | 'level';

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

export class GameController {
  private readonly canvas: HTMLCanvasElement;
  private readonly hudRoot: HTMLElement;
  private readonly hooks: GameHooks;
  private readonly stage: Stage;
  private readonly haptics: GatedHaptics = createHaptics({ isEnabled: () => saveState.hapticsEnabled });

  private engine: BoardEngine | null = null;
  private board: BoardScene | null = null;
  private levelId = 1;
  private mode: Mode = 'idle';
  private paused = false;
  private inputBlocked = false;
  private consecutiveBlocked = 0;
  private inputReadyAt = 0;
  private lastTime = performance.now();
  private disposed = false;
  private rafId = 0;

  private decorBoard: BoardScene | null = null;
  private decorEngine: BoardEngine | null = null;
  private decorMoveTimer = 0;

  private pendingPointer: PendingPointer | null = null;
  private longPressTimer: number | null = null;
  private failModalTimer: number | null = null;
  private winModalTimer: number | null = null;

  private tutorialEl: HTMLElement | null = null;
  private tutorialCell: Cell | null = null;

  // ── HUD element handles ─────────────────────────────────────────
  private hudEl: HTMLElement | null = null;
  private heartsEl: HTMLElement | null = null;
  private coinAnchorEl: HTMLElement | null = null;
  private coinValueEl: HTMLElement | null = null;
  private hintButtonEl: HTMLButtonElement | null = null;
  private routeBlockedPromptEl: HTMLElement | null = null;
  private failBarEl: HTMLElement | null = null;

  private readonly onPointerDownBound = (e: PointerEvent): void => this.onPointerDown(e);
  private readonly onPointerUpBound = (e: PointerEvent): void => this.onPointerUp(e);
  private readonly onPointerCancelBound = (e: PointerEvent): void => this.onPointerCancel(e);
  private readonly onUnlockAudioBound = (): void => unlockAudio();

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, hooks: GameHooks) {
    this.canvas = canvas;
    this.hudRoot = hudRoot;
    this.hooks = hooks;
    this.stage = new Stage(canvas);
    injectHudStyles();

    canvas.addEventListener('pointerdown', this.onPointerDownBound);
    canvas.addEventListener('pointerup', this.onPointerUpBound);
    canvas.addEventListener('pointercancel', this.onPointerCancelBound);
    canvas.addEventListener('lostpointercapture', this.onPointerCancelBound);
    window.addEventListener('pointerdown', this.onUnlockAudioBound);

    this.rafId = requestAnimationFrame(() => this.loop());
  }

  // ── Public lifecycle ────────────────────────────────────────────

  showMenuScene(): void {
    if (this.mode === 'menu' && this.decorBoard) return;
    this.teardownLevel();
    this.clearDecor();
    this.mode = 'menu';
    this.paused = false;
    // Match the reference menu (near-straight board) and stay consistent with
    // in-level framing: without this the decor board keeps whatever yaw the last
    // level left (or the Stage's 45° default on a cold boot) — a diamond.
    this.stage.setDimetricCamera(GAMEPLAY_CAMERA_GROUND_ANGLE_DEG, GAMEPLAY_CAMERA_YAW_DEG);
    this.stage.setViewOffsetYRatio(0.11);

    const decorLevel = LEVELS[2] ?? LEVELS[0]!;
    const engine = new BoardEngine(decorLevel);
    this.decorEngine = engine;
    this.decorBoard = new BoardScene(engine, {
      onAbsorbed: () => this.decorBoard?.refreshGateLiveness(),
      onBlockedImpact: () => {
        // Decorative board is non-interactive.
      },
    });
    this.stage.world.add(this.decorBoard.root);
    const { w, d } = this.decorBoard.boardSize();
    this.stage.frameBoard(w * 1.42, d * 1.42);
  }

  startLevel(levelId: number): void {
    this.teardownLevel();
    this.clearDecor();
    this.levelId = Math.min(Math.max(levelId, 1), LEVEL_COUNT);
    this.mode = 'level';
    this.paused = false;
    this.inputBlocked = false;
    this.consecutiveBlocked = 0;
    this.stage.setViewOffsetYRatio(0.035);

    this.engine = new BoardEngine(LEVELS[this.levelId - 1]!);
    this.board = new BoardScene(this.engine, {
      onAbsorbed: (change) => this.handleAbsorbed(change),
      onBlockedImpact: (change) => this.handleBlockedImpact(change),
    });
    this.stage.world.add(this.board.root);
    // v1 parity: App.startLevel() applies its debug tuning (yaw 90°) here so the
    // board renders near-top-down and straight. Without it the Stage stays at
    // its 45° constructor default and the square board reads as a floating
    // diamond (P1b). Set the dimetric yaw before framing.
    this.stage.setDimetricCamera(GAMEPLAY_CAMERA_GROUND_ANGLE_DEG, GAMEPLAY_CAMERA_YAW_DEG);
    const { w, d } = this.board.boardSize();
    this.stage.frameBoard(w, d);
    this.board.refreshGateLiveness();

    const spawnDelay = this.engine.remainingCount() * W3D.SPAWN_STAGGER_S * 1000;
    this.inputReadyAt = performance.now() + spawnDelay + 450;

    this.buildHud(this.levelId, this.engine.totalHearts(), saveState.coins);
    this.setHearts(this.engine.hearts());

    if (this.levelId === 1 && saveState.currentLevel() === 1) this.showTutorialHand();
  }

  stopLevel(): void {
    this.teardownLevel();
    this.mode = 'idle';
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  setInputBlocked(blocked: boolean): void {
    this.inputBlocked = blocked;
    if (blocked) this.cancelPendingPointer();
  }

  refreshHudCoins(): void {
    this.setCoins(saveState.coins);
  }

  coinAnchor(): HTMLElement | null {
    return this.coinAnchorEl;
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.canvas.removeEventListener('pointerdown', this.onPointerDownBound);
    this.canvas.removeEventListener('pointerup', this.onPointerUpBound);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancelBound);
    this.canvas.removeEventListener('lostpointercapture', this.onPointerCancelBound);
    window.removeEventListener('pointerdown', this.onUnlockAudioBound);
    this.teardownLevel();
    this.clearDecor();
  }

  // ── Win / fail continue (fail-save refill) ──────────────────────

  /** Refill hearts + resume after a granted rewarded-ad save. Returns false if there is no active level. Ported from v1 App.saveFailedRun's granted branch. */
  applyFailSave(): boolean {
    if (!this.engine || !this.board) return false;
    const engine = this.engine;
    const board = this.board;
    if (!engine.continueAfterFail(engine.totalHearts())) return false;
    this.removeFailBar();
    this.paused = false;
    this.inputBlocked = false;
    this.consecutiveBlocked = 0;
    this.inputReadyAt = performance.now();
    this.setHearts(engine.hearts());
    board.refreshGateLiveness();
    const movable = engine.movableMarbles();
    if (movable.length > 0) {
      const preview = engine.previewTap(movable[0]!.cell);
      if (preview) board.showRoutePreview(preview);
    }
    this.haptics.notification(NotificationType.Success);
    this.hapticImpact(ImpactStyle.Medium, 70);
    return true;
  }

  // ── Input ───────────────────────────────────────────────────────

  private onPointerDown(e: PointerEvent): void {
    if (this.mode !== 'level' || this.paused || this.inputBlocked) return;
    if (!this.engine || !this.board) return;
    if (performance.now() < this.inputReadyAt) return;
    e.preventDefault();
    if (this.pendingPointer) return;
    this.hideRouteBlockedPrompt();
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
        this.hideRouteBlockedPrompt();
        this.board.showRoutePreview(preview);
      } else {
        this.board.showBlockedRoutePreview(this.pendingPointer.holdCell);
        this.showRouteBlockedPrompt();
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
    this.hideRouteBlockedPrompt();
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
    if (this.paused || this.inputBlocked) return null;
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
      this.popStreak(change.streak);
    } else {
      this.consecutiveBlocked += 1;
      if (this.consecutiveBlocked >= 2 && !change.failed) {
        window.setTimeout(() => {
          if (!this.engine || !this.board) return;
          if (this.engine.gameStatus() !== 'playing') return;
          const movable = this.engine.movableMarbles();
          if (movable.length > 0) this.board.pulseHint(movable[0]!.cell);
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
    this.setHearts(change.heartsLeft);
    if (change.failed) {
      const failedEngine = this.engine;
      const failedBoard = this.board;
      const failedLevel = this.levelId;
      this.clearFailModalTimer();
      this.failModalTimer = window.setTimeout(() => {
        this.failModalTimer = null;
        if (this.mode !== 'level') return;
        if (this.engine !== failedEngine || this.board !== failedBoard || this.levelId !== failedLevel) return;
        if (this.engine.gameStatus() !== 'failed') return;
        this.settleFail();
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
        if (this.mode !== 'level') return;
        if (this.engine !== absorbedEngine || this.board !== absorbedBoard || this.levelId !== wonLevel) return;
        if (this.engine.gameStatus() !== 'won') return;
        this.settleWin();
      }, 300);
    }
  }

  /** WIN settle: play juice + haptics, then hand off to the shell. Does NOT record the win or mount any screen (the shell owns that). */
  private settleWin(): void {
    if (!this.engine) return;
    winFanfare();
    this.haptics.notification(NotificationType.Success);
    this.hapticImpact(ImpactStyle.Medium, 85);
    this.hooks.onWin({
      levelId: this.levelId,
      reward: LEVEL_COIN_REWARD,
      isFinalLevel: this.levelId >= LEVEL_COUNT,
    });
  }

  /** FAIL settle: play sting + haptics, offer the in-HUD "watch ad" affordance, then hand off to the shell. */
  private settleFail(): void {
    loseSting();
    this.haptics.notification(NotificationType.Error);
    this.showFailBar();
    this.hooks.onFail({ levelId: this.levelId });
  }

  async showHint(): Promise<void> {
    if (!this.engine || !this.board) return;
    if (this.engine.gameStatus() !== 'playing') return;
    if (this.board.hasRoutePreview()) return;
    const movable = this.engine.movableMarbles();
    if (movable.length === 0) return;
    const preview = this.engine.previewTap(movable[0]!.cell);
    if (!preview) return;

    // Rewarded-ad-instead-of-pay: watching a rewarded ad grants the hint for
    // free. On web/CI the ad provider is disabled → granted:false → the coin
    // path runs unchanged. Re-guard after the await (the modal ad may have
    // ended the level or disposed the controller).
    const rewarded = await this.hooks.requestRewardedHint();
    if (this.disposed || !this.engine || !this.board) return;
    if (this.engine.gameStatus() !== 'playing') return;
    if (this.board.hasRoutePreview()) return;

    if (!rewarded) {
      if (!saveState.spendCoins(HINT_COIN_COST)) {
        this.hapticImpact(ImpactStyle.Light);
        return;
      }
      this.hooks.onCoinsSpent(HINT_COIN_COST, 'hint');
      this.setCoins(saveState.coins);
    }
    this.board.showRoutePreview(preview);
    this.hapticImpact(ImpactStyle.Light);
  }

  private showTutorialHand(): void {
    if (!this.engine || !this.board) return;
    const movable = this.engine.movableMarbles();
    if (movable.length === 0) return;
    const target = movable[0]!.cell;
    const point = this.cellClientPoint(target);
    if (!point) return;
    this.tutorialCell = target;
    this.tutorialEl?.remove();
    this.tutorialEl = this.mountTutorialHand(point);
    const preview = this.engine.previewTap(target);
    if (preview) this.board.showRoutePreview(preview);
  }

  private pulseTutorial(): void {
    if (!this.tutorialEl) return;
    this.tutorialEl.classList.remove('mr-tutorial-reject');
    void this.tutorialEl.offsetWidth;
    this.tutorialEl.classList.add('mr-tutorial-reject');
    window.setTimeout(() => this.tutorialEl?.classList.remove('mr-tutorial-reject'), 420);
  }

  // ── Loop ────────────────────────────────────────────────────────

  private loop(): void {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    if (!this.paused) {
      this.board?.tick(dt);
      this.decorBoard?.tick(dt);
      // The decor board stays LOCKED at the yaw showMenuScene() set (near-straight,
      // matching the reference menu). No continuous spin — a rotating board clashes
      // with the static saga rail overlaid on the menu. See the diff report
      // (docs/evidence/2026-07-06-rigorous-diff): reference menu board is static.
      this.tickMenuDecor(dt);
    }
    this.stage.render();
    this.rafId = requestAnimationFrame(() => this.loop());
  }

  private tickMenuDecor(dt: number): void {
    if (this.mode !== 'menu' || !this.decorEngine || !this.decorBoard) return;
    if (this.decorBoard.isAnimating()) return;
    this.decorMoveTimer += dt;
    if (this.decorMoveTimer < 2.6) return;
    this.decorMoveTimer = 0;

    if (this.decorEngine.gameStatus() !== 'playing' || this.decorEngine.remainingCount() === 0) {
      this.clearDecor();
      this.mode = 'idle';
      this.showMenuScene();
      return;
    }

    const movable = this.decorEngine.movableMarbles();
    if (movable.length === 0) return;
    const choice = movable[Math.floor(Math.random() * movable.length)]!;
    const change = this.decorEngine.tap(choice.cell);
    if (!change || change.kind !== 'rolled') return;
    this.decorBoard.animateChange(change);
    this.decorBoard.refreshGateLiveness();
  }

  // ── Teardown helpers ────────────────────────────────────────────

  private teardownLevel(): void {
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
    this.clearHud();
  }

  private clearDecor(): void {
    if (this.decorBoard) {
      this.stage.world.remove(this.decorBoard.root);
      this.decorBoard.dispose();
      this.decorBoard = null;
    }
    this.decorEngine = null;
    this.decorMoveTimer = 0;
  }

  // ── HUD (plain DOM in hudRoot) ──────────────────────────────────

  private buildHud(levelId: number, hearts: number, coins: number): void {
    this.clearHud();
    const canAffordHint = coins >= HINT_COIN_COST;
    const heartSpans = Array.from({ length: hearts }, () => '<span>❤</span>').join('');
    // Reference in-level chrome (refs/.../level-start.png): hearts panel TL,
    // gear TR, coin pill BL, square HINT+cost BR. Free-canvas (this is the
    // gameplay half) but every color resolves through the game's design tokens
    // (--fab-color-chrome-* / surface / panel), so a reskin re-themes it.
    void levelId;
    const el = document.createElement('div');
    el.className = 'mr-hud';
    el.innerHTML = `
      <div class="mr-hearts-panel mr-hud-panel" data-r="hearts">${heartSpans}</div>
      <button class="mr-gear-btn mr-hud-panel" data-a="pause" type="button" aria-label="Pause">⚙</button>
      <div class="mr-coin mr-hud-panel" data-r="coin"><span class="mr-coin-glyph">🪙</span><span class="mr-coin-value">${coins}</span></div>
      <button class="mr-hint mr-hud-tile" data-a="hint" type="button" aria-label="Hint costs ${HINT_COIN_COST} coins"${canAffordHint ? '' : ' disabled'}>
        <span class="mr-hint-label">HINT</span><span class="mr-hint-cost">🪙 ${HINT_COIN_COST}</span>
      </button>
    `;
    this.hudRoot.appendChild(el);
    this.hudEl = el;
    this.heartsEl = el.querySelector('[data-r=hearts]');
    this.coinAnchorEl = el.querySelector('[data-r=coin]');
    this.coinValueEl = el.querySelector('.mr-coin-value');
    this.hintButtonEl = el.querySelector('[data-a=hint]');
    el.querySelector('[data-a=pause]')!.addEventListener('click', () => {
      uiTap();
      this.hooks.onPauseRequested();
    });
    el.querySelector('[data-a=hint]')!.addEventListener('click', () => {
      uiTap();
      void this.showHint();
    });
  }

  private clearHud(): void {
    this.removeFailBar();
    this.routeBlockedPromptEl?.remove();
    this.routeBlockedPromptEl = null;
    this.hudEl?.remove();
    this.hudEl = null;
    this.heartsEl = null;
    this.coinAnchorEl = null;
    this.coinValueEl = null;
    this.hintButtonEl = null;
  }

  private setHearts(left: number): void {
    if (!this.heartsEl) return;
    Array.from(this.heartsEl.children).forEach((c, i) => {
      c.classList.toggle('dead', i >= left);
    });
  }

  private setCoins(coins: number): void {
    if (this.coinValueEl) this.coinValueEl.textContent = String(coins);
    if (this.hintButtonEl) this.hintButtonEl.disabled = coins < HINT_COIN_COST;
  }

  private popStreak(streak: number): void {
    if (streak < 3 || !this.hudEl) return;
    const el = document.createElement('div');
    el.className = 'mr-streak';
    el.textContent = `${comboPhrase(streak)} x${streak}`;
    this.hudEl.appendChild(el);
    window.setTimeout(() => el.remove(), 1300);
  }

  private showRouteBlockedPrompt(): void {
    if (!this.hudEl) return;
    this.hideRouteBlockedPrompt();
    const el = document.createElement('div');
    el.className = 'mr-route-blocked';
    el.textContent = 'route blocked';
    this.hudEl.appendChild(el);
    this.routeBlockedPromptEl = el;
  }

  private hideRouteBlockedPrompt(): void {
    this.routeBlockedPromptEl?.remove();
    this.routeBlockedPromptEl = null;
  }

  private mountTutorialHand(point: { x: number; y: number }): HTMLElement | null {
    if (!this.hudEl) return null;
    const el = document.createElement('div');
    el.className = 'mr-tutorial';
    el.style.setProperty('--tx', `${point.x}px`);
    el.style.setProperty('--ty', `${point.y}px`);
    el.innerHTML = `<div class="mr-tutorial-ring"></div><div class="mr-tutorial-hand" aria-hidden="true">👆</div>`;
    this.hudEl.appendChild(el);
    return el;
  }

  private showFailBar(): void {
    if (!this.hudEl) return;
    this.removeFailBar();
    const el = document.createElement('div');
    el.className = 'mr-failbar';
    el.innerHTML = `
      <span>No hearts left!</span>
      <button class="mr-failsave" data-a="failsave" type="button">Watch ad to continue</button>
    `;
    this.hudEl.appendChild(el);
    this.failBarEl = el;
    const button = el.querySelector<HTMLButtonElement>('[data-a=failsave]')!;
    button.addEventListener('click', () => {
      uiTap();
      this.setSaveLoading(true);
      void this.hooks.requestFailSave().then((granted) => {
        this.setSaveLoading(false);
        if (granted) this.applyFailSave();
      });
    });
  }

  private setSaveLoading(loading: boolean): void {
    const button = this.failBarEl?.querySelector<HTMLButtonElement>('[data-a=failsave]');
    if (!button) return;
    button.disabled = loading;
    button.classList.toggle('is-loading', loading);
    button.textContent = loading ? 'Loading…' : 'Watch ad to continue';
  }

  private removeFailBar(): void {
    this.failBarEl?.remove();
    this.failBarEl = null;
  }

  // ── Haptics (self-gated via createHaptics) ──────────────────────

  private hapticImpact(style: ImpactStyle, delayMs = 0): void {
    if (delayMs <= 0) {
      this.haptics.impact(style);
      return;
    }
    window.setTimeout(() => this.haptics.impact(style), delayMs);
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

  // ── Harness surface ─────────────────────────────────────────────

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
      unlocked: saveState.unlocked,
      coins: saveState.coins,
      routePreviewVisible: this.board?.hasRoutePreview() ?? false,
      paused: this.paused,
      tutorialTarget: this.tutorialCell,
      activeGateColors: this.board?.activeGateColors() ?? [],
      activeGatePrimaryHexes: this.board?.activeGatePrimaryHexes() ?? {},
    };
  }

  engineRef(): BoardEngine | null {
    return this.engine;
  }

  /** The active level definition (for solver-bound auto-play). */
  currentLevelDef(): LevelDef | null {
    return LEVELS[this.levelId - 1] ?? null;
  }

  cellClientPoint(cell: Cell): { x: number; y: number } | null {
    if (!this.board) return null;
    const local = this.board.cellToWorld(cell, 0.15 + W3D.MARBLE_R);
    const world = this.board.root.localToWorld(local);
    return this.stage.worldToClient(world);
  }

  setAnimationSpeed(multiplier: number): void {
    this.board?.setAnimationSpeed(multiplier);
    this.decorBoard?.setAnimationSpeed(multiplier);
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

function comboPhrase(streak: number): string {
  if (streak >= 60) return 'Unstoppable!';
  if (streak >= 40) return 'Spectacular!';
  if (streak >= 20) return 'Unstoppable!';
  if (streak >= 10) return 'Amazing!';
  if (streak >= 7) return 'Smooth!';
  if (streak >= 5) return 'Great!';
  return 'Nice!';
}

const HUD_STYLE_ID = 'mr-game-hud-styles';

/** Minimal functional HUD styling; visual polish is a later stage. */
function injectHudStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(HUD_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HUD_STYLE_ID;
  style.textContent = `
    .mr-hud { position:absolute; inset:0; pointer-events:none; font-family:var(--fab-font-family,'Nunito',system-ui,sans-serif); z-index:5; }
    .mr-hud button { pointer-events:auto; cursor:pointer; }
    /* Teal candy panel shared by hearts / gear / coin (chrome tokens). */
    .mr-hud-panel { position:absolute; border:3px solid var(--fab-color-chrome-teal-border,#fff);
      background:linear-gradient(180deg,var(--fab-color-chrome-teal-top,#6fdcff),var(--fab-color-chrome-teal-bottom,#23a7db));
      box-shadow:0 4px 0 var(--fab-color-chrome-teal-shadow,#1c7fb0),inset 0 2px 0 rgba(255,255,255,.35);
      color:var(--fab-color-chrome-ink,#fff); }
    /* Top HUD panels clear the iOS status-bar zone via --fab-safe-top (0 off-device). */
    .mr-hearts-panel { top:calc(16px + var(--fab-safe-top,0px)); left:16px; display:flex; align-items:center; gap:5px; padding:9px 15px; border-radius:18px; }
    .mr-hearts-panel span { font-size:24px; line-height:1; color:var(--fab-color-heart,#ff5d6c); transition:opacity .2s,transform .2s,filter .2s; filter:drop-shadow(0 1px 1px rgba(0,0,0,.25)); }
    .mr-hearts-panel span.dead { opacity:.28; transform:scale(.8); filter:grayscale(1); }
    .mr-gear-btn { top:calc(16px + var(--fab-safe-top,0px)); right:16px; width:56px; height:56px; padding:0; display:grid; place-items:center; border-radius:16px; font-size:28px; line-height:1; }
    .mr-coin { bottom:22px; left:16px; display:flex; align-items:center; gap:6px; padding:8px 16px 8px 10px; border-radius:999px; font-weight:900; font-size:18px; }
    .mr-coin-glyph { font-size:20px; }
    .mr-coin-value { color:var(--fab-color-chrome-ink,#fff); text-shadow:0 1px 2px rgba(0,0,0,.25); }
    /* Square HINT tile BR — cream candy panel (surface + panel tokens). */
    .mr-hud-tile { position:absolute; bottom:22px; right:16px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;
      width:96px; height:82px; border:3px solid var(--fab-color-panel-border,#c87845); border-radius:20px;
      background:var(--fab-color-surface,#fff3d7); box-shadow:0 4px 0 var(--fab-color-panel-shadow,#8d4a29),inset 0 2px 0 rgba(255,255,255,.5);
      color:var(--fab-color-text,#6a3016); }
    .mr-hint-label { font-weight:900; font-size:18px; letter-spacing:.06em; }
    .mr-hint:disabled { opacity:.5; }
    .mr-hint-cost { font-size:13px; font-weight:800; opacity:.92; }
    .mr-streak { position:absolute; top:40%; left:50%; transform:translate(-50%,-50%); color:#fff; font-weight:900; font-size:34px; text-shadow:0 3px 12px rgba(0,0,0,.5); pointer-events:none; animation:mr-streak-pop 1.3s ease-out forwards; }
    @keyframes mr-streak-pop { 0%{opacity:0;transform:translate(-50%,-40%) scale(.6);} 15%{opacity:1;transform:translate(-50%,-50%) scale(1.15);} 30%{transform:translate(-50%,-50%) scale(1);} 80%{opacity:1;} 100%{opacity:0;transform:translate(-50%,-70%) scale(1);} }
    .mr-route-blocked { position:absolute; bottom:96px; left:50%; transform:translateX(-50%); background:rgba(255,77,109,.92); color:#fff; font-weight:800; font-size:13px; letter-spacing:.5px; padding:7px 16px; border-radius:999px; pointer-events:none; }
    .mr-tutorial { position:absolute; left:0; top:0; pointer-events:none; }
    .mr-tutorial-ring { position:absolute; left:var(--tx); top:var(--ty); width:64px; height:64px; margin:-32px 0 0 -32px; border:3px solid rgba(255,255,255,.85); border-radius:50%; animation:mr-tut-ring 1.4s ease-out infinite; }
    @keyframes mr-tut-ring { 0%{transform:scale(.5);opacity:.9;} 100%{transform:scale(1.3);opacity:0;} }
    .mr-tutorial-hand { position:absolute; left:var(--tx); top:var(--ty); font-size:38px; margin:6px 0 0 6px; animation:mr-tut-hand 1.4s ease-in-out infinite; }
    @keyframes mr-tut-hand { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-10px);} }
    .mr-tutorial.mr-tutorial-reject { animation:mr-tut-reject .42s ease; }
    @keyframes mr-tut-reject { 0%,100%{transform:translateX(0);} 25%{transform:translateX(-8px);} 75%{transform:translateX(8px);} }
    .mr-failbar { position:absolute; left:50%; bottom:26px; transform:translateX(-50%); display:flex; flex-direction:column; align-items:center; gap:8px; color:#fff; font-weight:800; text-align:center; }
    .mr-failsave { border:0; border-radius:16px; padding:12px 22px; background:#44d164; color:#fff; font-weight:800; font-size:16px; box-shadow:0 6px 16px rgba(0,0,0,.3); }
    .mr-failsave.is-loading { opacity:.7; }
  `;
  document.head.appendChild(style);
}
