/**
 * Arrow exit dissolve — aesthetic A8 ("arrows dissolve into a grid of
 * dots that quickly fade"). Played on each successful arrow removal
 * in addition to the launch slide.
 */

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  t: number;
  color: string;
}

const DURATION_MS = 380;

export class Dissolve {
  private dots: Dot[] = [];

  /** Spawn a 3x3 dot grid centered at (cx, cy) drifting outward
   * in the opposite direction of travel. */
  spawn(cx: number, cy: number, dx: number, dy: number, color: string): void {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        this.dots.push({
          x: cx + i * 6,
          y: cy + j * 6,
          vx: -dx * 120 + (Math.random() - 0.5) * 80,
          vy: -dy * 120 + (Math.random() - 0.5) * 80,
          size: 3 + Math.random() * 2,
          t: 0,
          color,
        });
      }
    }
  }

  tick(dtMs: number): void {
    const dt = dtMs / 1000;
    let w = 0;
    for (let r = 0; r < this.dots.length; r++) {
      const d = this.dots[r]!;
      d.t += dtMs;
      if (d.t >= DURATION_MS) continue;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= 0.92;
      d.vy *= 0.92;
      this.dots[w++] = d;
    }
    this.dots.length = w;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const d of this.dots) {
      const alpha = 1 - d.t / DURATION_MS;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
