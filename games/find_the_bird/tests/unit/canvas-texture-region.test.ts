import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { WEBGL: 2, CANVAS: 1 } }));

import {
  resetCanvasTextureRegionScratchForTest,
  uploadCanvasTextureRegion,
} from '../../../shared/CanvasTextureRegion';

interface FakeGl {
  calls: Array<[string, ...unknown[]]>;
  TEXTURE0: number; TEXTURE_2D: number; TEXTURE_BINDING_2D: number; RGBA: number; UNSIGNED_BYTE: number;
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: number; UNPACK_FLIP_Y_WEBGL: number;
  isContextLost(): boolean;
  activeTexture(unit: number): void;
  getParameter(name: number): unknown;
  bindTexture(target: number, texture: unknown): void;
  pixelStorei(name: number, value: unknown): void;
  texSubImage2D(...args: unknown[]): void;
  generateMipmap(target: number): void;
}

function fixture(options: { width?: number; height?: number; flipY?: boolean; pma?: boolean; lost?: boolean; webgl?: boolean } = {}) {
  const width = options.width ?? 2532;
  const height = options.height ?? 2532;
  const previousBinding = { id: 'previous' };
  const webGLTexture = { id: 'mask' };
  const gl: FakeGl = {
    calls: [],
    TEXTURE0: 33984, TEXTURE_2D: 3553, TEXTURE_BINDING_2D: 32873, RGBA: 6408, UNSIGNED_BYTE: 5121,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441, UNPACK_FLIP_Y_WEBGL: 37440,
    isContextLost: () => options.lost === true,
    activeTexture: (unit) => { gl.calls.push(['activeTexture', unit]); },
    getParameter: () => previousBinding,
    bindTexture: (target, texture) => { gl.calls.push(['bindTexture', target, texture]); },
    pixelStorei: (name, value) => { gl.calls.push(['pixelStorei', name, value]); },
    texSubImage2D: (...args) => { gl.calls.push(['texSubImage2D', ...args]); },
    generateMipmap: (target) => { gl.calls.push(['generateMipmap', target]); },
  };
  const canvas = { width, height } as HTMLCanvasElement;
  const wrapper = { webGLTexture, flipY: options.flipY ?? false, pma: options.pma ?? false, mipLevel: 0, width, height };
  const textures = {
    exists: (key: string) => key === 'reveal_mask',
    get: () => ({ source: [{ glTexture: wrapper }] }),
  } as unknown as Phaser.Textures.TextureManager;
  const renderer = { type: options.webgl === false ? 1 : 2, gl } as unknown as Phaser.Renderer.WebGL.WebGLRenderer;
  return { gl, canvas, textures, renderer, previousBinding, webGLTexture };
}

