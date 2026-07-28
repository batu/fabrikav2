import type Phaser from 'phaser';
import { gameState } from '../core/GameState';

/**
 * Dev-only screenshot capture, wired into the 4-tap debug panel.
 *
 * Flow on press:
 *   1. Ask Phaser renderer for a canvas snapshot (async — WebGL needs a frame).
 *   2. Convert to base64 PNG.
 *   3. On native: write to Documents/ and raise a share sheet (user can save
 *      to Photos/gallery via the system share action — cleaner than wiring
 *      MediaStore directly, and works on Android 11+ without legacy
 *      WRITE_EXTERNAL_STORAGE).
 *   4. On web: trigger a browser download via a transient <a download>.
 *
 * Only rendered in DEV builds — prod users never see this button.
 */

function snapshotGame(game: Phaser.Game): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    game.renderer.snapshot((img: HTMLImageElement | Phaser.Display.Color): void => {
      if (img instanceof HTMLImageElement) resolve(img);
      else reject(new Error('Phaser snapshot returned a Color instead of an Image'));
    });
  });
}

function imageToPngBase64(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(img, 0, 0);
  // toDataURL → 'data:image/png;base64,...' — strip the prefix.
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.replace(/^data:image\/png;base64,/, '');
}

function buildFilename(game: Phaser.Game): string {
  const scene = game.scene.getScene('GameScene') as { getLevel?: () => { id: string } | null } | null;
  const levelId = scene?.getLevel?.()?.id ?? 'unknown';
  const now = new Date();
  const stamp =
    `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}` +
    `_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const foundCount = gameState.foundDogIds.size;
  return `ftd_${levelId}_found${foundCount}_${stamp}.png`;
}

function captureWeb(filename: string, base64: string): void {
  const a = document.createElement('a');
  a.href = `data:image/png;base64,${base64}`;
  a.download = filename;
  a.click();
}

/** Result surfaced back to the debug panel for status text. */
export interface CaptureResult {
  filename: string;
  path?: string;
  error?: string;
}

export async function captureScreenshot(game: Phaser.Game): Promise<CaptureResult> {
  const filename = buildFilename(game);
  try {
    const img = await snapshotGame(game);
    const base64 = imageToPngBase64(img);
    captureWeb(filename, base64);
    return { filename };
  } catch (e) {
    return { filename, error: (e as Error).message ?? 'unknown' };
  }
}
