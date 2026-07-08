/**
 * Title card — shown briefly before each level begins.
 *
 * Reference boot screen: "Arrows" wordmark with a stylized triangle
 * for the capital A, "Level N" subtitle in lavender, large Play pill.
 *
 * Our flow:
 *   - After loadLevel, the card is active for 800ms + tap to dismiss.
 *   - Fade-in over 200ms; fade-out over 200ms.
 *   - Dismiss on tap, or auto-dismiss when fadeOutAt elapses.
 *
 * Progress is shown as a small "X / N" under the Level label so the
 * player sees how far along they are in the arc.
 */

import type { RenderStyle } from "./render.js";

export type TitleCardPhase = "fade-in" | "idle" | "fade-out" | "done";

export class TitleCard {
  level = 1;
  totalLevels = 1;
  highestCompleted = 0;
  packTitle = "";
  indexInPack = 0;
  phase: TitleCardPhase = "done";
  t = 0;
  // Timings (ms).
  readonly FADE_IN = 250;
  readonly MIN_IDLE = 650;
  readonly FADE_OUT = 220;

  show(level: number, totalLevels?: number, highestCompleted?: number, packTitle?: string, indexInPack?: number): void {
    this.level = level;
    if (totalLevels !== undefined) this.totalLevels = totalLevels;
    if (highestCompleted !== undefined) this.highestCompleted = highestCompleted;
    if (packTitle !== undefined) this.packTitle = packTitle;
    if (indexInPack !== undefined) this.indexInPack = indexInPack;
    this.phase = "fade-in";
    this.t = 0;
  }

  tick(dtMs: number): void {
    if (this.phase === "done") return;
    this.t += dtMs;
    if (this.phase === "fade-in" && this.t >= this.FADE_IN) {
      this.phase = "idle";
      this.t = 0;
    } else if (this.phase === "idle" && this.t >= this.MIN_IDLE) {
      // Auto-advance to fade-out when the idle window elapses.
      this.phase = "fade-out";
      this.t = 0;
    } else if (this.phase === "fade-out" && this.t >= this.FADE_OUT) {
      this.phase = "done";
      this.t = 0;
    }
  }

  /** User tap during fade-in/idle skips the remaining idle window. */
  dismiss(): void {
    if (this.phase === "fade-in" || this.phase === "idle") {
      this.phase = "fade-out";
      this.t = 0;
    }
  }

  get isVisible(): boolean {
    return this.phase !== "done";
  }

  /** Returns true iff pointer input should bypass the underlying game
   * (i.e. the title card is eating taps for a dismiss). */
  get consumesInput(): boolean {
    return this.phase === "fade-in" || this.phase === "idle";
  }

  private currentAlpha(): number {
    switch (this.phase) {
      case "fade-in": {
        // easeOutCubic — snaps to full faster than linear, which feels
        // more responsive on a level transition.
        const p = this.t / this.FADE_IN;
        return 1 - (1 - p) * (1 - p) * (1 - p);
      }
      case "idle":
        return 1;
      case "fade-out": {
        // easeInCubic — lingers at full then drops, avoiding a grey
        // middle band that looks like a stall.
        const p = this.t / this.FADE_OUT;
        return 1 - p * p * p;
      }
      case "done":
        return 0;
    }
  }

  draw(ctx: CanvasRenderingContext2D, style: RenderStyle, cssW: number, cssH: number): void {
    if (!this.isVisible) return;
    const alpha = Math.max(0, Math.min(1, this.currentAlpha()));
    ctx.save();
    ctx.globalAlpha = alpha;

    // Soft background wash that fades with the card.
    ctx.fillStyle = style.bg;
    ctx.globalAlpha = alpha * 0.88;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.globalAlpha = alpha;

    // Logo: a triangle glyph + "rrows"
    const logoY = cssH * 0.42;
    const logoFontPx = Math.round(cssW * 0.12);
    ctx.font = `900 ${logoFontPx}px Nunito, SF Pro Rounded, system-ui, sans-serif`;
    const rrowsText = "rrows";
    const rrowsW = ctx.measureText(rrowsText).width;
    const triangleW = logoFontPx * 0.85;
    const totalW = triangleW + rrowsW + logoFontPx * 0.1;
    const startX = (cssW - totalW) / 2;

    // Triangle that stands in for the capital A.
    ctx.fillStyle = style.ink;
    ctx.beginPath();
    ctx.moveTo(startX + triangleW / 2, logoY - logoFontPx * 0.72);
    ctx.lineTo(startX + triangleW, logoY + logoFontPx * 0.05);
    ctx.lineTo(startX, logoY + logoFontPx * 0.05);
    ctx.closePath();
    ctx.fill();

    // Word "rrows"
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(rrowsText, startX + triangleW + logoFontPx * 0.1, logoY + logoFontPx * 0.05);

    // Level N subtitle (or "<Pack Name> N" if we have pack info).
    ctx.fillStyle = style.lavender;
    ctx.font = `800 ${Math.round(cssW * 0.065)}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = "center";
    const subtitle = this.packTitle && this.indexInPack > 0
      ? `${this.packTitle} · ${this.indexInPack}`
      : `Level ${this.level}`;
    ctx.fillText(subtitle, cssW / 2, logoY + logoFontPx * 0.6);


    // Progress dot strip — one dot per level within the current decade
    // (groups of 10), so the strip stays a readable size even when
    // totalLevels grows past ~15.
    if (this.totalLevels > 1) {
      const decadeStart = Math.floor((this.level - 1) / 10) * 10;
      const dotsInDecade = Math.min(10, this.totalLevels - decadeStart);
      const dotY = logoY + logoFontPx * 1.5;
      const dotR = Math.max(3, cssW * 0.01);
      const dotSpacing = Math.min(cssW * 0.045, 28);
      const stripWidth = dotSpacing * (dotsInDecade - 1);
      const startX = cssW / 2 - stripWidth / 2;
      for (let i = 0; i < dotsInDecade; i++) {
        const lv = decadeStart + i + 1;
        const cx = startX + i * dotSpacing;
        ctx.beginPath();
        ctx.arc(cx, dotY, dotR, 0, Math.PI * 2);
        if (lv === this.level) {
          // Current level — solid indigo dot with a pulsing ring.
          ctx.fillStyle = style.ink;
          ctx.globalAlpha = alpha;
          ctx.fill();
          ctx.strokeStyle = style.ink;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx, dotY, dotR * 2.2, 0, Math.PI * 2);
          ctx.globalAlpha = alpha * 0.35;
          ctx.stroke();
        } else if (lv <= this.highestCompleted) {
          // Completed — solid lavender.
          ctx.globalAlpha = alpha;
          ctx.fillStyle = style.lavender;
          ctx.fill();
        } else {
          // Not yet — hollow lavender outline.
          ctx.globalAlpha = alpha * 0.5;
          ctx.strokeStyle = style.lavender;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = alpha;
    }

    // Tap-to-continue hint — gentle breathing pulse so it reads as
    // interactive rather than decorative.
    const pulse = 0.55 + 0.25 * Math.sin(performance.now() / 420);
    ctx.fillStyle = style.lavender;
    ctx.globalAlpha = alpha * pulse;
    ctx.font = `500 ${Math.round(cssW * 0.038)}px Nunito, system-ui, sans-serif`;
    ctx.fillText("tap to play", cssW / 2, logoY + logoFontPx * 1.85);

    ctx.restore();
  }
}