describe('uploadCanvasTextureRegion', () => {
  afterEach(() => {
    resetCanvasTextureRegionScratchForTest();
  });

  it('uploads only the clipped region and restores the previous texture binding', () => {
    const f = fixture();
    const scratchDraw = vi.fn();
    const getContext = vi.fn(() => ({
      setTransform: vi.fn(), drawImage: scratchDraw, globalCompositeOperation: 'source-over',
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    }));
    vi.spyOn(document, 'createElement').mockImplementation(() => ({
      width: 0,
      height: 0,
      getContext,
    }) as unknown as HTMLCanvasElement);

    const ok = uploadCanvasTextureRegion(f.textures, f.renderer, 'reveal_mask', f.canvas, { x: -3.5, y: 10.2, w: 100, h: 50.4 });

    expect(ok).toBe(true);
    expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    // Clipped to the canvas: x from -3.5 -> 0, width shrinks accordingly.
    expect(scratchDraw).toHaveBeenCalledWith(f.canvas, 0, 10, 97, 51, 0, 0, 97, 51);
    const sub = f.gl.calls.find((c) => c[0] === 'texSubImage2D');
    expect(sub?.slice(1, 5)).toEqual([f.gl.TEXTURE_2D, 0, 0, 10]);
    expect(sub?.slice(5, 9)).toEqual([97, 51, f.gl.RGBA, f.gl.UNSIGNED_BYTE]);
    expect(sub?.[9]).toBeInstanceOf(Uint8Array);
    const binds = f.gl.calls.filter((c) => c[0] === 'bindTexture').map((c) => c[2]);
    expect(binds).toEqual([f.webGLTexture, f.previousBinding]);
    // Non power-of-two canvas: no mipmap regeneration.
    expect(f.gl.calls.some((c) => c[0] === 'generateMipmap')).toBe(false);
    vi.restoreAllMocks();
  });

  it('converts the row offset when the texture is stored flipped', () => {
    const f = fixture({ flipY: true, width: 1000, height: 800 });
    vi.spyOn(document, 'createElement').mockImplementation(() => ({
      width: 0, height: 0,
      getContext: () => ({ setTransform: vi.fn(), drawImage: vi.fn(), globalCompositeOperation: 'source-over', getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) }),
    }) as unknown as HTMLCanvasElement);
    expect(uploadCanvasTextureRegion(f.textures, f.renderer, 'reveal_mask', f.canvas, { x: 10, y: 20, w: 30, h: 40 })).toBe(true);
    const sub = f.gl.calls.find((c) => c[0] === 'texSubImage2D');
    expect(sub?.slice(3, 5)).toEqual([10, 800 - 20 - 40]);
    vi.restoreAllMocks();
  });

  it.each([false, true])('uploads exact RGBA bytes with premultiplication and flipped rows=%s', (flipY) => {
    const f = fixture({ flipY, pma: true, width: 100, height: 100 });
    const rgba = new Uint8ClampedArray([200, 100, 50, 128, 20, 40, 60, 255]);
    vi.spyOn(document, 'createElement').mockImplementation(() => ({
      width: 0, height: 0,
      getContext: () => ({ setTransform: vi.fn(), drawImage: vi.fn(), getImageData: () => ({ data: rgba }), globalCompositeOperation: 'source-over' }),
    }) as unknown as HTMLCanvasElement);
    uploadCanvasTextureRegion(f.textures, f.renderer, 'reveal_mask', f.canvas, { x: 3, y: 4, w: 1, h: 2 });
    const upload = f.gl.calls.find((c) => c[0] === 'texSubImage2D')!;
    expect(Array.from(upload[9] as Uint8Array)).toEqual(flipY
      ? [20, 40, 60, 255, 100, 50, 25, 128]
      : [100, 50, 25, 128, 20, 40, 60, 255]);
    expect(upload.slice(3, 7)).toEqual([3, flipY ? 94 : 4, 1, 2]);
    expect(Array.from(rgba)).toEqual([200, 100, 50, 128, 20, 40, 60, 255]);
    vi.restoreAllMocks();
  });

  it('falls back (returns false) for canvas renderer, lost context, missing texture, empty or near-full regions', () => {
    const full = fixture();
    expect(uploadCanvasTextureRegion(fixture({ webgl: false }).textures, fixture({ webgl: false }).renderer, 'reveal_mask', full.canvas, { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
    const lost = fixture({ lost: true });
    expect(uploadCanvasTextureRegion(lost.textures, lost.renderer, 'reveal_mask', lost.canvas, { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
    expect(uploadCanvasTextureRegion(full.textures, full.renderer, 'missing', full.canvas, { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
    expect(uploadCanvasTextureRegion(full.textures, full.renderer, 'reveal_mask', full.canvas, { x: 5000, y: 0, w: 10, h: 10 })).toBe(false);
    expect(uploadCanvasTextureRegion(full.textures, full.renderer, 'reveal_mask', full.canvas, { x: 0, y: 0, w: 2532, h: 2532 })).toBe(false);
    expect(full.gl.calls.some((c) => c[0] === 'texSubImage2D')).toBe(false);
  });
});
