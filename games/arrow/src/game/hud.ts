/**
 * HUD — minimal surface matching the reference:
 *   - 3 hearts centered at top (A4 magenta/pink)
 *   - single gear icon top-right that opens a settings sheet
 *   - win / loss overlays (A19: generous, modal)
 *
 * Undo, reset, mute live in the settings sheet rather than on the
 * play surface. Level number is off-screen; progress is reflected
 * by the level-transition title card (card arrow-V3 / V4).
 */

import type { RenderStyle } from "./render.js";
import type { GameState } from "./state.js";
import type { JuiceSettings } from "./juice.js";

const HEART_PATH =
  "M 0 -6 C -3 -10 -10 -9 -10 -3 C -10 3 -4 7 0 10 C 4 7 10 3 10 -3 C 10 -9 3 -10 0 -6 Z";
// Lazy singleton — Path2D is a browser-only constructor; the test
// env (happy-dom) does not define it. Initialize on first draw so
// unit tests that don't hit drawHud run fine.
let heartPath2d: Path2D | null = null;
function heartPath(): Path2D {
  if (heartPath2d === null) heartPath2d = new Path2D(HEART_PATH);
  return heartPath2d;
}
const WIN_WORDS: readonly string[] = [
  "Nice!",
  "Got it!",
  "Tidy!",
  "Well done!",
  "Smooth.",
  "Clean clear.",
  "Spectacular!",
  "Marvellous!",
  "Sublime!",
  "Masterful!",
  "Pack cleared!",
  "Chef's kiss.",
  "On a roll.",
];
const WIN_WORD_ROTATE_MS = 900;
let winWord = WIN_WORDS[0]!;
let nextWinWordAt = 0;

function randomWinWord(now: number): string {
  if (now < nextWinWordAt) return winWord;
  if (WIN_WORDS.length === 1) return winWord;

  let next = winWord;
  while (next === winWord) {
    next = WIN_WORDS[Math.floor(Math.random() * WIN_WORDS.length)]!;
  }
  winWord = next;
  nextWinWordAt = now + WIN_WORD_ROTATE_MS;
  return winWord;
}

/** Single source of truth for juice-sheet rows. Driven by `row` id
 *  (used in button ids and layout map), `key` (which JuiceSettings
 *  field the row reads/writes), plus display `label` and `unit`.
 *  Adding a knob = append one entry here, plus a STEPS entry in
 *  juice.ts. No other file needs to change. */
export const JUICE_KNOB_SPECS = [
  { row: "windup", key: "windupDurationMs", label: "Wind-up", unit: "ms" },
  { row: "speed", key: "slitherCellsPerSec", label: "Slither", unit: "c/s" },
  { row: "hold", key: "collisionHoldMs", label: "Hold", unit: "ms" },
  { row: "skip", key: "animSkipMs", label: "Skip", unit: "ms" },
] as const;

export type JuiceKnobSpec = (typeof JUICE_KNOB_SPECS)[number];
export type JuiceRow = JuiceKnobSpec["row"];

type JuiceButtonId = `juice-${JuiceRow}-minus` | `juice-${JuiceRow}-plus`;

export type HudButton =
  | "gear"
  | "sheet-undo"
  | "sheet-reset"
  | "sheet-mute"
  | "sheet-hint"
  | "sheet-restart"
  | "sheet-juice"
  | "sheet-packs"
  | "sheet-close"
  | JuiceButtonId
  | "juice-close";

export interface HudInputState {
  canUndo: boolean;
  muted: boolean;
  sheetOpen: boolean;
  /** When true, the juice sub-sheet replaces the main settings sheet. */
  juiceSheetOpen: boolean;
  /** Current juice values for rendering the juice sub-sheet. */
  juice: JuiceSettings;
}

function gearRect(cssW: number, cssH: number): { x: number; y: number; r: number } {
  const r = Math.min(cssW * 0.045, 22);
  return { x: cssW - cssW * 0.06 - r, y: cssH * 0.05 + r, r };
}

