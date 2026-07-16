import type Phaser from 'phaser';
import { formatDuration } from './format';

/**
 * Composite the current Phaser scene + a caption into a shareable PNG,
 * then fire the system share sheet (native) or a browser download (web).
 *
 * Caption format:
 *   "I found all N dogs in <level> in M:SS"
 *
 * Extends the dev-only ScreenshotCapture pattern to a player-facing surface.
 * The composite adds ~160px of caption strip at the bottom of the snapshot
 * so the shared image tells the whole story at a glance.
 */

export interface ShareWinContext {
  levelName: string;
  dogsFound: number;
  timeSeconds: number;
}

function snapshotGame(game: Phaser.Game): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    game.renderer.snapshot((img: HTMLImageElement | Phaser.Display.Color): void => {
      if (img instanceof HTMLImageElement) resolve(img);
      else reject(new Error('Phaser snapshot returned a Color instead of an Image'));
    });
  });
}

/**
 * Compose a PNG: the Phaser snapshot on top, a cream caption strip below.
 * Width matches the snapshot; height = snapshot + caption strip.
 */
function composeCaptioned(img: HTMLImageElement, ctx: ShareWinContext): string {
  const sceneW = img.naturalWidth || img.width;
  const sceneH = img.naturalHeight || img.height;
  const captionH = Math.max(160, Math.round(sceneW * 0.16));

  const canvas = document.createElement('canvas');
  canvas.width = sceneW;
  canvas.height = sceneH + captionH;
  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('2D context unavailable');

  c2d.drawImage(img, 0, 0, sceneW, sceneH);

  // Caption strip — cream background with warm border accent on top
  c2d.fillStyle = '#f5f0e8';
  c2d.fillRect(0, sceneH, sceneW, captionH);
  c2d.fillStyle = '#c97b4a';
  c2d.fillRect(0, sceneH, sceneW, 6);

  // Title line
  c2d.fillStyle = '#2a2a2a';
  c2d.textAlign = 'center';
  c2d.textBaseline = 'middle';
  const titleSize = Math.round(captionH * 0.30);
  c2d.font = `900 ${titleSize}px "Nunito", system-ui, sans-serif`;
  c2d.fillText(
    `I found all ${ctx.dogsFound} dogs in ${ctx.levelName}`,
    sceneW / 2,
    sceneH + captionH * 0.40,
  );

  // Subline — time + game name
  const subSize = Math.round(captionH * 0.22);
  c2d.font = `700 ${subSize}px "Nunito", system-ui, sans-serif`;
  c2d.fillStyle = '#555';
  c2d.fillText(
    `in ${formatDuration(ctx.timeSeconds)} • Find the Dog`,
    sceneW / 2,
    sceneH + captionH * 0.76,
  );

  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.replace(/^data:image\/png;base64,/, '');
}

function buildFilename(ctx: ShareWinContext): string {
  const safeName = ctx.levelName.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
  return `shell_template_${safeName}_${ctx.dogsFound}dogs.png`;
}

function shareWeb(filename: string, base64: string): void {
  const a = document.createElement('a');
  a.href = `data:image/png;base64,${base64}`;
  a.download = filename;
  a.click();
}

/**
 * Ensure the caption's Nunito webfont is loaded before we rasterise — without
 * this, the first share of a session can fall back to system-ui, giving the
 * shared image a different typeface than the in-app brand. `document.fonts`
 * is the Font Loading API; `.load()` rejects silently go to the fallback.
 */
async function ensureCaptionFont(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await document.fonts.load('900 48px "Nunito"');
    await document.fonts.load('700 32px "Nunito"');
  } catch {
    // System fallback is acceptable; never block the share on font failure.
  }
}

/** Build the shareable PNG and raise the share UI. Throws on render failure. */
export async function shareWinScreen(game: Phaser.Game, ctx: ShareWinContext): Promise<void> {
  await ensureCaptionFont();
  const img = await snapshotGame(game);
  const base64 = composeCaptioned(img, ctx);
  const filename = buildFilename(ctx);
  shareWeb(filename, base64);
}
