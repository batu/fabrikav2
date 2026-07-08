/**
 * Pack + level select menu — an overlay scene drawn on top of the
 * canvas. Two modes:
 *   "packs"  — 10 pack cards, tap to drill in
 *   "grid"   — 10 level tiles for the selected pack
 *
 * The menu replaces the board rendering while open; HUD stays
 * hidden. Called by loop.ts when `menu.isOpen` is true.
 */

import type { RenderStyle } from "./render.js";
import type { LevelPack } from "./levels-recipe.js";

export interface MenuHit {
  kind: "close" | "back" | "pack" | "level";
  packSlug?: string;
  levelIndex?: number;
}

export class Menu {
  isOpen = false;
  private mode: "packs" | "grid" = "packs";
  private expandedPack: string | null = null;

  open(): void {
    this.isOpen = true;
    this.mode = "packs";
    this.expandedPack = null;
  }

  close(): void {
    this.isOpen = false;
  }

  /** Tap handler. Returns what was hit so the caller can act. */
  onTap(
    px: number,
    py: number,
    cssW: number,
    cssH: number,
    packs: ReadonlyArray<LevelPack>,
    packProgress: Record<string, number>,
    highestUnlockedPackIdx: number,
  ): MenuHit | null {
    // Header: back/close button top-left.
    if (px < 80 && py < 80) {
      if (this.mode === "grid") {
        this.mode = "packs";
        this.expandedPack = null;
        return { kind: "back" };
      }
      this.close();
      return { kind: "close" };
    }

    if (this.mode === "packs") {
      // 2-column grid of pack cards.
      const layout = packLayout(cssW, cssH, packs.length);
      for (let i = 0; i < packs.length; i++) {
        const r = cardRect(layout, i);
        if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) {
          if (i > highestUnlockedPackIdx) return null; // locked
          this.mode = "grid";
          this.expandedPack = packs[i]!.slug;
          return { kind: "pack", packSlug: packs[i]!.slug };
        }
      }
      return null;
    }

