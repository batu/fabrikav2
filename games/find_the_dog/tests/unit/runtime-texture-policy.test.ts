import { describe, expect, it } from 'vitest';

import {
  setTexturePreservingDisplaySize,
  resolvePrefilteredTextureSize,
  resolvePrefilterSwitchZoom,
  resolveRuntimeTextureLongEdge,
  selectRuntimeColorImageUrl,
} from '../../src/scenes/RuntimeTexturePolicy';

describe('resolveRuntimeTextureLongEdge', () => {
  it('uses the WebGL texture limit when the renderer reports one', () => {
    expect(resolveRuntimeTextureLongEdge(8192)).toBe(8192);
    expect(resolveRuntimeTextureLongEdge(4096)).toBe(4096);
    expect(resolveRuntimeTextureLongEdge(2048)).toBe(2048);
  });

  it('retains the 2560 guard for Canvas, unknown, and invalid limits', () => {
    expect(resolveRuntimeTextureLongEdge(null)).toBe(2560);
    expect(resolveRuntimeTextureLongEdge(Number.NaN)).toBe(2560);
    expect(resolveRuntimeTextureLongEdge(0)).toBe(2560);
  });
});

describe('selectRuntimeColorImageUrl', () => {
  it('selects the bundled high-resolution source when WebGL can exceed the fallback tier', () => {
    expect(selectRuntimeColorImageUrl('levels/level-a/color.webp', 2560, 5600, 8192))
      .toBe('levels/level-a/color.png');
    expect(selectRuntimeColorImageUrl('levels/level-a/color.webp', 2560, 3840, 4096))
      .toBe('levels/level-a/color.png');
  });

  it('keeps the 2560 WebP fallback when capability cannot improve detail', () => {
    expect(selectRuntimeColorImageUrl('levels/level-a/color.webp', 2560, 5600, 2560))
      .toBe('levels/level-a/color.webp');
    expect(selectRuntimeColorImageUrl('levels/level-a/color.webp', 2560, 5600, 2048))
      .toBe('levels/level-a/color.webp');
    expect(selectRuntimeColorImageUrl('levels/level-a/color.webp', 2560, 5600, 4096))
      .toBe('levels/level-a/color.webp');
  });

  it('does not rewrite remote object URLs or sources without a higher-resolution tier', () => {
    expect(selectRuntimeColorImageUrl('blob:https://cdn.example/asset', 2560, 5600, 8192))
      .toBe('blob:https://cdn.example/asset');
    expect(selectRuntimeColorImageUrl('levels/level-a/color.webp', 1706, 2560, 8192))
      .toBe('levels/level-a/color.webp');
  });
});

describe('zoom prefilter policy', () => {
  it('keeps level-space display geometry invariant across resident texture tiers', () => {
    const image = {
      displayWidth: 1157,
      displayHeight: 2532,
      setTexture(): void {
        this.displayWidth = 2560;
        this.displayHeight = 5600;
      },
      setDisplaySize(width: number, height: number): void {
        this.displayWidth = width;
        this.displayHeight = height;
      },
    };

    setTexturePreservingDisplaySize(image, 'color');

    expect(image).toMatchObject({ displayWidth: 1157, displayHeight: 2532 });
  });

  it('sizes one aspect-preserving tier to the zoom-1 display footprint', () => {
    expect(resolvePrefilteredTextureSize(2560, 5600, 1157, 2532, 8192))
      .toEqual({ width: 1157, height: 2532 });
    expect(resolvePrefilteredTextureSize(2560, 3840, 1688, 2532, 8192))
      .toEqual({ width: 1688, height: 2532 });
  });

  it('does not upscale or exceed the measured texture limit', () => {
    expect(resolvePrefilteredTextureSize(1000, 2000, 1500, 3000, 8192))
      .toEqual({ width: 1000, height: 2000 });
    expect(resolvePrefilteredTextureSize(2560, 5600, 1157, 2532, 2048))
      .toEqual({ width: 936, height: 2048 });
  });

  it('switches at the geometric midpoint between the prefiltered and source tiers', () => {
    expect(resolvePrefilterSwitchZoom(5600, 2532)).toBeCloseTo(1.4872, 3);
    expect(resolvePrefilterSwitchZoom(2532, 2532)).toBe(1);
  });
});
