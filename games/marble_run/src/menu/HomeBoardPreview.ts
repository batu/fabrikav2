import { BoardEngine } from '../marble-board';
import { LEVELS } from '../levels/levels.generated';
import { BoardScene } from '../three/BoardScene';
import { GAMEPLAY_CAMERA_GROUND_ANGLE_DEG } from '../three/constants';
import { Stage } from '../three/Stage';

/**
 * Home board preview — the tilted wooden board with idle marbles that v1 sugar3d
 * renders between the banner and the saga chain (v1 `App.showMenuDecor` /
 * `tickMenuDecor`). A faithful port, NOT a screenshot: a non-interactive
 * `BoardEngine(LEVELS[2])` on its own three.js `Stage`, framed at 1.42x with the
 * menu view offset, self-animating a marble every few seconds and reseeding when
 * the board empties.
 *
 * Owns its own canvas + Stage + rAF loop so it never fights the Phaser HomeScene
 * lifecycle; `dispose()` tears down the GL context, the resize listener, and the
 * canvas element (mirroring v1's per-board `clearBoard`, plus the v2 dispose
 * seam Stage requires). Tool-shaped: create → runs → dispose; the HomeScene owns
 * when it exists.
 */

/** v1 uses LEVELS[2] as the decorative board. */
const DECOR_LEVEL_INDEX = 2;
/** v1 `App`: menu view offset ratio + decor framing zoom. */
const MENU_VIEW_OFFSET_Y_RATIO = 0.11;
const DECOR_FRAME_ZOOM = 1.42;
/** v1 `DEFAULT_DEBUG_TUNING`: the menu board uses the same ground angle but a
 *  90deg yaw. The preview owns this Stage, so gameplay keeps its 45deg yaw. */
const MENU_CAMERA_YAW_DEG = 90;
/** v1 `tickMenuDecor`: idle a marble roughly every 2.6s. */
const DECOR_MOVE_INTERVAL_S = 2.6;
/** v1 `App.loop`: slow showcase spin on menu screens (`root.rotation.y += dt * 0.12`). */
const DECOR_SPIN_RATE_RAD_S = 0.12;
const MAX_FRAME_DT_S = 0.05;

export class HomeBoardPreview {
  private readonly canvas: HTMLCanvasElement;
  private readonly stage: Stage;
  private engine: BoardEngine | null = null;
  private board: BoardScene | null = null;
  private rafHandle: number | null = null;
  private lastTime = 0;
  private moveTimer = 0;
  private disposed = false;

  /** Mounts the preview canvas into `container` (positioned by CSS via the
   *  supplied class) and starts the idle render loop. */
  constructor(container: HTMLElement, canvasClassName: string) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = canvasClassName;
    this.canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(this.canvas);

    this.stage = new Stage(this.canvas);
    this.stage.setDimetricCamera(GAMEPLAY_CAMERA_GROUND_ANGLE_DEG, MENU_CAMERA_YAW_DEG);
    this.stage.setViewOffsetYRatio(MENU_VIEW_OFFSET_Y_RATIO);
    this.showDecor();

    this.lastTime = performance.now();
    this.rafHandle = requestAnimationFrame(() => this.loop());
  }

  private showDecor(): void {
    const decorLevel = LEVELS[DECOR_LEVEL_INDEX];
    const engine = new BoardEngine(decorLevel);
    this.engine = engine;
    this.board = new BoardScene(engine, {
      onAbsorbed: () => this.board?.refreshGateLiveness(),
      onBlockedImpact: () => {
        // Decorative board is non-interactive.
      },
    });
    this.stage.world.add(this.board.root);
    const { w, d } = this.board.boardSize();
    this.stage.frameBoard(w * DECOR_FRAME_ZOOM, d * DECOR_FRAME_ZOOM);
    this.board.refreshGateLiveness();
  }

  private clearDecor(): void {
    if (this.board !== null) {
      this.stage.world.remove(this.board.root);
      this.board.dispose();
      this.board = null;
    }
    this.engine = null;
  }

  private tickDecor(dt: number): void {
    if (this.engine === null || this.board === null || this.board.isAnimating()) return;
    this.moveTimer += dt;
    if (this.moveTimer < DECOR_MOVE_INTERVAL_S) return;
    this.moveTimer = 0;

    if (this.engine.gameStatus() !== 'playing' || this.engine.remainingCount() === 0) {
      this.clearDecor();
      this.showDecor();
      return;
    }

    const movable = this.engine.movableMarbles();
    if (movable.length === 0) return;
    const choice = movable[Math.floor(Math.random() * movable.length)]!;
    const change = this.engine.tap(choice.cell);
    if (change === null || change.kind !== 'rolled') return;
    this.board.animateChange(change);
    this.board.refreshGateLiveness();
  }

  private loop(): void {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_FRAME_DT_S);
    this.lastTime = now;
    this.board?.tick(dt);
    // v1 App.loop: slow showcase rotation on menu screens.
    if (this.board !== null) this.board.root.rotation.y += dt * DECOR_SPIN_RATE_RAD_S;
    this.tickDecor(dt);
    this.stage.render();
    this.rafHandle = requestAnimationFrame(() => this.loop());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.clearDecor();
    this.stage.dispose();
    this.canvas.remove();
  }
}
