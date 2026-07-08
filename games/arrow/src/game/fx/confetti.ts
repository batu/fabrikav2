/**
 * Confetti particle burst — aesthetic A6 (indigo + lavender + light grey)
 * + A9 (~2s, from bottom corners, drift + fade).
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  angle: number;
  spin: number;
  t: number;
}

const GRAVITY = 360; // px/s²
const DURATION_MS = 2000;

export class Confetti {
  private particles: Particle[] = [];

  burst(cssW: number, cssH: number, palette: string[]): void {
    const count = 80;
    for (let i = 0; i < count; i++) {
      const fromLeft = i % 2 === 0;
      const x = fromLeft ? 0 : cssW;
      const y = cssH;
      const aim = Math.random() * 0.5 + (fromLeft ? -Math.PI / 4 : -Math.PI * 3 / 4);
      const speed = 400 + Math.random() * 260;
      this.particles.push({
        x,
        y,
        vx: Math.cos(aim) * speed,
        vy: Math.sin(aim) * speed,
        size: 4 + Math.random() * 6,
        color: palette[Math.floor(Math.random() * palette.length)] ?? "#20214a",
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 10,
        t: 0,
      });
    }
  }

  tick(dtMs: number): void {
    const dt = dtMs / 1000;
    let w = 0;
    for (let r = 0; r < this.particles.length; r++) {
      const p = this.particles[r]!;
      p.t += dtMs;
      if (p.t >= DURATION_MS) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += GRAVITY * dt;
      p.angle += p.spin * dt;
      this.particles[w++] = p;
    }
    this.particles.length = w;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = 1 - p.t / DURATION_MS;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }

  get active(): boolean {
    return this.particles.length > 0;
  }
}
