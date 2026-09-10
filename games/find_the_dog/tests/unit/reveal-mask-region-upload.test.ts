import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards for the 2026-09-10 restoration pickup stall (fabrikav2 PR #70).
 *
 * `CanvasTexture.refresh()` re-uploads the whole reveal mask (24 MB on a
 * 2532² Bird level, 119–159 ms per find on an iPhone 12). The scene must
 * upload only the rectangle it changed: the carved polygons on a find and the
 * active dissolve cells per frame. These tests drive the real GameScene
 * methods and assert that the region path is taken and the full refresh is
 * only the fallback.
 */
vi.mock('phaser', () => {
  class CanvasTexture {
    canvas: unknown;
    refresh = vi.fn();
    constructor(canvas: unknown) { this.canvas = canvas; }
  }
  class Point { constructor(public x: number, public y: number) {} }
  return { default: {
    Scene: class {},
    Core: { Events: { POST_RENDER: 'postrender' } },
    Textures: { CanvasTexture },
    Geom: { Point },
    WEBGL: 2,
  } };
});
vi.mock('../../../shared/ClassicGpuReveal', () => ({ ClassicGpuReveal: class {} }));
vi.mock('../../../shared/CanvasTextureRegion', () => ({ uploadCanvasTextureRegion: vi.fn(() => true) }));
vi.mock('../../src/core/GameState', () => ({ gameState: { settings: { adsEnabled: false } } }));
vi.mock('../../src/analytics/AnalyticsService', () => ({ analytics: { experimentExposure: vi.fn() } }));
vi.mock('../../src/data/revealPickupExperiment', () => ({ revealPickupExperiment: {
  assignment: vi.fn(() => ({ arm: 'reveal_image' })),
  exposure: vi.fn(() => ({ arm: 'reveal_image' })),
} }));
vi.mock('../../src/ads/Service', () => ({ adService: {}, showRewardedAdForEconomy: vi.fn() }));
vi.mock('../../src/audio/AudioManager', () => ({ playFind: vi.fn(), playWrongTap: vi.fn(), preloadDogFoundSounds: vi.fn() }));
vi.mock('../../src/audio/AmbientManager', () => ({ crossfadeTo: vi.fn(), presetForLevel: vi.fn() }));
vi.mock('../../src/config/RemoteConfigService', () => ({ remoteConfigService: { value: vi.fn() } }));
vi.mock('../../src/shop/IapService', () => ({ iapService: {} }));
vi.mock('../../src/ui/SceneTransitionCover', () => ({
  hidePlayEntryTransitionCoverAfterSceneRender: vi.fn(),
  hideSceneTransitionCoverAfterPaint: vi.fn(), showSceneTransitionCover: vi.fn(),
}));

import Phaser from 'phaser';
import { GameScene } from '../../src/scenes/GameScene';
import { uploadCanvasTextureRegion } from '../../../shared/CanvasTextureRegion';

interface Rect { x: number; y: number; w: number; h: number }

interface Internals {
  syncRestorationMaskTexture(region?: Rect | null): void;
  refreshRevealMask(rect?: Rect | null): { maskRefreshMs: number; cpuCompositeMs: number };
  refreshCanvasTexture(key: string, region?: Rect | null): void;
  redrawComposite(rect: Rect | null): void;
  spawnRestorationDissolve(dog: unknown): void;
  restorationDissolvePolygons(dog: unknown): Array<Array<{ x: number; y: number }>>;
  levelRectForPolygon(points: unknown): Rect | null;
  carvePermanentDissolveCell(points: unknown): void;
  onRevealedCellComplete(): void;
  recordRevealFrame(...args: unknown[]): void;
  tracePolygonPath(...args: unknown[]): void;
}

function fixture() {
  const scene = new GameScene();
  const maskCanvas = { width: 200, height: 300 };
  const maskCtx = {
    clearRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), fill: vi.fn(),
    globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: '',
  };
  const permanentCanvas = { width: 200, height: 300 };
  const revealMask = new Phaser.Textures.CanvasTexture(maskCanvas);
  Object.assign(scene, {
    level: { id: 'level-1', width: 200, height: 300, dogs: [] },
    game: { events: { on: vi.fn(), off: vi.fn(), once: vi.fn() }, renderer: { type: 2 } },
    textures: { exists: (key: string) => key === 'reveal_mask', get: () => revealMask },
    maskCanvas, maskCtx, permanentCanvas, permanentCtx: maskCtx,
    isRestoration: true, classicUsesPatchComposite: false, classicUsesCpuComposite: false,
    classicGpuReveal: null, imgOffsetX: 0, imgOffsetY: 0, imgScale: 1,
    dissolveActiveCells: [], dissolveCompletedCells: [],
  });
  const internals = scene as unknown as Internals;
  vi.spyOn(internals, 'recordRevealFrame').mockImplementation(() => {});
  vi.spyOn(internals, 'tracePolygonPath').mockImplementation(() => {});
  return { scene, internals, maskCtx, revealMask };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('restoration reveal-mask uploads', () => {
  it('a carve copies and uploads only the carved rectangle', () => {
    const f = fixture();
    const region = { x: 10, y: 20, w: 30, h: 40 };
    f.internals.syncRestorationMaskTexture(region);
    expect(f.maskCtx.clearRect).toHaveBeenCalledWith(10, 20, 30, 40);
    expect(f.maskCtx.drawImage).toHaveBeenCalledWith(expect.anything(), 10, 20, 30, 40, 10, 20, 30, 40);
    expect(uploadCanvasTextureRegion).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'reveal_mask', expect.anything(), region);
    expect(f.revealMask.refresh).not.toHaveBeenCalled();
  });

  it('a full sync (no region) still re-uploads the whole mask', () => {
    const f = fixture();
    f.internals.syncRestorationMaskTexture(null);
    expect(f.maskCtx.clearRect).toHaveBeenCalledWith(0, 0, 200, 300);
    expect(uploadCanvasTextureRegion).not.toHaveBeenCalled();
    expect(f.revealMask.refresh).toHaveBeenCalledTimes(1);
  });

  it('falls back to a full refresh when a partial upload is refused', () => {
    const f = fixture();
    vi.mocked(uploadCanvasTextureRegion).mockReturnValueOnce(false);
    f.internals.refreshCanvasTexture('reveal_mask', { x: 0, y: 0, w: 5, h: 5 });
    expect(f.revealMask.refresh).toHaveBeenCalledTimes(1);
  });

  it('a find passes the carved polygons\' rectangle to the sync, never a full upload', () => {
    const f = fixture();
    vi.spyOn(f.internals, 'restorationDissolvePolygons').mockReturnValue([
      [{ x: 50, y: 60 }, { x: 70, y: 60 }, { x: 70, y: 90 }],
    ]);
    vi.spyOn(f.internals, 'levelRectForPolygon').mockReturnValue({ x: 50, y: 60, w: 20, h: 30 });
    vi.spyOn(f.internals, 'carvePermanentDissolveCell').mockImplementation(() => {});
    vi.spyOn(f.internals, 'onRevealedCellComplete').mockImplementation(() => {});
    const sync = vi.spyOn(f.internals, 'syncRestorationMaskTexture');
    f.internals.spawnRestorationDissolve({ id: 'dog_00' });
    expect(sync).toHaveBeenCalledTimes(1);
    const region = sync.mock.calls[0][0] as Rect;
    expect(region).not.toBeNull();
    // Bounds the polygon (50..70 × 60..90) with padding, and is far from the full mask.
    expect(region.x).toBeLessThanOrEqual(50);
    expect(region.y).toBeLessThanOrEqual(60);
    expect(region.x + region.w).toBeGreaterThanOrEqual(70);
    expect(region.y + region.h).toBeGreaterThanOrEqual(90);
    expect(region.w * region.h).toBeLessThan(200 * 300 / 4);
  });

  it('an active dissolve frame uploads the rectangle it redrew, not the whole mask', () => {
    const f = fixture();
    Object.assign(f.scene, { dissolveActiveCells: [{ screenPoints: [{ x: 20, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 50 }], alpha: 0.5 }] });
    const refresh = vi.spyOn(f.internals, 'refreshRevealMask').mockReturnValue({ maskRefreshMs: 0, cpuCompositeMs: 0 });
    f.internals.redrawComposite(null);
    expect(refresh).toHaveBeenCalledTimes(1);
    const rect = refresh.mock.calls[0][0] as Rect;
    expect(rect).not.toBeNull();
    expect(rect.w * rect.h).toBeLessThan(200 * 300 / 4);
  });
});