    // grid mode
    const pack = packs.find((p) => p.slug === this.expandedPack);
    if (!pack) return null;
    const done = packProgress[pack.slug] ?? 0;
    const layout = gridLayout(cssW, cssH, pack.indices.length);
    for (let i = 0; i < pack.indices.length; i++) {
      const r = tileRect(layout, i);
      if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) {
        if (i > done) return null; // locked within pack (need to clear prior)
        return { kind: "level", packSlug: pack.slug, levelIndex: pack.indices[i]! + 1 };
      }
    }
    return null;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    style: RenderStyle,
    cssW: number,
    cssH: number,
    packs: ReadonlyArray<LevelPack>,
    packProgress: Record<string, number>,
    highestUnlockedPackIdx: number,
  ): void {
    ctx.save();
    ctx.fillStyle = style.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    // Close/back icon
    ctx.fillStyle = style.ink;
    ctx.font = `500 ${Math.round(cssW * 0.06)}px Nunito, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(this.mode === "grid" ? "←" : "✕", 20, 40);

    // Title
    ctx.textAlign = "center";
    ctx.font = `800 ${Math.round(cssW * 0.07)}px Nunito, system-ui, sans-serif`;
    ctx.fillStyle = style.ink;
    if (this.mode === "packs") {
      ctx.fillText("Packs", cssW / 2, 50);
    } else {
      const pack = packs.find((p) => p.slug === this.expandedPack);
      ctx.fillText(pack?.firstTitle ? packTitle(pack.slug) : "Levels", cssW / 2, 50);
    }

    if (this.mode === "packs") {
      drawPackCards(ctx, style, cssW, cssH, packs, packProgress, highestUnlockedPackIdx);
    } else {
      const pack = packs.find((p) => p.slug === this.expandedPack);
      if (pack) drawLevelGrid(ctx, style, cssW, cssH, pack, packProgress[pack.slug] ?? 0);
    }
    ctx.restore();
  }
}

function packTitle(slug: string): string {
  return slug.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

interface GridLayout {
  topY: number;
  cellW: number;
  cellH: number;
  gapX: number;
  gapY: number;
  cols: number;
  originX: number;
}

function packLayout(cssW: number, _cssH: number, _count: number): GridLayout {
  const cols = 2;
  const gapX = 16;
  const gapY = 16;
  const sidePad = 24;
  const cellW = (cssW - sidePad * 2 - gapX * (cols - 1)) / cols;
  const cellH = cellW * 0.55;
  return { topY: 110, cellW, cellH, gapX, gapY, cols, originX: sidePad };
}

function gridLayout(cssW: number, _cssH: number, _count: number): GridLayout {
  const cols = 5;
  const gapX = 10;
  const gapY = 10;
  const sidePad = 20;
  const cellW = (cssW - sidePad * 2 - gapX * (cols - 1)) / cols;
  const cellH = cellW;
  return { topY: 120, cellW, cellH, gapX, gapY, cols, originX: sidePad };
}

function cardRect(l: GridLayout, i: number): { x: number; y: number; w: number; h: number } {
  const col = i % l.cols, row = Math.floor(i / l.cols);
  return {
    x: l.originX + col * (l.cellW + l.gapX),
    y: l.topY + row * (l.cellH + l.gapY),
    w: l.cellW,
    h: l.cellH,
  };
}

function tileRect(l: GridLayout, i: number): { x: number; y: number; w: number; h: number } {
  return cardRect(l, i);
}

function drawPackCards(
  ctx: CanvasRenderingContext2D,
  style: RenderStyle,
  cssW: number,
  cssH: number,
  packs: ReadonlyArray<LevelPack>,
  packProgress: Record<string, number>,
  highestUnlockedPackIdx: number,
): void {
  const l = packLayout(cssW, cssH, packs.length);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < packs.length; i++) {
    const p = packs[i]!;
    const r = cardRect(l, i);
    const done = packProgress[p.slug] ?? 0;
    const total = p.indices.length;
    const locked = i > highestUnlockedPackIdx;
    const complete = done >= total;
    // Card background
    ctx.fillStyle = locked ? style.accentSoft : complete ? style.lavender : style.accentSoft;
    roundRect(ctx, r.x, r.y, r.w, r.h, 14);
    ctx.fill();
    // Title
    ctx.fillStyle = locked ? style.lavender : style.ink;
    ctx.font = `700 ${Math.round(r.h * 0.22)}px Nunito, system-ui, sans-serif`;
    ctx.fillText(packTitle(p.slug), r.x + r.w / 2, r.y + r.h * 0.4);
    // Progress
    ctx.font = `500 ${Math.round(r.h * 0.15)}px Nunito, system-ui, sans-serif`;
    ctx.fillStyle = locked ? style.lavender : style.ink;
    ctx.fillText(locked ? "🔒" : `${done}/${total}`, r.x + r.w / 2, r.y + r.h * 0.72);
  }
}

function drawLevelGrid(
  ctx: CanvasRenderingContext2D,
  style: RenderStyle,
  cssW: number,
  cssH: number,
  pack: LevelPack,
  done: number,
): void {
  const l = gridLayout(cssW, cssH, pack.indices.length);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < pack.indices.length; i++) {
    const r = tileRect(l, i);
    const cleared = i < done;
    const current = i === done;
    const locked = i > done;
    ctx.fillStyle = locked ? style.accentSoft : cleared ? style.lavender : style.accentSoft;
    roundRect(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.fill();
    if (current) {
      ctx.strokeStyle = style.ink;
      ctx.lineWidth = 2;
      roundRect(ctx, r.x, r.y, r.w, r.h, 10);
      ctx.stroke();
    }
    ctx.fillStyle = locked ? style.lavender : style.ink;
    ctx.font = `800 ${Math.round(r.h * 0.45)}px Nunito, system-ui, sans-serif`;
    ctx.fillText(locked ? "🔒" : cleared ? "✓" : String(i + 1), r.x + r.w / 2, r.y + r.h / 2);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
