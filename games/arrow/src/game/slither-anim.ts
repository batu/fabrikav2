/**
 * Slither animation — juice-aware, emits per-frame render state.
 *
 * Model: an arrow's body is a rigid-length "snake" that walks along a
 * single track = [originalCells, pathAhead, virtualAheadCells]. An
 * `advance` counter (fractional, in cells) describes how far the snake
 * has moved along the track from its resting position:
 *   - advance = 0  → head at originalCells[last], tail at originalCells[0]
 *   - advance = k  → head at track[originalLen - 1 + k]
 *                    tail at track[k] (exit — tail pops) or track[0] (collide — body grows)
 *   - virtual cells beyond pathAhead are synthesized along head-dir so
 *     exit fade can render the snake continuing off-board.
 *
 * Lifecycle (elapsed `t` in ms from tap):
 *   [0, windupMs)      wind-up: tailStretch eases 0 → WINDUP_STRETCH via easeOutCubic (tail extends backward past body[0] along anti-head-dir; head stays at rest)
 *   [wEnd, sEnd)       slither: advance goes 0 → targetAdvance via easeInOutCubic
 *                      exit:    targetAdvance = originalLen + aheadLen (full walk-off)
 *                      collide: targetAdvance = aheadLen (head stops at collision cell)
 *   [sEnd, sEnd+FADE)  exit streak-fade: alpha tapers 1 → 0, body keeps advancing
 *   [sEnd, sEnd+hold)  collide impact: recoil + body shake, done at end
 *
 * AnimConfig (captured at spawn, R13 per-anim snapshot) gates each
 * beat. toAnimConfig(juice) is the single source.
 */

import type { AnimConfig } from "./juice.js";
import type { Coord, PathDir } from "./path.js";

export type AnimKind = "exit" | "collide";

const WINDUP_STRETCH_CELLS = 0.35;
const FADE_MS = 150;
const FADE_CELLS_AHEAD = 2;
const SHAKE_MAG_CELLS = 0.06;
const SHAKE_PERIOD_MS = 60;
const RECOIL_OUT_FRAC = 0.3;
const RECOIL_IN_FRAC = 0.45;
const RECOIL_DEPTH = 0.35;
/** Return phase after the collide hold — head eases from the
 *  collision cell back to originalCells[last] over this window.
 *  Without it the head snapped in a single frame, which read as
 *  jarring. */
const RETURN_MS = 150;

export interface AnimFrame {
  /** Exit vs collide — render picks color (blue vs ink) from this. */
  readonly kind: AnimKind;
  readonly bodyCells: ReadonlyArray<Coord>;
  readonly head: {
    readonly cell: Coord;
    readonly nextCell: Coord | null;
    readonly frac: number;
  };
  /** Triangle orientation. Fixed at the arrow's original head direction
   *  so recoil (which points head.nextCell backward) and streak-fade
   *  (which may have null nextCell) don't flip the triangle. */
  readonly headFacing: PathDir;
  /** Tail sub-cell position: fraction of the way from bodyCells[0]
   *  toward bodyCells[1] along the polyline. Matches the head's
   *  frac so the whole body slides fractionally — otherwise the tail
   *  snaps one cell at each advance-integer boundary, reading as
   *  an ~83ms stutter at 12 cells/sec (reviewer P1). Always 0 for
   *  kind='collide' since the tail doesn't move during collide slither. */
  readonly tailFrac: number;
  readonly alpha: number;
  readonly shake: { readonly dx: number; readonly dy: number };
  /** Wind-up tail extension, in cells. 0 = rest; ~0.35 = peak wind-up.
   *  During wind-up the body visibly LENGTHENS — the rendered tail
   *  extends past bodyCells[0] toward tailAnchor by this amount, like
   *  drawing a bowstring backward. Head stays stationary; only the
   *  tail end stretches. Always 0 outside the wind-up beat. */
  /** Activation color blend. 0 = full ink, 1 = full activeBlue.
   *  Ramps 0→1 during wind-up via easeOutCubic so the blue fades in
   *  instead of hard-switching. Stays 1 for the rest of the anim.
   *  Collide kind ignores this (collide stays ink). */
  readonly activationBlend: number;
  /** True on exactly ONE frame per collide anim lifetime: the tick
   *  where t first crosses sEnd (head reaches the collision cell).
   *  Loop observes this transition to fire collision feedback —
   *  vignette, red disc, persistent red — in sync with the visual
   *  impact instead of the instant the player tapped. */
  readonly impactJustHappened: boolean;
  readonly tailStretch: number;
  /** Virtual cell one step past bodyCells[0] in the tail-end segment
   *  direction (anti-head direction along the polyline). Fixed per
   *  anim — follows the body's local tail direction, which for bent
   *  arrows differs from the reverse of head-direction. Render lerps
   *  from cellCenter(bodyCells[0]) toward cellCenter(tailAnchor) by
   *  tailStretch to place the extended tail endpoint. */
  readonly tailAnchor: Coord;
}

