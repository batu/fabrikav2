import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fitBackground, layoutSanctuary, type SanctuaryManifest } from '../../src/sanctuary/layout';

const publicDir = join(process.cwd(), 'public');
const manifestFile = JSON.parse(
  readFileSync(join(publicDir, 'ui/sanctuary/manifest.json'), 'utf8'),
) as {
  sanctuary: SanctuaryManifest;
  collection: {
    cardFrame: { src: string; size: [number, number]; porthole: { cx: number; cy: number; r: number } };
    portraits: { sparrow: Record<string, string>; unknown: string };
  };
};

const manifest = manifestFile.sanctuary;
// iPhone 14/15 logical portrait size — the device this ships on.
const VIEWPORT = { width: 390, height: 844 };

describe('sanctuary asset manifest', () => {
  it('describes one background, three tiers and one bird set', () => {
    expect(manifest.background.size).toEqual([1024, 1536]);
    expect(manifest.houseTiers.map((tier) => tier.tier)).toEqual([1, 2, 3]);
    expect(Object.keys(manifest.birds.sparrow).sort()).toEqual(['cardigan', 'hat', 'plain']);
  });

  it('adds exactly one pedestal per tier', () => {
    expect(manifest.houseTiers.map((tier) => tier.pedestals.length)).toEqual([1, 2, 3]);
  });

  it('keeps every pedestal anchor inside its sprite', () => {
    for (const tier of manifest.houseTiers) {
      for (const pedestal of tier.pedestals) {
        expect(pedestal.anchor[0]).toBeGreaterThanOrEqual(0);
        expect(pedestal.anchor[0]).toBeLessThanOrEqual(tier.size[0]);
        expect(pedestal.anchor[1]).toBeGreaterThanOrEqual(0);
        expect(pedestal.anchor[1]).toBeLessThanOrEqual(tier.size[1]);
        expect(pedestal.width).toBeGreaterThan(0);
      }
    }
  });
});

