import { describe, expect, test } from 'vitest';

import { createResponsiveLayout } from './responsive.ts';

describe('createResponsiveLayout', (): void => {
  test('builds a contain layout for portrait games', (): void => {
    const layout = createResponsiveLayout({
      deviceWidth: 390,
      deviceHeight: 844,
      devicePixelRatio: 3,
      orientation: 'portrait',
      fitMode: 'contain',
    });

    expect(layout.dpr).toBe(2);
    expect(layout.isPortrait).toBe(true);
    expect(layout.designWidth).toBe(540);
    expect(layout.designHeight).toBe(960);
    expect(layout.canvasWidth).toBe(780);
    expect(layout.canvasHeight).toBe(1387);
    expect(layout.px).toBeCloseTo(780 / 540, 6);
  });

  test('builds a cover layout for portrait games', (): void => {
    const layout = createResponsiveLayout({
      deviceWidth: 430,
      deviceHeight: 932,
      devicePixelRatio: 2,
      orientation: 'portrait',
      fitMode: 'cover',
    });

    expect(layout.canvasWidth).toBe(1049);
    expect(layout.canvasHeight).toBe(1864);
  });

  test('supports auto landscape detection', (): void => {
    const layout = createResponsiveLayout({
      deviceWidth: 960,
      deviceHeight: 540,
      devicePixelRatio: 1,
      orientation: 'auto',
      fitMode: 'contain',
    });

    expect(layout.isPortrait).toBe(false);
    expect(layout.designWidth).toBe(960);
    expect(layout.designHeight).toBe(540);
    expect(layout.canvasWidth).toBe(960);
    expect(layout.canvasHeight).toBe(540);
    expect(layout.px).toBe(1);
  });
});
