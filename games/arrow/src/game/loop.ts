/**
 * Game loop — animation tick + input dispatch for the polyline model.
 *
 * Frame responsibilities:
 *   - forward pointerdown to the tap handler (cellIndex → arrow →
 *     slitherOutcome → mutate state)
 *   - drive active SlitherAnims that visually walk the arrow body
 *     along pathAhead, so exits slither off and collisions grow-and-
 *     stop instead of teleporting
 *   - tick title card / tutorial / end-screen / fx
 *   - render the board
 */

import { applyTap, FAIL_PERSIST_MS, loadLevel, type GameState, type LevelSpec } from "./state.js";
import { cellOwner } from "./path.js";
import { applyZoom, clear, computeViewport, drawArrows, drawCollideVignette, drawGhostArrows, drawGridDots, hitTest, type RenderStyle, type ViewportGeometry } from "./render.js";
import { drawHud, hitHudButton, type HudButton, type HudInputState } from "./hud.js";
import { Confetti } from "./fx/confetti.js";
import { Dissolve } from "./fx/dissolve.js";
import { HintGlow } from "./fx/hint-glow.js";
import { TapRipple } from "./fx/tap-ripple.js";
import { ExitGhost } from "./fx/exit-ghost.js";
import { History } from "./history.js";
import { AudioCues } from "./audio.js";
import { TitleCard } from "./title-card.js";
import { TutorialOverlay } from "./tutorial.js";
import { haptic } from "./haptics.js";
import { findLegalArrow } from "./hint.js";
import { EndScreen } from "./end-screen.js";
import { Menu } from "./menu.js";
import { PACKS } from "./levels-data.js";
import { totalCompleted, type Progress } from "./persist.js";
import { elapsedSeconds, newSessionStats, recordClear, recordTap, type SessionStats } from "./session-stats.js";
import { PATH_DIR_VEC } from "./path.js";
import { animDone, makeAnim, tickAnim, type AnimFrame, type SlitherAnim } from "./slither-anim.js";
import { RANGES, STEPS, setKnob, toAnimConfig, type JuiceSettings } from "./juice.js";
import { JUICE_KNOB_SPECS } from "./hud.js";

export interface LoopDeps {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  state: GameState;
  style: RenderStyle;
  onLevelComplete: () => void;
  onLevelFailed: () => void;
  onRestart: () => void;
  /** Called when a level-grid tile is tapped. flatIndex is 1-based into
   *  RECIPES. Caller should getLevel + loadLevel. */
  onSelectLevel: (flatIndex: number) => void;
  getActiveLevel: () => LevelSpec | null;
  firstRun: boolean;
  onTutorialDone: () => void;
  totalLevels: number;
  isLastLevel: () => boolean;
  getProgress: () => Progress;
  onFullCompletion: (elapsedSec: number) => void;
  onSettingsRequested?: () => void;
  useShellResults?: boolean;
  /** Called when the in-game juice tuning UI changes a knob.
   *  Caller persists the new juice to progress and storage. */
  onJuiceChange: (juice: JuiceSettings) => void;
}

const COLLIDE_FLASH_MS = 450;

/** A pack is unlocked once the preceding pack is complete (indices.length
 *  cleared). Pack 0 (tutorial) is always unlocked. */
function highestUnlockedPackIdx(packProgress: Record<string, number>): number {
  let idx = 0;
  for (let i = 0; i < PACKS.length; i++) {
    if (i === 0) continue;
    const prev = PACKS[i - 1]!;
    if ((packProgress[prev.slug] ?? 0) >= prev.indices.length) idx = i;
    else break;
  }
  return idx;
}