function heartsCenter(cssW: number, cssH: number): { cx: number; cy: number; size: number; spacing: number } {
  const size = Math.min(cssW * 0.048, 24);
  // The Path2D heart spans x in [-10, 10] → 20u wide. Rendered width = size*20/12.
  // Spacing = size*2.6 keeps ~0.3*size of gap between hearts.
  const spacing = size * 2.6;
  return { cx: cssW / 2, cy: cssH * 0.05 + size, size, spacing };
}

interface SheetBtnRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function sheetBtns(
  cssW: number,
  cssH: number,
): Record<"hint" | "undo" | "reset" | "restart" | "juice" | "packs" | "mute" | "close", SheetBtnRect> {
  const sheetH = cssH * 0.58;
  const sheetTop = cssH - sheetH;
  const btnH = 48;
  const padX = cssW * 0.08;
  const rowY = (i: number) => sheetTop + 44 + i * (btnH + 8);
  return {
    hint: { x: padX, y: rowY(0), w: cssW - padX * 2, h: btnH },
    undo: { x: padX, y: rowY(1), w: cssW - padX * 2, h: btnH },
    reset: { x: padX, y: rowY(2), w: cssW - padX * 2, h: btnH },
    restart: { x: padX, y: rowY(3), w: cssW - padX * 2, h: btnH },
    juice: { x: padX, y: rowY(4), w: cssW - padX * 2, h: btnH },
    packs: { x: padX, y: rowY(5), w: cssW - padX * 2, h: btnH },
    mute: { x: padX, y: rowY(6), w: cssW - padX * 2, h: btnH },
    close: { x: padX, y: rowY(7) + 6, w: cssW - padX * 2, h: btnH * 0.8 },
  };
}

interface JuiceRowRects {
  minus: SheetBtnRect;
  plus: SheetBtnRect;
  label: SheetBtnRect;
}

function juiceSheetBtns(cssW: number, cssH: number): {
  rows: Record<JuiceRow, JuiceRowRects>;
  close: SheetBtnRect;
} {
  const sheetH = cssH * 0.55;
  const sheetTop = cssH - sheetH;
  const btnH = 56;
  const padX = cssW * 0.08;
  const rowY = (i: number) => sheetTop + 52 + i * (btnH + 12);
  const stepW = 56;
  const rowFull = (y: number): JuiceRowRects => ({
    minus: { x: padX, y, w: stepW, h: btnH },
    label: { x: padX + stepW + 8, y, w: cssW - padX * 2 - (stepW + 8) * 2, h: btnH },
    plus: { x: cssW - padX - stepW, y, w: stepW, h: btnH },
  });
  const rows = {} as Record<JuiceRow, JuiceRowRects>;
  JUICE_KNOB_SPECS.forEach((spec, i) => {
    rows[spec.row] = rowFull(rowY(i));
  });
  const closeRowIdx = JUICE_KNOB_SPECS.length;
  return {
    rows,
    close: { x: padX, y: rowY(closeRowIdx) + 14, w: cssW - padX * 2, h: btnH * 0.7 },
  };
}

export function hitHudButton(
  px: number,
  py: number,
  cssW: number,
  cssH: number,
  sheetOpen: boolean,
  juiceSheetOpen: boolean = false,
): HudButton | null {
  if (juiceSheetOpen) {
    const j = juiceSheetBtns(cssW, cssH);
    for (const spec of JUICE_KNOB_SPECS) {
      const row = j.rows[spec.row];
      if (pointInRect(px, py, row.minus)) return `juice-${spec.row}-minus`;
      if (pointInRect(px, py, row.plus)) return `juice-${spec.row}-plus`;
    }
    if (pointInRect(px, py, j.close)) return "juice-close";
    const sheetTop = cssH * 0.45;
    if (py < sheetTop) return "juice-close";
    return null;
  }
  if (sheetOpen) {
    const b = sheetBtns(cssW, cssH);
    if (pointInRect(px, py, b.hint)) return "sheet-hint";
    if (pointInRect(px, py, b.undo)) return "sheet-undo";
    if (pointInRect(px, py, b.reset)) return "sheet-reset";
    if (pointInRect(px, py, b.restart)) return "sheet-restart";
    if (pointInRect(px, py, b.juice)) return "sheet-juice";
    if (pointInRect(px, py, b.packs)) return "sheet-packs";
    if (pointInRect(px, py, b.mute)) return "sheet-mute";
    if (pointInRect(px, py, b.close)) return "sheet-close";
    // Taps on the dim backdrop close the sheet.
    const sheetTop = cssH * 0.45;
    if (py < sheetTop) return "sheet-close";
    return null;
  }
  const g = gearRect(cssW, cssH);
  if ((px - g.x) * (px - g.x) + (py - g.y) * (py - g.y) <= g.r * g.r * 1.3) return "gear";
  return null;
}

