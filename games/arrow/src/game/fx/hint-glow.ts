/**
 * Hint glow — a 1.5s lavender pulse under one legal arrow, shown when
 * the player taps the Hint action in the settings sheet. Purely
 * visual; the underlying grid state is untouched.
 */

const DURATION_MS = 1500;

export class HintGlow {
  private x = 0;
  private y = 0;
  private cellSize = 0;
  private gx = 0;
  private gy = 0;
  private t = 0;
  private active = false;

  show(cellX: number, cellY: number, gx: number, gy: number, cell: number): void {
    this.x = cellX;
    this.y = cellY;
    this.gx = gx;
    this.gy = gy;
    this.cellSize = cell;
    this.t = 0;
    this.active = true;
  }

  tick(dtMs: number): void {
    if (!this.active) return;
    this.t += dtMs;
    if (this.t >= DURATION_MS) this.active = false;
  }

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    if (!this.active) return;
    const p = this.t / DURATION_MS;
    // Sine-pulse: 0 → 1 → 0, envelope peaks mid-duration.
    const pulse = Math.sin(p * Math.PI);
    const alpha = pulse * 0.45;
    const cx = this.gx + this.x * this.cellSize + this.cellSize / 2;
    const cy = this.gy + this.y * this.cellSize + this.cellSize / 2;
    const r = this.cellSize * (0.4 + 0.1 * pulse);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