export function runLoop(deps: LoopDeps): () => void {
  const { canvas, ctx, state, style } = deps;
  let raf = 0;
  let last = performance.now();
  const confetti = new Confetti();
  const dissolve = new Dissolve();
  const hintGlow = new HintGlow();
  const tapRipple = new TapRipple();
  const exitGhost = new ExitGhost();
  const history = new History();
  const audio = new AudioCues();
  const titleCard = new TitleCard();
  const tutorial = new TutorialOverlay();
  const endScreen = new EndScreen();
  const menu = new Menu();
  const stats: SessionStats = newSessionStats();
  let lastStatus: GameState["status"] = state.status;
  let lastLevel = state.level;
  let sheetOpen = false;
  let juiceSheetOpen = false;
  let wonAt = 0;
  let collisionFlashT = 0;
  // Pinch-to-zoom state. Two-finger gesture scales the board viewport
  // (not the HUD). Clamped so the entire board remains on-screen —
  // pan is a follow-up card. Resets on level-load to avoid carrying a
  // previous level's zoom into a different-sized grid.
  const ZOOM_MIN = 1.0;
  const ZOOM_MAX = 1.5;
  let zoom = 1.0;
  // Thin shim over the extracted `applyZoom` helper so existing call
  // sites in this file keep their `(vp, cols, rows)` signature and
  // pick up the current closure-scoped `zoom` value automatically.
  const withZoom = (vp: ViewportGeometry, cols: number, rows: number): ViewportGeometry =>
    applyZoom(vp, cols, rows, zoom);
  let pinchStartDist = 0;
  let pinchStartZoom = 1.0;
  const activeTouches = new Map<number, { x: number; y: number }>();
  let pinching = false;
  const anims: SlitherAnim[] = [];
  const MIN_WIN_HOLD_MS = 900;
  const WIN_AUTO_ADVANCE_MS = 2400;
  history.markInitial(state);
  const showTitleCard = (): void => {
    const active = deps.getActiveLevel();
    const pt = active?.pack ? active.pack.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") : "";
    titleCard.show(
      state.level,
      deps.totalLevels,
      totalCompleted(deps.getProgress()),
      pt,
      active?.indexInPack ?? 0,
    );
  };
  showTitleCard();
  if (deps.firstRun && state.level === 1) tutorial.enable();

  const handleJuiceTap = (id: string): void => {
    const juice = deps.getProgress().juice;
    const clamp = (n: number, key: keyof typeof RANGES): number => {
      const r = RANGES[key];
      return n < r.min ? r.min : n > r.max ? r.max : n;
    };
    // Match id against the knob-spec table so adding a knob means only
    // appending to JUICE_KNOB_SPECS + STEPS, not editing this switch.
    for (const spec of JUICE_KNOB_SPECS) {
      const dir = id === `juice-${spec.row}-minus` ? -1 : id === `juice-${spec.row}-plus` ? 1 : 0;
      if (dir === 0) continue;
      const step = STEPS[spec.key];
      const next = setKnob(juice, spec.key, clamp(juice[spec.key] + dir * step, spec.key));
      deps.onJuiceChange(next);
      return;
    }
  };

  const onPointerDownSafe = (ev: PointerEvent) => {
    try {
      onPointerDown(ev);
    } catch (err) {
      console.error("[arrow] onPointerDown failed:", err);
    }
  };

  const onPointerDown = (ev: PointerEvent) => {
    if (pinching) return;
    audio.init();

    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;

    // Menu overlay consumes all input when open.
    if (menu.isOpen) {
      const progress = deps.getProgress();
      const hit = menu.onTap(px, py, cssW, cssH, PACKS, progress.packProgress, highestUnlockedPackIdx(progress.packProgress));
      if (hit?.kind === "level" && hit.levelIndex !== undefined) {
        menu.close();
        deps.onSelectLevel(hit.levelIndex);
      }
      return;
    }

    tapRipple.spawn(px, py);

    if (endScreen.consumesInput) {
      endScreen.hide();
      deps.onRestart();
      return;
    }
    if (titleCard.consumesInput) {
      titleCard.dismiss();
      return;
    }

    const hudBtn: HudButton | null = hitHudButton(px, py, cssW, cssH, sheetOpen, juiceSheetOpen);
    if (hudBtn === "gear") {
      if (deps.onSettingsRequested) deps.onSettingsRequested();
      else sheetOpen = true;
      return;
    }
    if (hudBtn === "sheet-close") { sheetOpen = false; return; }
    if (hudBtn === "sheet-undo") { history.undo(state); sheetOpen = false; return; }
    if (hudBtn === "sheet-reset") { history.reset(state); sheetOpen = false; return; }
    if (hudBtn === "sheet-mute") { audio.setMuted(!audio.isMuted); return; }
    if (hudBtn === "sheet-juice") { sheetOpen = false; juiceSheetOpen = true; return; }
    if (hudBtn === "sheet-hint") {
      const legal = findLegalArrow(state.grid);
      if (legal) {
        const vp = withZoom(computeViewport(state.grid, cssW, cssH), state.grid.cols, state.grid.rows);
        hintGlow.show(legal.x, legal.y, vp.gx, vp.gy, vp.cell);
      }
      sheetOpen = false;
      return;
    }
    if (hudBtn === "sheet-restart") { deps.onRestart(); sheetOpen = false; return; }
    if (hudBtn === "sheet-packs") { sheetOpen = false; menu.open(); return; }
    // Juice sub-sheet controls.
    if (hudBtn === "juice-close") { juiceSheetOpen = false; return; }
    if (hudBtn && hudBtn.startsWith("juice-")) {
      handleJuiceTap(hudBtn);
      return;
    }
    if (sheetOpen || juiceSheetOpen) return;

    if (state.status === "lost") {
      const lvl = deps.getActiveLevel();
      if (lvl) {
        loadLevel(state, lvl);
        history.markInitial(state);
        titleCard.show(state.level);
      }
      return;
    }
    if (state.status === "won") {
      if (performance.now() - wonAt < MIN_WIN_HOLD_MS) return;
      deps.onLevelComplete();
      return;
    }

    const vp = withZoom(computeViewport(state.grid, cssW, cssH), state.grid.cols, state.grid.rows);
    const cell = hitTest(vp, state.grid, px, py);
    if (!cell) return;

    // Peek-first: only push history + end tutorial for taps that will
    // actually mutate state. Tapping an empty cell must not consume an
    // undo slot.
    const ownerId = cellOwner(state.grid, cell.x, cell.y);
    if (ownerId === null) return;
    const originalArrow = state.grid.arrows.get(ownerId);
    if (!originalArrow) return;
    const originalCells = originalArrow.cells; // snapshot before clear
    if (tutorial.enabled) {
      tutorial.disable();
      deps.onTutorialDone();
    }
    history.push(state);
    const res = applyTap(state, cell.x, cell.y);
    if (!res) return;
    // Read live juice from progress so JUICE-4's settings UI can drive
    // the anim without touching this spawn path.
    anims.push(
      makeAnim(
        res.arrowId,
        res.blocked ? "collide" : "exit",
        originalCells,
        res.pathAhead,
        toAnimConfig(deps.getProgress().juice),
      ),
    );
    if (res.blocked) {
      // Lives/state transitions commit at tap time, but audio + haptic
      // + visual feedback fire at the impact moment (see frame.impact
      // JustHappened handling in the tick block) so they sync to the
      // head's visual arrival at the collision cell.
      recordTap(stats, true);
      if (res.failed) deps.onLevelFailed();
      return;
    }
    recordTap(stats, false);
    audio.play("pop");
    void haptic("tap");
    const { dx, dy } = PATH_DIR_VEC[res.headDir];
    dissolve.spawn(
      vp.gx + res.head.x * vp.cell + vp.cell / 2,
      vp.gy + res.head.y * vp.cell + vp.cell / 2,
      dx,
      dy,
      style.ink,
    );
  };

  canvas.addEventListener("pointerdown", onPointerDownSafe);

  // Pinch-to-zoom via TouchEvent API (pointer events don't expose a
  // cheap "how many fingers down" count). Single-finger taps still go
  // through pointerdown; two-finger gestures set `pinching` which
  // short-circuits tap handling for the duration.
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.hypot(dx, dy);
  };
  const onTouchStart = (ev: TouchEvent): void => {
    for (const t of Array.from(ev.changedTouches)) {
      activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (activeTouches.size === 2) {
      const [a, b] = Array.from(activeTouches.values());
      pinchStartDist = dist(a!, b!);
      pinchStartZoom = zoom;
      pinching = true;
      ev.preventDefault();
    }
  };
  const onTouchMove = (ev: TouchEvent): void => {
    for (const t of Array.from(ev.changedTouches)) {
      if (activeTouches.has(t.identifier)) {
        activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
    if (activeTouches.size === 2 && pinchStartDist > 0) {
      const [a, b] = Array.from(activeTouches.values());
      const curDist = dist(a!, b!);
      const ratio = curDist / pinchStartDist;
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinchStartZoom * ratio));
      zoom = next;
      ev.preventDefault();
    }
  };
  const onTouchEnd = (ev: TouchEvent): void => {
    for (const t of Array.from(ev.changedTouches)) {
      activeTouches.delete(t.identifier);
    }
    if (activeTouches.size < 2) {
      pinchStartDist = 0;
      // Keep `pinching` true for a short tail so the lingering tap from
      // the lifted finger doesn't register as a real tap.
      setTimeout(() => { if (activeTouches.size < 2) pinching = false; }, 80);
    }
  };
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd);
  canvas.addEventListener("touchcancel", onTouchEnd);

  const tick = (now: number) => {
    const dt = Math.min(64, now - last);
    last = now;

    if (state.status === "won" && lastStatus !== "won") {
      recordClear(stats);
      const dpr = window.devicePixelRatio || 1;
      confetti.burst(canvas.width / dpr, canvas.height / dpr, [style.ink, style.lavender, style.accentSoft]);
      audio.play("chime");
      void haptic("level-complete");
      wonAt = now;
      if (deps.isLastLevel() && !deps.useShellResults) {
        endScreen.show();
        deps.onFullCompletion(elapsedSeconds(stats));
      }
    }
    if (
      state.status === "won" &&
      !endScreen.visible &&
      now - wonAt >= WIN_AUTO_ADVANCE_MS
    ) {
      deps.onLevelComplete();
    }
    if (state.level !== lastLevel) {
      history.markInitial(state);
      showTitleCard();
      lastLevel = state.level;
      zoom = 1.0; // reset pinch-zoom on level change
    }
    lastStatus = state.status;

    titleCard.tick(dt);
    tutorial.tick(dt);
    confetti.tick(dt);
    dissolve.tick(dt);
    hintGlow.tick(dt);
    tapRipple.tick(dt);
    exitGhost.tick(dt);
    endScreen.tick(dt);

    if (collisionFlashT > 0) {
      collisionFlashT = Math.max(0, collisionFlashT - dt);
      if (collisionFlashT === 0) state.collisionCell = null;
    }
    if (state.failingT > 0) {
      state.failingT = Math.max(0, state.failingT - dt);
      if (state.failingT === 0) state.failingArrowId = null;
    }

    // Advance and compact slither anims. Each surviving anim emits an
    // AnimFrame with interpolated head, shake, alpha, and bodyPull.
    // drawGhostArrows consumes these directly.
    const ghostFrames: AnimFrame[] = [];
    {
      let w = 0;
      for (let r = 0; r < anims.length; r++) {
        const a = anims[r]!;
        const frame = tickAnim(a, dt);
        // Visual impact moment for collide anims — fire the collision
        // feedback (vignette, flash disc, persistent red) in sync with
        // the head's arrival at the collision cell rather than at tap
        // time.
        if (frame.impactJustHappened && a.kind === "collide") {
          const collisionCell = a.pathAhead[a.pathAhead.length - 1];
          if (collisionCell) {
            state.collisionCell = collisionCell;
            state.failingArrowId = a.id;
            state.failingT = FAIL_PERSIST_MS;
            collisionFlashT = COLLIDE_FLASH_MS;
            audio.play("thud");
            void haptic("collide");
          }
        }
        if (!animDone(a)) {
          ghostFrames.push(frame);
          anims[w++] = a;
        } else if (a.kind === "exit" && frame.bodyCells.length >= 2) {
          // Capture the final non-empty exit frame as a lavender echo
          // ghost — persists ~200ms past the edge to soften the 'pop'
          // of exit completion.
          exitGhost.spawn([...frame.bodyCells, frame.head.cell], frame.headFacing);
        }
      }
      anims.length = w;
    }
    // Arrow ids whose ghost is live this frame — drawArrows skips them
    // so a collide hold doesn't double-render the static arrow under
    // the animating ghost.
    const hiddenIds = new Set<number>();
    for (const a of anims) hiddenIds.add(a.id);

    // Flash alpha pulse: fade-in over first 20%, double-peak via sin
    // across the hold, fade-out tail. Static 0.55 when juice disabled.
    const juice = deps.getProgress().juice;
    let flashAlpha = 0;
    if (state.collisionCell && collisionFlashT > 0) {
      if (juice.redFlashPulse) {
        const remaining = collisionFlashT / COLLIDE_FLASH_MS;
        flashAlpha = 0.35 + 0.35 * Math.abs(Math.sin(remaining * Math.PI * 3));
      } else {
        flashAlpha = 0.55;
      }
    }

    // Failing arrow info: fade lerp from error → ink as t decays.
    // alpha=1 (full red) when t is fresh, alpha=0 (full ink) at t=0.
    const failing = state.failingArrowId !== null && state.failingT > 0
      ? { id: state.failingArrowId, alpha: state.failingT / 2000 }
      : null;

    render(ctx, canvas, state, style, ghostFrames, exitGhost, confetti, dissolve, hintGlow, tapRipple, {
      canUndo: history.canUndo,
      muted: audio.isMuted,
      sheetOpen,
      juiceSheetOpen,
      juice: deps.getProgress().juice,
    }, titleCard, tutorial, endScreen, stats, deps.getProgress(), flashAlpha, hiddenIds, failing, zoom);
    if (menu.isOpen) {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.width / dpr;
      const cssH = canvas.height / dpr;
      const progress = deps.getProgress();
      menu.draw(ctx, style, cssW, cssH, PACKS, progress.packProgress, highestUnlockedPackIdx(progress.packProgress));
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    canvas.removeEventListener("pointerdown", onPointerDownSafe);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
    canvas.removeEventListener("touchcancel", onTouchEnd);
  };
}