export interface SlitherAnim {
  readonly id: number;
  readonly kind: AnimKind;
  readonly originalCells: ReadonlyArray<Coord>;
  readonly pathAhead: ReadonlyArray<Coord>;
  readonly cfg: AnimConfig;
  /** Pre-built track: originalCells ++ pathAhead ++ virtualAhead. */
  readonly track: ReadonlyArray<Coord>;
  /** targetAdvance cells for the slither window. */
  readonly targetAdvance: number;
  /** Triangle orientation fixed at spawn so render doesn't need to
   *  re-infer from head motion (which flips during recoil). */
  readonly headFacing: PathDir;
  /** Virtual cell 1 past originalCells[0] in anti-head (tail-end)
   *  direction, computed once at spawn. See AnimFrame.tailAnchor. */
  readonly tailAnchor: Coord;
  t: number;
  done: boolean;
  /** True once the collision impact event has been reported via a
   *  frame (impactJustHappened). Prevents re-firing on subsequent
   *  hold-phase frames. Not meaningful for exit anims. */
  impactFired: boolean;
}

function easeOutCubic(p: number): number {
  const q = 1 - p;
  return 1 - q * q * q;
}

function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function headDirOf(cells: ReadonlyArray<Coord>): { dx: number; dy: number } {
  if (cells.length < 2) return { dx: 0, dy: 0 };
  const a = cells[cells.length - 2]!;
  const b = cells[cells.length - 1]!;
  return { dx: b.x - a.x, dy: b.y - a.y };
}

/**
 * Virtual cell 1 step past the tail along the anti-head direction.
 * Uses the body's tail-end segment (originalCells[0] - originalCells[1])
 * for direction — for L/U shapes this follows the tail arm, NOT the
 * global reverse of head-direction.
 *
 * Fallback chain for bodies too short to infer from body[1]:
 *   - pathAhead[0] flipped: body[0] - pathAhead[0] (if body.length === 1)
 *   - head.cell fallback: body[0] - head.cell (if both above missing)
 *   - body[0] itself (anchor collapses; tailStretch renders no extension)
 */
function tailAnchorOf(
  originalCells: ReadonlyArray<Coord>,
  pathAhead: ReadonlyArray<Coord>,
): Coord {
  const tail = originalCells[0]!;
  const next =
    originalCells[1] ??
    pathAhead[0] ??
    tail;
  return { x: tail.x + (tail.x - next.x), y: tail.y + (tail.y - next.y) };
}

function pathDirOf(cells: ReadonlyArray<Coord>): PathDir {
  const { dx, dy } = headDirOf(cells);
  if (dx === 1) return "E";
  if (dx === -1) return "W";
  if (dy === 1) return "S";
  if (dy === -1) return "N";
  return "N";
}

function buildTrack(
  originalCells: ReadonlyArray<Coord>,
  pathAhead: ReadonlyArray<Coord>,
): Coord[] {
  const dir = headDirOf(originalCells);
  const track: Coord[] = [...originalCells, ...pathAhead];
  // Synthesize FADE_CELLS_AHEAD virtual cells past the last track cell
  // along head-dir so exit streak-fade has somewhere to render.
  const last = track[track.length - 1]!;
  for (let i = 1; i <= FADE_CELLS_AHEAD; i++) {
    track.push({ x: last.x + dir.dx * i, y: last.y + dir.dy * i });
  }
  return track;
}

/** Wind-up duration in ms, honoring the enable gate. Canonical — all
 *  callers route through here so the sEnd boundary stays consistent
 *  between spawn-time (makeAnim cap) and tick-time (phase gate). */
function windupDurationOf(cfg: AnimConfig): number {
  return cfg.windupEnabled ? cfg.windupDurationMs : 0;
}

/** Slither duration in ms given the advance cells + speed. Pre-SlitherAnim
 *  primitive so makeAnim can call it before the anim object exists. */
function slitherDurationOf(targetAdvance: number, cellsPerSec: number): number {
  return (targetAdvance / cellsPerSec) * 1000;
}

