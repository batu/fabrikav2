/**
 * Tap ripple — a small expanding ring at the tap point, acknowledging
 * the input before the gameplay-level feedback (arrow animation) fires.
 * Gives the user confidence a tap landed even on empty cells.
 */

interface Ripple {
  x: number;
  y: number;
  t: number;
}

const DURATION_MS = 320;
const MAX_RADIUS = 36;

export class TapRipple {
  private ripples: Ripple[] = [];

  spawn(x: number, y: number): void {
    this.ripples.push({ x, y, t: 0 });
  }

  tick(dtMs: number): void {
    let w = 0;
    for (let r = 0; r < this.ripples.length; r++) {
      const ripple = this.ripples[r]!;
      ripple.t += dtMs;
      if (ripple.t >= DURATION_MS) continue;
      this.ripples[w++] = ripple;
    }
    this.ripples.length = w;
  }

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    for (const r of this.ripples) {
      const p = r.t / DURATION_MS;
      const radius = MAX_RADIUS * p;
      const alpha = (1 - p) * 0.4;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