function render(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: GameState,
  style: RenderStyle,
  ghostFrames: ReadonlyArray<AnimFrame>,
  exitGhost: ExitGhost,
  confetti: Confetti,
  dissolve: Dissolve,
  hintGlow: HintGlow,
  tapRipple: TapRipple,
  hudState: HudInputState,
  titleCard: TitleCard,
  tutorial: TutorialOverlay,
  endScreen: EndScreen,
  stats: SessionStats,
  progress: Progress,
  collisionFlashAlpha: number,
  hiddenIds: ReadonlySet<number>,
  failing: { id: number; alpha: number } | null,
  zoom: number,
): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  const baseVp = computeViewport(state.grid, cssW, cssH);
  const vp: ViewportGeometry = applyZoom(baseVp, state.grid.cols, state.grid.rows, zoom);
  clear(ctx, vp, style);
  drawGridDots(ctx, vp, state.grid, style);
  hintGlow.draw(ctx, style.lavender);
  drawArrows(ctx, vp, state.grid, style, state.collisionCell, collisionFlashAlpha, hiddenIds, failing);
  drawGhostArrows(ctx, vp, ghostFrames, style);
  exitGhost.draw(ctx, vp, style.lavender);
  // Full-screen red vignette — gated by collisionFlashAlpha. Drawn
  // after arrows + ghosts so it tints the whole play area; before HUD
  // so the heart row stays legible.
  drawCollideVignette(ctx, vp, collisionFlashAlpha, style);
  dissolve.draw(ctx);
  tapRipple.draw(ctx, style.lavender);
  drawHud(ctx, state, style, cssW, cssH, hudState);
  tutorial.draw(ctx, style, cssW, cssH);
  confetti.draw(ctx);
  titleCard.draw(ctx, style, cssW, cssH);
  endScreen.draw(ctx, style, cssW, cssH, stats, progress);
}