export function makeAnim(
  arrowId: number,
  kind: AnimKind,
  originalCells: ReadonlyArray<Coord>,
  pathAhead: ReadonlyArray<Coord>,
  cfg: AnimConfig,
): SlitherAnim {
  const track = buildTrack(originalCells, pathAhead);
  const originalLen = originalCells.length;
  const aheadLen = pathAhead.length;
  const targetAdvance = kind === "exit" ? originalLen + aheadLen : aheadLen;
  // Cap seedT at sEnd so collide anims still fire impactJustHappened
  // on the first tick — without the cap, first tick lands in RETURN/
  // done branch and skips impact (see commit d3e36102).
  const sEnd = windupDurationOf(cfg) + slitherDurationOf(targetAdvance, cfg.slitherCellsPerSec);
  const seedT = Math.min(cfg.animSkipMs, sEnd);
  return {
    id: arrowId,
    kind,
    originalCells,
    pathAhead,
    cfg,
    track,
    targetAdvance,
    headFacing: pathDirOf(originalCells),
    tailAnchor: tailAnchorOf(originalCells, pathAhead),
    t: seedT,
    done: false,
    impactFired: false,
  };
}

/** Build a frame at a given `advance` position along the track. */
function frameAt(
  anim: SlitherAnim,
  advance: number,
  alpha: number,
  shake: { dx: number; dy: number },
  tailStretch: number,
  activationBlend: number,
): AnimFrame {
  const i = Math.floor(advance);
  const frac = advance - i;
  const originalLen = anim.originalCells.length;
  const headTrackIdx = originalLen - 1 + i;
  const tailTrackIdx = anim.kind === "exit" ? i : 0;

  const lastValid = anim.track.length - 1;
  const cellIdx = Math.min(headTrackIdx, lastValid);
  const cell = anim.track[cellIdx]!;
  const nextCell = headTrackIdx + 1 <= lastValid ? anim.track[headTrackIdx + 1]! : null;

  const bodyCells: Coord[] = [];
  const bodyStart = Math.max(0, tailTrackIdx);
  const bodyEnd = Math.min(headTrackIdx, anim.track.length);
  for (let k = bodyStart; k < bodyEnd; k++) {
    bodyCells.push(anim.track[k]!);
  }

  // Exit tail advances with the head (rigid-length snake). Collide
  // tail is pinned to track[0] — body grows into pathAhead instead.
  const tailFrac = anim.kind === "exit" ? frac : 0;

  return {
    kind: anim.kind,
    bodyCells,
    head: { cell, nextCell, frac },
    headFacing: anim.headFacing,
    tailFrac,
    alpha,
    shake,
    activationBlend,
    tailStretch,
    tailAnchor: anim.tailAnchor,
    impactJustHappened: false,
  };
}

