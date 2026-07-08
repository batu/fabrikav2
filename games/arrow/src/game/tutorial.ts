/**
 * Tutorial pill — shown on level 1 first play only.
 *
 * "Tap to move" pill at the bottom center + a pointer-hand glyph
 * pointing to the first legal arrow. Fades out on first successful
 * tap or after 4 seconds.
 */

import type { RenderStyle } from "./render.js";

export class TutorialOverlay {
  enabled = false;
  t = 0;
  readonly AUTO_DISMISS_MS = 4000;

  enable(): void {
    this.enabled = true;
    this.t = 0;
  }

  disable(): void {
    this.enabled = false;
  }

  tick(dtMs: number): void {
    if (!this.enabled) return;
    this.t += dtMs;
    if (this.t >= this.AUTO_DISMISS_MS) this.enabled = false;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    style: RenderStyle,
    cssW: number,
    cssH: number,
  ): void {
    if (!this.enabled) return;

    const alpha = this.t < 300 ? this.t / 300 : 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);

    // Pill at bottom.
    const pillW = cssW * 0.55;
    const pillH = 56;
    const pillX = (cssW - pillW) / 2;
    const pillY = cssH * 0.88;
    ctx.fillStyle = style.accentSoft;
    ctx.beginPath();
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = style.lavender;
    ctx.font = `700 18px Nunito, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Tap to move", cssW / 2, pillY + pillH / 2);

    ctx.restore();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
