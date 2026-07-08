/**
 * Canvas renderer — polyline bodies with triangle heads.
 *
 * Coordinate model:
 *   - Grid cells are `cell` pixels wide.
 *   - The grid is centered horizontally; vertically padded for HUD.
 *   - (0, 0) of the canvas is top-left.
 *
 * Polyline rendering: each Arrow's cells are drawn as a single
 * stroked path with round caps/joins, so body bends render smoothly
 * and the full path is visible (tap-anywhere-on-body is already
 * covered by cellIndex lookup in loop.ts). A filled triangle at the
 * head cell indicates direction.
 *
 * UI-1 will polish proportions / colors; this is the baseline.
 */

import {
  type Coord,
  type Path,
  type PathDir,
  type PathGrid,
  headDir,
  PATH_DIR_VEC,
} from "./path.js";
import type { AnimFrame } from "./slither-anim.js";

export interface RenderStyle {
  bg: string;
  ink: string;
  lavender: string;
  heart: string;
  error: string;
  accentSoft: string;
  /** Saturated royal blue used for the "this arrow is activated and
   *  launching" state during exit anims. Reads distinctly against ink
   *  so players immediately see which arrow they tapped and that the
   *  tap succeeded. Collide anims stay in ink. */
  activeBlue: string;
}

export interface ViewportGeometry {
  w: number;
  h: number;
  gx: number;
  gy: number;
  cell: number;
}

export function computeViewport(
  grid: PathGrid,
  canvasW: number,
  canvasH: number,
): ViewportGeometry {
  const topPadPx = canvasH * 0.08;
  const bottomPadPx = canvasH * 0.08;
  const sidePadPx = canvasW * 0.04;
  const usableW = canvasW - sidePadPx * 2;
  const usableH = canvasH - topPadPx - bottomPadPx;
  const cell = Math.min(usableW / grid.cols, usableH / grid.rows);
  const gridW = cell * grid.cols;
  const gridH = cell * grid.rows;
  const gx = (canvasW - gridW) / 2;
  const gy = topPadPx + (usableH - gridH) / 2;
  return { w: canvasW, h: canvasH, gx, gy, cell };
}

/**
 * Apply a zoom factor to a base viewport, keeping the grid centered
 * around its pre-zoom center (no pan). The board scales; the HUD is
 * drawn separately and stays anchored to canvas dimensions.
 *
 * Callers MUST pass the result through `hitTest()` when mapping a
 * pointer event back to a grid cell — `hitTest` treats its `vp`
 * argument as authoritative (no inverse transform inside). So any tap
 * handler that operates under a non-identity zoom does:
 *
 *     const cell = hitTest(applyZoom(baseVp, cols, rows, zoom), grid, px, py);
 *
 * Identity zoom (zoom === 1.0) returns `vp` unchanged so call sites
 * don't need to special-case it.
 *
 * Extracted from loop.ts (previously duplicated at :112 and :522) — see
 * Trello card vlAvsnFt. Drift between the two copies would silently
 * desync hit-test from render, so the helper is the single source of
 * truth. tests/unit/zoom-hit-test.test.ts pins its behavior.
 */
export function applyZoom(
  vp: ViewportGeometry,
  cols: number,
  rows: number,
  zoom: number,
): ViewportGeometry {
  if (zoom === 1.0) return vp;
  const cx = vp.gx + (vp.cell * cols) / 2;
  const cy = vp.gy + (vp.cell * rows) / 2;
  const newCell = vp.cell * zoom;
  return {
    w: vp.w,
    h: vp.h,
    cell: newCell,
    gx: cx - (newCell * cols) / 2,
    gy: cy - (newCell * rows) / 2,
  };
}

export function clear(ctx: CanvasRenderingContext2D, vp: ViewportGeometry, style: RenderStyle): void {
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, vp.w, vp.h);
}