describe('every manifest asset exists and is within budget', () => {
  const referenced = [
    manifest.background.src,
    ...manifest.houseTiers.map((tier) => tier.src),
    ...Object.values(manifest.birds.sparrow),
    ...Object.values(manifest.markers),
    manifestFile.collection.cardFrame.src,
    ...Object.values(manifestFile.collection.portraits.sparrow),
    manifestFile.collection.portraits.unknown,
  ];

  it.each(referenced)('%s is on disk', (src) => {
    expect(existsSync(join(publicDir, src.replace(/^\//, '')))).toBe(true);
  });

  it('keeps the whole set under 3 MB, so opening a page is not a download', () => {
    const bytes = referenced.reduce(
      (total, src) => total + statSync(join(publicDir, src.replace(/^\//, ''))).size,
      0,
    );
    expect(bytes).toBeLessThan(3 * 1024 * 1024);
  });
});

describe('background cover fit', () => {
  it('covers the viewport with no gap at any edge', () => {
    const { rect } = fitBackground(manifest, VIEWPORT);
    expect(rect.width).toBeGreaterThanOrEqual(VIEWPORT.width - 0.001);
    expect(rect.height).toBeGreaterThanOrEqual(VIEWPORT.height - 0.001);
    expect(rect.left).toBeLessThanOrEqual(0.001);
    expect(rect.top).toBeLessThanOrEqual(0.001);
    expect(rect.left + rect.width).toBeGreaterThanOrEqual(VIEWPORT.width - 0.001);
    expect(rect.top + rect.height).toBeGreaterThanOrEqual(VIEWPORT.height - 0.001);
  });

  it('keeps the branch band on screen on a short, wide viewport', () => {
    const short = { width: 900, height: 400 };
    const { rect, scale } = fitBackground(manifest, short);
    const [bandTop, bandBottom] = manifest.background.placementBand.y;
    expect(rect.top + bandTop * scale).toBeLessThan(short.height);
    expect(rect.top + bandBottom * scale).toBeGreaterThan(0);
  });
});

describe('layoutSanctuary', () => {
  it('shows only the plot marker when nothing is built', () => {
    const layout = layoutSanctuary(manifest, 0, VIEWPORT);
    expect(layout.house).toBeNull();
    expect(layout.pedestals).toEqual([]);
    expect(layout.plotMarker.width).toBeGreaterThan(0);
  });

  it('sits the house bbox bottom-centre on the manifest anchor', () => {
    const layout = layoutSanctuary(manifest, 1, VIEWPORT);
    const tier = manifest.houseTiers[0];
    const houseScale = layout.scale * manifest.houseAnchor.scale;
    const anchorX = layout.background.left + manifest.houseAnchor.x * layout.scale;
    const anchorY = layout.background.top + manifest.houseAnchor.bottom * layout.scale;
    const [x0, , x1, y1] = tier.bbox;

    const bboxCentreX = layout.house!.left + ((x0 + x1) / 2) * houseScale;
    const bboxBottomY = layout.house!.top + y1 * houseScale;
    expect(bboxCentreX).toBeCloseTo(anchorX, 6);
    expect(bboxBottomY).toBeCloseTo(anchorY, 6);
  });

  it('uses one scale for every tier, so the house never jumps size on upgrade', () => {
    const widths = [1, 2, 3].map((tier) => layoutSanctuary(manifest, tier, VIEWPORT).house!.width);
    expect(widths[0]).toBeCloseTo(widths[1], 6);
    expect(widths[1]).toBeCloseTo(widths[2], 6);
  });

  it('reproduces each manifest pedestal anchor in CSS pixels', () => {
    for (const tier of [1, 2, 3]) {
      const layout = layoutSanctuary(manifest, tier, VIEWPORT);
      const entry = manifest.houseTiers[tier - 1];
      const houseScale = layout.scale * manifest.houseAnchor.scale;
      expect(layout.pedestals).toHaveLength(entry.pedestals.length);
      entry.pedestals.forEach((pedestal, index) => {
        const actual = layout.pedestals[index];
        expect(actual.anchor.x).toBeCloseTo(layout.house!.left + pedestal.anchor[0] * houseScale, 6);
        expect(actual.anchor.y).toBeCloseTo(layout.house!.top + pedestal.anchor[1] * houseScale, 6);
        expect(actual.birdHeight).toBeCloseTo(pedestal.width * houseScale, 6);
      });
    }
  });

  it('centres the contact shadow on the feet and keeps it flat', () => {
    const [pedestal] = layoutSanctuary(manifest, 1, VIEWPORT).pedestals;
    expect(pedestal.shadow.left + pedestal.shadow.width / 2).toBeCloseTo(pedestal.anchor.x, 6);
    expect(pedestal.shadow.top + pedestal.shadow.height / 2).toBeCloseTo(pedestal.anchor.y, 6);
    expect(pedestal.shadow.height).toBeLessThan(pedestal.shadow.width / 2);
  });

  it('places the coin pile beside the house, not on top of it', () => {
    const layout = layoutSanctuary(manifest, 1, VIEWPORT);
    expect(layout.coinPile.left).toBeGreaterThan(layout.house!.left);
    expect(layout.coinPile.width).toBeGreaterThan(0);
  });

  it('keeps the house on screen at phone size', () => {
    const layout = layoutSanctuary(manifest, 3, VIEWPORT);
    expect(layout.house!.top).toBeLessThan(VIEWPORT.height);
    expect(layout.house!.top + layout.house!.height).toBeGreaterThan(0);
  });
});

describe('collection card geometry', () => {
  it('keeps the porthole inside the card', () => {
    const { size, porthole } = manifestFile.collection.cardFrame;
    expect(porthole.cx - porthole.r).toBeGreaterThanOrEqual(0);
    expect(porthole.cy - porthole.r).toBeGreaterThanOrEqual(0);
    expect(porthole.cx + porthole.r).toBeLessThanOrEqual(size[0]);
    expect(porthole.cy + porthole.r).toBeLessThanOrEqual(size[1]);
  });
});