export function tickAnim(anim: SlitherAnim, dtMs: number): AnimFrame {
  anim.t += dtMs;
  const t = anim.t;
  const wEnd = windupDurationOf(anim.cfg);
  const slitherMs = slitherDurationOf(anim.targetAdvance, anim.cfg.slitherCellsPerSec);
  const sEnd = wEnd + slitherMs;

  // Wind-up: tail stretches backward past body[0] along the tail-end
  // segment direction (tailAnchor). Head stays at rest (advance = 0).
  // Activation color also fades in over this same window so blue
  // doesn't hard-switch the instant the player taps.
  if (t < wEnd) {
    const p = wEnd === 0 ? 1 : t / wEnd;
    const eased = easeOutCubic(clamp01(p));
    const stretch = eased * WINDUP_STRETCH_CELLS;
    return frameAt(anim, 0, 1, { dx: 0, dy: 0 }, stretch, eased);
  }

  // Slither — activation already full at this point.
  if (t < sEnd) {
    const p = slitherMs === 0 ? 1 : clamp01((t - wEnd) / slitherMs);
    const eased = easeInOutCubic(p);
    const advance = eased * anim.targetAdvance;
    return frameAt(anim, advance, 1, { dx: 0, dy: 0 }, 0, 1);
  }

  // Post-slither.
  if (anim.kind === "exit") {
    if (!anim.cfg.exitStreakFade) {
      anim.done = true;
      return emptyFrame(anim);
    }
    const fadeT = t - sEnd;
    if (fadeT >= FADE_MS) {
      anim.done = true;
      return emptyFrame(anim);
    }
    const alpha = 1 - fadeT / FADE_MS;
    // Continue advancing the head into virtualAhead cells.
    const extraAdvance = (fadeT / FADE_MS) * FADE_CELLS_AHEAD;
    return frameAt(anim, anim.targetAdvance + extraAdvance, alpha, { dx: 0, dy: 0 }, 0, 1);
  }

  // collide
  const holdT = t - sEnd;
  const holdMs = anim.cfg.collisionHoldMs;
  // After the hold, ease the head back from the collision cell to
  // originalCells[last] over RETURN_MS so the anim doesn't snap.
  // During this window, advance decreases from targetAdvance → 0
  // via easeInOutCubic, reusing the slither geometry in reverse.
  if (holdT >= holdMs && holdT < holdMs + RETURN_MS) {
    const rp = clamp01((holdT - holdMs) / RETURN_MS);
    const eased = easeInOutCubic(rp);
    const advance = anim.targetAdvance * (1 - eased);
    return frameAt(anim, advance, 1, { dx: 0, dy: 0 }, 0, 1);
  }
  if (holdT >= holdMs + RETURN_MS) {
    anim.done = true;
    return emptyFrame(anim);
  }
  // Base frame at terminal advance (head at collision cell, full body).
  const baseFrame = frameAt(anim, anim.targetAdvance, 1, { dx: 0, dy: 0 }, 0, 1);

  // Recoil: head frac backs off toward prev cell, springs back.
  let head = baseFrame.head;
  if (anim.cfg.headRecoil) {
    const outMs = anim.cfg.collisionHoldMs * RECOIL_OUT_FRAC;
    const inMs = anim.cfg.collisionHoldMs * RECOIL_IN_FRAC;
    const collision = head.cell;
    const originalLen = anim.originalCells.length;
    const prevIdx = originalLen - 1 + anim.targetAdvance - 1;
    const prev = anim.track[prevIdx] ?? collision;
    if (holdT < outMs) {
      // Out phase: head backs off along the polyline, reaching
      // RECOIL_DEPTH at the end of this window via easeOutCubic.
      const p = clamp01(holdT / outMs);
      const back = easeOutCubic(p) * RECOIL_DEPTH;
      head = { cell: collision, nextCell: prev, frac: back };
    } else if (holdT < outMs + inMs) {
      // In phase: monotonic spring back from RECOIL_DEPTH → 0 via
      // easeOutCubic on (1-p). Continuous across the out→in boundary
      // (both evaluate to RECOIL_DEPTH at p=0 of in) and monotonic
      // down to 0 at p=1. Replaces the prior sin(pπ)·(1-p) formula
      // which teleported to 0 at in-start and bounced away a second
      // time (reviewer P3: double-bounce with a discontinuity).
      const p = clamp01((holdT - outMs) / inMs);
      const back = easeOutCubic(1 - p) * RECOIL_DEPTH;
      head = { cell: collision, nextCell: prev, frac: back };
    } else {
      head = { cell: collision, nextCell: null, frac: 0 };
    }
  }

  // Body shake.
  let shake = { dx: 0, dy: 0 };
  if (anim.cfg.bodyShake) {
    const remaining = 1 - holdT / anim.cfg.collisionHoldMs;
    const phase = (t / SHAKE_PERIOD_MS) * Math.PI * 2;
    shake = {
      dx: Math.sin(phase) * SHAKE_MAG_CELLS * remaining,
      dy: Math.cos(phase * 1.3) * SHAKE_MAG_CELLS * remaining,
    };
  }

  // Fire impact event on the first hold frame (head just reached
  // collision cell). Loop wires state.collisionCell + flash + failing
  // state at this moment so the visual impact syncs to the head's
  // arrival, not the tap.
  const impactJustHappened = !anim.impactFired;
  if (impactJustHappened) anim.impactFired = true;

  return {
    kind: anim.kind,
    bodyCells: baseFrame.bodyCells,
    head,
    headFacing: anim.headFacing,
    tailFrac: 0, // collide: tail pinned
    alpha: 1,
    shake,
    activationBlend: 1, // collide stays ink; render ignores anyway
    tailStretch: 0,
    tailAnchor: anim.tailAnchor,
    impactJustHappened,
  };
}

function emptyFrame(anim: SlitherAnim): AnimFrame {
  return {
    kind: anim.kind,
    bodyCells: [],
    head: { cell: { x: 0, y: 0 }, nextCell: null, frac: 0 },
    headFacing: anim.headFacing,
    tailFrac: 0,
    alpha: 0,
    shake: { dx: 0, dy: 0 },
    activationBlend: 1,
    tailStretch: 0,
    tailAnchor: anim.tailAnchor,
    impactJustHappened: false,
  };
}

export function animDone(a: SlitherAnim): boolean {
  return a.done;
}
