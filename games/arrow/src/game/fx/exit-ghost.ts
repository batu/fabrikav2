/**
 * Exit-ghost FX — lavender echo trails lingering briefly past the
 * board edge after an arrow slithers off. Reference game
 * (com.ecffri.arrows) shows a faded body continuation that persists
 * ~200ms after the arrow is visually gone, softening the 'pop' of
 * exit completion.
 *
 * Each ghost entry captures the cells that formed the arrow's body
 * at the moment the exit anim completed. draw() renders the polyline
 * in style.lavender with alpha lerping from GHOST_ALPHA_START → 0
 * over GHOST_MS milliseconds, then the entry drops.
 */

import type { Coord, PathDir } from "../path.js";
import { PATH_DIR_VEC } from "../path.js";
import type { ViewportGeometry } from "../render.js";

const GHOST_MS = 200;
const GHOST_ALPHA_START = 0.4;

interface GhostEntry {
  readonly cells: ReadonlyArray<Coord>;
  readonly headFacing: PathDir;
  t: number;
}

export class ExitGhost {
  private ghosts: GhostEntry[] = [];

  spawn(cells: ReadonlyArray<Coord>, headFacing: PathDir): void {
    if (cells.length < 2) return;
    this.ghosts.push({ cells: [...cells], headFacing, t: 0 });
  }

  tick(dtMs: number): void {
    let w = 0;
    for (let r = 0; r < this.ghosts.length; r++) {
      const g = this.ghosts[r]!;
      g.t += dtMs;
      if (g.t < GHOST_MS) this.ghosts[w++] = g;
    }
    this.ghosts.length = w;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    vp: ViewportGeometry,
    lavender: string,
  ): void {
    if (this.ghosts.length === 0) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, vp.cell * 0.18);
    ctx.strokeStyle = lavender;
    ctx.fillStyle = lavender;
    for (const g of this.ghosts) {
      const alpha = GHOST_ALPHA_START * (1 - g.t / GHOST_MS);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      const firstCell = g.cells[0]!;
      const firstPx = cellCenterLocal(vp, firstCell);
      ctx.moveTo(firstPx.x, firstPx.y);
      for (let i = 1; i < g.cells.length; i++) {
        const c = cellCenterLocal(vp, g.cells[i]!);
        ctx.lineTo(c.x, c.y);
      }
      ctx.stroke();
      // Small triangle hint at the last cell along headFacing.
      const lead = g.cells[g.cells.length - 1]!;
      drawGhostHead(ctx, vp, lead, g.headFacing);
    }
    ctx.restore();
  }
}

function cellCenterLocal(vp: ViewportGeometry, c: Coord): { x: number; y: number } {
  return { x: vp.gx + c.x * vp.cell + vp.cell / 2, y: vp.gy + c.y * vp.cell + vp.cell / 2 };
}

function drawGhostHead(
  ctx: CanvasRenderingContext2D,
  vp: ViewportGeometry,
  cell: Coord,
  dir: PathDir,
): void {
  const c = cellCenterLocal(vp, cell);
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
  ctx.fill();
}
