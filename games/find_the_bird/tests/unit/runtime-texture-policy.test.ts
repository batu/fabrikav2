import { describe, expect, it } from 'vitest';

import {
  isSelectivePublicBundleMode,
  isNativeShellOrigin,
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

  it('never upgrades to color.png inside the native shell, where only the webp is bundled', () => {
    const original = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      value: { protocol: 'capacitor:', hostname: 'localhost' },
      configurable: true, writable: true,
    });
    try {
      expect(selectRuntimeColorImageUrl('levels/level-a/color.webp', 2560, 5600, 8192))
        .toBe('levels/level-a/color.webp');
    } finally {
      Object.defineProperty(globalThis, 'location', {
        value: original, configurable: true, writable: true,
      });
    }
  });

  it('never upgrades to an omitted color.png in a selective native build served as a web preview', () => {
    expect(isSelectivePublicBundleMode('ios')).toBe(true);
    expect(isSelectivePublicBundleMode('android')).toBe(true);
    expect(isSelectivePublicBundleMode('production')).toBe(false);
    expect(selectRuntimeColorImageUrl('levels/level-a/color.webp', 2560, 5600, 8192, false))
      .toBe('levels/level-a/color.webp');
  });

  it('classifies native shell origins without matching web dev servers', () => {
    expect(isNativeShellOrigin('capacitor:', 'localhost')).toBe(true);
    expect(isNativeShellOrigin('https:', 'localhost')).toBe(true);
    expect(isNativeShellOrigin('http:', 'localhost')).toBe(false);
    expect(isNativeShellOrigin('https:', 'game.example.com')).toBe(false);
    expect(isNativeShellOrigin(undefined, undefined)).toBe(false);
  });

  it('does not rewrite remote object URLs or sources without a higher-resolution tier', () => {
    expect(selectRuntimeColorImageUrl('blob:https://cdn.example/asset', 2560, 5600, 8192))
      .toBe('blob:https://cdn.example/asset');
    expect(selectRuntimeColorImageUrl('levels/level-a/color.webp', 1706, 2560, 8192))
      .toBe('levels/level-a/color.webp');
  });
});