export function drawGridDots(
  ctx: CanvasRenderingContext2D,
  vp: ViewportGeometry,
  _grid: PathGrid,
  style: RenderStyle,
): void {
  const spacing = 28;
  const r = 1.4;
  ctx.fillStyle = style.accentSoft;
  ctx.globalAlpha = 0.6;
  const offsetX = (vp.w / 2) % spacing;
  const offsetY = (vp.h / 2) % spacing;
  for (let y = offsetY; y < vp.h; y += spacing) {
    for (let x = offsetX; x < vp.w; x += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function cellCenter(vp: ViewportGeometry, c: Coord): { x: number; y: number } {
  return { x: vp.gx + c.x * vp.cell + vp.cell / 2, y: vp.gy + c.y * vp.cell + vp.cell / 2 };
}

export function drawArrows(
  ctx: CanvasRenderingContext2D,
  vp: ViewportGeometry,
  grid: PathGrid,
  style: RenderStyle,
  collisionCell: Coord | null = null,
  collisionFlashAlpha: number = 0.55,
  hiddenIds: ReadonlySet<number> = EMPTY_ID_SET,
  failing: { id: number; alpha: number } | null = null,
): void {
  const ids = [...grid.arrows.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    // Hidden ids are being rendered by an active anim ghost in
    // drawGhostArrows — skip here to avoid duplicate-render during
    // collision holds (exit clears the path already so this is a
    // no-op for exit anims).
    if (hiddenIds.has(id)) continue;
    const p = grid.arrows.get(id)!;
    // Failing arrow renders with ink↔error lerp; alpha comes from the
    // failingT / FAIL_PERSIST_MS timer in state.ts. Normal arrows use
    // style.ink directly.
    const color = failing && failing.id === id
      ? lerpHex(style.ink, style.error, failing.alpha)
      : style.ink;
    drawArrow(ctx, vp, p, style, color);
  }
  if (collisionCell) drawCollisionFlash(ctx, vp, collisionCell, style, collisionFlashAlpha);
}

const EMPTY_ID_SET: ReadonlySet<number> = new Set();

function drawArrow(
  ctx: CanvasRenderingContext2D,
  vp: ViewportGeometry,
  p: Path,
  style: RenderStyle,
  color: string = style.ink,
): void {
  if (p.cells.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, vp.cell * 0.18);
  ctx.strokeStyle = color;
  ctx.beginPath();
  const first = cellCenter(vp, p.cells[0]!);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < p.cells.length; i++) {
    const c = cellCenter(vp, p.cells[i]!);
    ctx.lineTo(c.x, c.y);
  }
  ctx.stroke();
  drawTriangleHead(ctx, vp, p.cells[p.cells.length - 1]!, headDir(p), color);
  ctx.restore();
}

function drawTriangleHead(
  ctx: CanvasRenderingContext2D,
  vp: ViewportGeometry,
  head: Coord,
  dir: PathDir,
  color: string,
  pxOverride?: { x: number; y: number },
): void {
  const c = pxOverride ?? cellCenter(vp, head);
  const { dx, dy } = PATH_DIR_VEC[dir];
  const tipX = c.x + dx * (vp.cell * 0.42);
  const tipY = c.y + dy * (vp.cell * 0.42);
  const baseX = c.x - dx * (vp.cell * 0.05);
  const baseY = c.y - dy * (vp.cell * 0.05);
  const half = vp.cell * 0.26;
  const px = -dy;
  const py = dx;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + px * half, baseY + py * half);
  ctx.lineTo(baseX - px * half, baseY - py * half);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Full-screen radial gradient glow — the "you lost a life" feedback.
 * Inner transparent, outer red — reads as an edge-vignette radiating
 * inward from the frame toward the collision cell. Alpha comes from
 * the collision-flash timer; caller passes the 0..1 intensity.
 */
export function drawCollideVignette(
  ctx: CanvasRenderingContext2D,
  vp: ViewportGeometry,
  intensity: number,
  style: RenderStyle,
): void {
  if (intensity <= 0) return;
  const cx = vp.w / 2;
  const cy = vp.h / 2;
  const outerR = Math.sqrt(vp.w * vp.w + vp.h * vp.h) / 2;
  const innerR = outerR * 0.35;
  ctx.save();
  const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
  // style.error with varying alpha. Canvas doesn't accept hex+alpha in
  // older targets; construct an rgba from the hex via a quick parse.
  const rgba = (alpha: number) => hexToRgba(style.error, alpha);
  grad.addColorStop(0, rgba(0));
  grad.addColorStop(0.55, rgba(intensity * 0.2));
  grad.addColorStop(1, rgba(intensity * 0.55));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, vp.w, vp.h);
  ctx.restore();
}

/**
 * Linear-interpolate between two hex colors by t ∈ [0, 1].
 * t=0 returns a, t=1 returns b. Used by drawArrows to fade the
 * failing-tap arrow from ink back to normal once the collision
 * hold elapses.
 */
function lerpHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `#${toHex2(r)}${toHex2(g)}${toHex2(bl)}`;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3
    ? [h[0]!, h[0]!, h[1]!, h[1]!, h[2]!, h[2]!].join("")
    : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function toHex2(n: number): string {
  const c = Math.max(0, Math.min(255, n)).toString(16);
  return c.length < 2 ? `0${c}` : c;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = h.length === 3
    ? [h[0]!, h[0]!, h[1]!, h[1]!, h[2]!, h[2]!].join("")
    : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawCollisionFlash(
  ctx: CanvasRenderingContext2D,
  vp: ViewportGeometry,
  cell: Coord,
  style: RenderStyle,
  alpha: number = 0.55,
): void {
  const c = cellCenter(vp, cell);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style.error;
  ctx.beginPath();
  ctx.arc(c.x, c.y, vp.cell * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw transient ghost bodies from AnimFrames. Handles sub-cell head
 * interpolation, wind-up bodyPull, per-frame shake, and streak-fade
 * alpha. A single AnimFrame drives both the body stroke and the
 * head triangle.
 */
export function drawGhostArrows(
  ctx: CanvasRenderingContext2D,
  vp: ViewportGeometry,
  frames: ReadonlyArray<AnimFrame>,
  style: RenderStyle,
): void {
  if (frames.length === 0) return;
  for (const frame of frames) {
    drawAnimFrame(ctx, vp, frame, style);
  }
}

function drawAnimFrame(
  ctx: CanvasRenderingContext2D,
  vp: ViewportGeometry,
  frame: AnimFrame,
  style: RenderStyle,
): void {
  if (frame.alpha <= 0) return;

  const shake = { dx: frame.shake.dx * vp.cell, dy: frame.shake.dy * vp.cell };

  ctx.save();
  ctx.globalAlpha = frame.alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, vp.cell * 0.18);
  // Exit anims fade from ink → activeBlue over the wind-up window
  // (frame.activationBlend eases 0→1). After wind-up stays at full
  // blue. Collide anims stay in ink — the red vignette + persistent
  // red tint carry the collision signal instead.
  const animColor = frame.kind === "exit"
    ? lerpHex(style.ink, style.activeBlue, frame.activationBlend)
    : style.ink;
  ctx.strokeStyle = animColor;
  ctx.fillStyle = animColor;

  // Build the full polyline: body cells + head.cell. Each adjacent
  // pair is one arc segment of length 1 cell. Corner vertices are
  // the body cell centers themselves — they travel with the polyline,
  // so bends are preserved automatically when we walk the arc.
  const vertices: Coord[] = [...frame.bodyCells, frame.head.cell];
  if (vertices.length < 2) {
    ctx.restore();
    return; // can't stroke a zero-length path
  }
  const totalArc = vertices.length - 1;

  // Head end: extends by head.frac during slither (frac > 0). For
  // slither, frac is along the head.cell → head.nextCell segment,
  // which is PAST the last body vertex, so we handle it as a trailing
  // lineTo after walking the body arc. During wind-up frac=0 so no
  // head extension.
  //
  // Tail end: during exit slither, tailFrac matches head.frac (rigid
  // snake length — both ends advance together) → tail-side arc start.
  // During wind-up, tailStretch > 0 → the tail EXTENDS backward past
  // body[0] toward frame.tailAnchor (bowstring pull). The extension
  // is rendered as a prefix segment BEFORE the main body arc.
  const tailStart = frame.tailFrac;
  const cutoff = totalArc; // no head-end cutoff: head stays at rest during wind-up

  ctx.beginPath();
  let started = false;
  let endpointPx: { x: number; y: number } | null = null;

  // Tail-stretch prefix: a single segment from the extended virtual
  // tail position (body[0] lerped toward tailAnchor by tailStretch)
  // to body[0]. Only when tailStretch > 0 AND we have a body to
  // extend from.
  if (frame.tailStretch > 0 && frame.bodyCells.length > 0) {
    const tailCenter = cellCenter(vp, frame.bodyCells[0]!);
    const anchorCenter = cellCenter(vp, frame.tailAnchor);
    const sx = tailCenter.x + (anchorCenter.x - tailCenter.x) * frame.tailStretch + shake.dx;
    const sy = tailCenter.y + (anchorCenter.y - tailCenter.y) * frame.tailStretch + shake.dy;
    ctx.moveTo(sx, sy);
    started = true;
    // lineTo(tail cell center) — handled implicitly when the main
    // loop's first iteration lineTos to body[0]'s end; but since the
    // main loop starts at vertices[0] via tailStart slicing, we need
    // to land at body[0] first here to bridge the prefix to the body.
    ctx.lineTo(tailCenter.x + shake.dx, tailCenter.y + shake.dy);
  }

  // Walk the arc from tailStart to cutoff along the body vertices.
  // Each segment between vertices[i-1] and vertices[i] spans arc
  // [i-1, i]. Clip start/end to [tailStart, cutoff].
  for (let i = 1; i < vertices.length; i++) {
    const segStart = i - 1;
    const segEnd = i;
    const renderStart = Math.max(segStart, tailStart);
    const renderEnd = Math.min(segEnd, cutoff);
    if (renderEnd <= renderStart) continue;

    const a = cellCenter(vp, vertices[i - 1]!);
    const b = cellCenter(vp, vertices[i]!);
    const startFrac = renderStart - segStart; // [0, 1)
    const endFrac = renderEnd - segStart; // (0, 1]
    const sx = a.x + (b.x - a.x) * startFrac + shake.dx;
    const sy = a.y + (b.y - a.y) * startFrac + shake.dy;
    const ex = a.x + (b.x - a.x) * endFrac + shake.dx;
    const ey = a.y + (b.y - a.y) * endFrac + shake.dy;
    if (!started) {
      ctx.moveTo(sx, sy);
      started = true;
    }
    ctx.lineTo(ex, ey);
    endpointPx = { x: ex, y: ey };
  }

  // Slither extension: one additional segment from head.cell toward
  // head.nextCell by head.frac. During wind-up frac=0 so skipped.
  // During collide recoil, nextCell is the prev cell (backward) and
  // frac ∈ (0, RECOIL_DEPTH) — the extension points backward, which
  // is the intended recoil visual.
  if (frame.head.frac > 0 && frame.head.nextCell) {
    const a = cellCenter(vp, frame.head.cell);
    const b = cellCenter(vp, frame.head.nextCell);
    const ex = a.x + (b.x - a.x) * frame.head.frac + shake.dx;
    const ey = a.y + (b.y - a.y) * frame.head.frac + shake.dy;
    if (!started) {
      ctx.moveTo(a.x + shake.dx, a.y + shake.dy);
      started = true;
    }
    ctx.lineTo(ex, ey);
    endpointPx = { x: ex, y: ey };
  }

  if (started) ctx.stroke();

  // Head triangle at the polyline's endpoint.
  if (endpointPx) {
    drawTriangleHead(
      ctx,
      vp,
      { x: 0, y: 0 },
      frame.headFacing,
      animColor,
      endpointPx,
    );
  }

  ctx.restore();
}


/** Inverse hit-test: canvas (px, py) → grid (x, y) or null. */
export function hitTest(vp: ViewportGeometry, grid: PathGrid, px: number, py: number): { x: number; y: number } | null {
  const lx = px - vp.gx;
  const ly = py - vp.gy;
  if (lx < 0 || ly < 0) return null;
  const x = Math.floor(lx / vp.cell);
  const y = Math.floor(ly / vp.cell);
  if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) return null;
  return { x, y };
}
