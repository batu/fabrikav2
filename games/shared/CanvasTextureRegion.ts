import Phaser from 'phaser';

/**
 * Partial GPU upload for a Phaser CanvasTexture.
 *
 * `CanvasTexture.refresh()` always re-uploads the whole canvas with
 * `texImage2D`. For the reveal mask that is a 24 MB upload on a 2532×2532
 * Bird level, measured at 120–160 ms per find on an iPhone 12 (2026-09-10),
 * even though a carve or an active reveal circle only touches a small
 * rectangle. This helper copies just that rectangle into a scratch canvas and
 * uploads it with `texSubImage2D`, mirroring the texture-unit and unpack state
 * handling of Phaser's WebGLTextureWrapper so the renderer's texture cache is
 * left exactly as it found it.
 *
 * Returns false when a partial upload is not possible (canvas renderer, lost
 * context, missing GL texture, empty or near-full rectangle); callers then
 * fall back to a full `refresh()`.
 */
export interface CanvasRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GlTextureLike {
  webGLTexture: WebGLTexture | null;
  flipY: boolean;
  pma: boolean;
  mipLevel: number;
  width: number;
  height: number;
}

/** Fraction of the canvas above which a full refresh is used instead. */
const FULL_REFRESH_AREA_FRACTION = 0.9;

let scratch: HTMLCanvasElement | null = null;
let uploadBytes = new Uint8Array(0);

function scratchCanvas(w: number, h: number): HTMLCanvasElement {
  if (scratch === null) scratch = document.createElement('canvas');
  // Keep readback bounded to the region. Resizing also clears the scratch.
  if (scratch.width !== w) scratch.width = w;
  if (scratch.height !== h) scratch.height = h;
  return scratch;
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

export function uploadCanvasTextureRegion(
  textures: Phaser.Textures.TextureManager,
  renderer: Phaser.Renderer.Canvas.CanvasRenderer | Phaser.Renderer.WebGL.WebGLRenderer,
  key: string,
  canvas: HTMLCanvasElement,
  region: CanvasRegion,
): boolean {
  if (renderer.type !== Phaser.WEBGL) return false;
  const gl = (renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl;
  if (!gl || gl.isContextLost()) return false;
  if (!textures.exists(key)) return false;
  const source = textures.get(key).source[0];
  const wrapper = (source as { glTexture?: GlTextureLike | null }).glTexture;
  if (!wrapper || !wrapper.webGLTexture) return false;
  // Only valid while the GL texture still matches the canvas dimensions.
  if (wrapper.width !== canvas.width || wrapper.height !== canvas.height) return false;

  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const w = Math.min(canvas.width - x, Math.ceil(region.w + (region.x - x)));
  const h = Math.min(canvas.height - y, Math.ceil(region.h + (region.y - y)));
  if (w <= 0 || h <= 0) return false;
  if (w * h >= canvas.width * canvas.height * FULL_REFRESH_AREA_FRACTION) return false;

  const view = scratchCanvas(w, h);
  // Android's canvas-source texSubImage2D path can invalidate pixels outside
  // the upload rectangle. Use explicit bytes, not a canvas/GPU copy, below.
  const ctx = view.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  const rgba = ctx.getImageData(0, 0, w, h).data;
  // Retain capacity as a reveal grows rather than allocating a second pixel
  // array every animation frame. getImageData already owns the source copy.
  if (uploadBytes.length < rgba.length) uploadBytes = new Uint8Array(2 ** Math.ceil(Math.log2(rgba.length)));
  const pixels = uploadBytes.subarray(0, rgba.length);
  // WebGL unpack flip/premultiply flags apply to DOM sources, not raw bytes.
  // Preserve the wrapper's orientation and alpha convention explicitly.
  for (let row = 0; row < h; row++) {
    const targetRow = wrapper.flipY ? h - row - 1 : row;
    for (let col = 0; col < w; col++) {
      const sourceIndex = (row * w + col) * 4;
      const targetIndex = (targetRow * w + col) * 4;
      const alpha = rgba[sourceIndex + 3];
      const factor = wrapper.pma ? alpha / 255 : 1;
      pixels[targetIndex] = Math.round(rgba[sourceIndex] * factor);
      pixels[targetIndex + 1] = Math.round(rgba[sourceIndex + 1] * factor);
      pixels[targetIndex + 2] = Math.round(rgba[sourceIndex + 2] * factor);
      pixels[targetIndex + 3] = alpha;
    }
  }

  // Mirror WebGLTextureWrapper._processTexture: unit 0, remember the binding,
  // use raw-byte unpack state, restore the binding afterwards.
  gl.activeTexture(gl.TEXTURE0);
  const previous = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.bindTexture(gl.TEXTURE_2D, wrapper.webGLTexture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  // With flipY the texture rows are bottom-up; convert the top-left canvas y.
  const destY = wrapper.flipY ? canvas.height - y - h : y;
  gl.texSubImage2D(gl.TEXTURE_2D, wrapper.mipLevel, x, destY, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  if (isPowerOfTwo(canvas.width) && isPowerOfTwo(canvas.height)) {
    // Phaser generated mipmaps for POT canvases at creation; keep them coherent.
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  gl.bindTexture(gl.TEXTURE_2D, previous);
  return true;
}

/** Test-only: drop the cached scratch canvas. */
export function resetCanvasTextureRegionScratchForTest(): void {
  scratch = null;
  uploadBytes = new Uint8Array(0);
}