function pointInRect(px: number, py: number, r: SheetBtnRect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  style: RenderStyle,
  cssW: number,
  cssH: number,
  input: HudInputState,
): void {
  // Hearts centered at top.
  const { cx, cy, size, spacing } = heartsCenter(cssW, cssH);
  const startX = cx - spacing;
  for (let i = 0; i < 3; i++) {
    const hx = startX + i * spacing;
    drawHeart(ctx, hx, cy, size / 12, i < state.lives ? style.heart : style.accentSoft);
  }

  // Gear icon top-right.
  const g = gearRect(cssW, cssH);
  drawGear(ctx, g, style);

  if (input.juiceSheetOpen) drawJuiceSheet(ctx, style, cssW, cssH, input);
  else if (input.sheetOpen) drawSheet(ctx, style, cssW, cssH, input);

  if (state.status === "lost") drawFailOverlay(ctx, style, cssW, cssH);
  if (state.status === "won") drawWinOverlay(ctx, style, cssW, cssH);
}

function drawHeart(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  fill: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.fillStyle = fill;
  ctx.fill(heartPath());
  ctx.restore();
}

function drawGear(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; r: number },
  style: RenderStyle,
): void {
  const { x, y, r } = rect;
  ctx.save();
  ctx.fillStyle = style.lavender;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = style.bg;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = style.lavender;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const tx = x + Math.cos(a) * r * 0.9;
    const ty = y + Math.sin(a) * r * 0.9;
    ctx.beginPath();
    ctx.arc(tx, ty, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSheet(
  ctx: CanvasRenderingContext2D,
  style: RenderStyle,
  cssW: number,
  cssH: number,
  input: HudInputState,
): void {
  // Dim backdrop.
  ctx.save();
  ctx.fillStyle = "rgba(32, 33, 74, 0.28)";
  ctx.fillRect(0, 0, cssW, cssH);

  // Sheet panel.
  const sheetH = cssH * 0.5;
  const sheetTop = cssH - sheetH;
  ctx.fillStyle = style.bg;
  ctx.beginPath();
  roundRect(ctx, 0, sheetTop, cssW, sheetH, 24);
  ctx.fill();
  // Drag handle.
  ctx.fillStyle = style.accentSoft;
  roundRect(ctx, cssW / 2 - 24, sheetTop + 12, 48, 4, 2);
  ctx.fill();
  ctx.restore();

  const b = sheetBtns(cssW, cssH);
  drawSheetButton(ctx, b.hint, "Hint", style, true);
  drawSheetButton(ctx, b.undo, input.canUndo ? "Undo" : "Undo (empty)", style, input.canUndo);
  drawSheetButton(ctx, b.reset, "Reset level", style, true);
  drawSheetButton(ctx, b.restart, "Restart from level 1", style, true);
  drawSheetButton(ctx, b.juice, "Juice tuning", style, true);
  drawSheetButton(ctx, b.packs, "Packs & levels", style, true);
  drawSheetButton(ctx, b.mute, input.muted ? "Unmute" : "Mute", style, true);
  drawSheetCloseButton(ctx, b.close, style);
}

function drawJuiceSheet(
  ctx: CanvasRenderingContext2D,
  style: RenderStyle,
  cssW: number,
  cssH: number,
  input: HudInputState,
): void {
  // Dim backdrop + sheet panel.
  ctx.save();
  ctx.fillStyle = "rgba(32, 33, 74, 0.28)";
  ctx.fillRect(0, 0, cssW, cssH);
  const sheetH = cssH * 0.55;
  const sheetTop = cssH - sheetH;
  ctx.fillStyle = style.bg;
  ctx.beginPath();
  roundRect(ctx, 0, sheetTop, cssW, sheetH, 24);
  ctx.fill();
  ctx.fillStyle = style.accentSoft;
  roundRect(ctx, cssW / 2 - 24, sheetTop + 12, 48, 4, 2);
  ctx.fill();
  // Title.
  ctx.fillStyle = style.ink;
  ctx.font = `800 18px Nunito, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Juice tuning", cssW / 2, sheetTop + 28);
  ctx.restore();

  const j = juiceSheetBtns(cssW, cssH);
  for (const spec of JUICE_KNOB_SPECS) {
    const r = j.rows[spec.row];
    drawStepButton(ctx, r.minus, "−", style);
    drawStepLabel(ctx, r.label, spec.label, `${input.juice[spec.key]} ${spec.unit}`, style);
    drawStepButton(ctx, r.plus, "+", style);
  }
  drawSheetCloseButton(ctx, j.close, style);
}

function drawStepButton(
  ctx: CanvasRenderingContext2D,
  rect: SheetBtnRect,
  glyph: string,
  style: RenderStyle,
): void {
  ctx.save();
  ctx.fillStyle = style.lavender;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 28px Nunito, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, rect.x + rect.w / 2, rect.y + rect.h / 2 + 2);
  ctx.restore();
}

function drawStepLabel(
  ctx: CanvasRenderingContext2D,
  rect: SheetBtnRect,
  label: string,
  value: string,
  style: RenderStyle,
): void {
  ctx.save();
  ctx.fillStyle = style.accentSoft;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
  ctx.fill();
  ctx.fillStyle = style.ink;
  ctx.font = `700 16px Nunito, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.x + 16, rect.y + rect.h / 2);
  ctx.textAlign = "right";
  ctx.fillText(value, rect.x + rect.w - 16, rect.y + rect.h / 2);
  ctx.restore();
}

function drawSheetButton(
  ctx: CanvasRenderingContext2D,
  rect: SheetBtnRect,
  label: string,
  style: RenderStyle,
  enabled: boolean,
): void {
  ctx.save();
  ctx.fillStyle = enabled ? style.lavender : style.accentSoft;
  ctx.globalAlpha = enabled ? 1 : 0.6;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 18px Nunito, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
  ctx.restore();
}

function drawSheetCloseButton(
  ctx: CanvasRenderingContext2D,
  rect: SheetBtnRect,
  style: RenderStyle,
): void {
  ctx.save();
  ctx.fillStyle = style.lavender;
  ctx.font = `500 14px Nunito, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("close", rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.restore();
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

function drawFailOverlay(
  ctx: CanvasRenderingContext2D,
  style: RenderStyle,
  cssW: number,
  cssH: number,
): void {
  ctx.save();
  ctx.fillStyle = "rgba(245, 244, 239, 0.92)";
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.fillStyle = style.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.round(cssW * 0.09)}px Nunito, system-ui, sans-serif`;
  ctx.fillText("out of moves", cssW / 2, cssH * 0.4);
  ctx.fillStyle = style.lavender;
  ctx.font = `500 ${Math.round(cssW * 0.042)}px Nunito, system-ui, sans-serif`;
  ctx.fillText("tap anywhere to retry", cssW / 2, cssH * 0.48);
  ctx.restore();
}

function drawWinOverlay(
  ctx: CanvasRenderingContext2D,
  style: RenderStyle,
  cssW: number,
  cssH: number,
): void {
  ctx.save();
  ctx.fillStyle = style.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.round(cssW * 0.09)}px Nunito, system-ui, sans-serif`;
  const word = randomWinWord(performance.now());
  ctx.fillText(word, cssW / 2, cssH * 0.4);
  ctx.fillStyle = style.lavender;
  ctx.font = `500 ${Math.round(cssW * 0.042)}px Nunito, system-ui, sans-serif`;
  ctx.fillText("tap anywhere for next level", cssW / 2, cssH * 0.48);
  ctx.restore();
}
