/**
 * End-of-game celebration — shown after the player clears the last
 * registered level. Displays session stats and a "Play again" prompt
 * that routes to the Restart action.
 */

import type { RenderStyle } from "./render.js";
import type { Progress } from "./persist.js";
import type { SessionStats } from "./session-stats.js";
import { elapsedSeconds } from "./session-stats.js";

export class EndScreen {
  private active = false;
  private t = 0;

  show(): void {
    this.active = true;
    this.t = 0;
  }

  hide(): void {
    this.active = false;
  }

  tick(dtMs: number): void {
    if (!this.active) return;
    this.t += dtMs;
  }

  get visible(): boolean {
    return this.active;
  }

  /** Return true iff taps should be routed to the end screen (dismiss). */
  get consumesInput(): boolean {
    return this.active && this.t > 600;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    style: RenderStyle,
    cssW: number,
    cssH: number,
    stats: SessionStats,
    progress: Progress,
  ): void {
    if (!this.active) return;

    const alpha = Math.min(1, this.t / 400);
    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = style.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.fillStyle = style.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.round(cssW * 0.12)}px Nunito, system-ui, sans-serif`;
    ctx.fillText("All 40 cleared!", cssW / 2, cssH * 0.28);

    // Stats block — four rows.
    const secondsNow = elapsedSeconds(stats);
    const timeStr = fmtDuration(secondsNow);
    const successTaps = stats.taps - stats.blockedTaps;
    const accuracyPct = stats.taps === 0 ? 0 : Math.round((successTaps / stats.taps) * 100);
    const bestStr =
      progress.bestTimeSeconds > 0 && progress.bestTimeSeconds < secondsNow
        ? fmtDuration(progress.bestTimeSeconds)
        : timeStr + " (new best!)";
    const runsStr = progress.completions === 0
      ? "first clear"
      : `${progress.completions + 1}× cleared`;

    ctx.font = `600 ${Math.round(cssW * 0.05)}px Nunito, system-ui, sans-serif`;
    ctx.fillStyle = style.lavender;
    const rows = [
      `time · ${timeStr}`,
      `best · ${bestStr}`,
      `taps · ${stats.taps}  ·  accuracy · ${accuracyPct}%`,
      runsStr,
    ];
    const startY = cssH * 0.42;
    const rowSpacing = Math.round(cssW * 0.075);
    rows.forEach((row, i) => {
      ctx.fillText(row, cssW / 2, startY + i * rowSpacing);
    });

    // Dismiss / replay hint.
    ctx.globalAlpha = alpha * 0.7;
    ctx.font = `500 ${Math.round(cssW * 0.04)}px Nunito, system-ui, sans-serif`;
    ctx.fillText("tap to play again from level 1", cssW / 2, cssH * 0.76);

    ctx.restore();
  }
}

function fmtDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}
