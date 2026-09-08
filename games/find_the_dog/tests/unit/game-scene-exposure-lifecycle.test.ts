import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {}, Core: { Events: { POST_RENDER: 'postrender' } } } }));
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

import { GameScene } from '../../src/scenes/GameScene';
import { analytics } from '../../src/analytics/AnalyticsService';
import { revealPickupExperiment } from '../../src/data/revealPickupExperiment';
import { hideSceneTransitionCoverAfterPaint } from '../../src/ui/SceneTransitionCover';

// Invoke the production create/setup boundary, not experiment.exposure directly.
// Phaser rendering is represented only by its real event-emitter contract.
function fixture() {
  const scene = new GameScene();
  const events = new EventEmitter();
  const sceneEvents = new EventEmitter();
  const start = vi.fn();
  const textures = new Set<string>();
  Object.assign(scene, {
    level: { id: 'level-1', width: 100, height: 100, dogs: [] },
    game: { events, renderer: {} }, events: sceneEvents,
    sys: { isActive: () => true }, scene: { start },
    textures: { exists: (key: string) => textures.has(key) },
  });
  const internals = scene as unknown as {
    isRestorationMode(): boolean;
    scheduleNonCriticalPreloads(): void;
    setupLevel(): void;
    generateGrayscaleTexture(): void;
    capTextureLongEdge(key: string): void;
  };
  vi.spyOn(internals, 'isRestorationMode').mockReturnValue(false);
  vi.spyOn(internals, 'scheduleNonCriticalPreloads').mockImplementation(() => {});
  return { scene, internals, events, sceneEvents, start, textures };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});

afterEach(() => { vi.restoreAllMocks(); });

function readyFixture() {
  const f = fixture();
  // Rendering setup is orthogonal to create's production POST_RENDER gate.
  // The asset-failure tests below retain the real setupLevel implementation.
  vi.spyOn(f.internals, 'setupLevel').mockImplementation(() => {});
  f.textures.add('color');
  f.textures.add('bw_generated');
  return f;
}

describe('GameScene grayscale allocation', () => {
  it('preserves grayscale pixels and alpha while bounding readbacks and keeping the texture static', () => {
    const f = fixture();
    const source = { width: 2, height: 130 };
    const addFrame = vi.fn();
    const create = vi.fn(() => ({ add: addFrame }));
    Object.assign(f.scene, { textures: { exists: () => false, create } });
    const internals = f.scene as unknown as { getCanvasSourceImage(key: string): CanvasImageSource };
    vi.spyOn(internals, 'getCanvasSourceImage').mockReturnValue(source as CanvasImageSource);
    const writes: Array<{ y: number; pixels: Uint8ClampedArray }> = [];
    const output = { width: 0, height: 0, getContext: () => ({
      putImageData: (data: ImageData, _x: number, y: number) => writes.push({ y, pixels: data.data.slice() }),
    }) };
    const reads: number[] = [];
    const scratch = { width: 0, height: 0, getContext: () => ({
      clearRect: vi.fn(), drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, width: number, height: number) => {
        reads.push(height);
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) data.set([255, 0, 0, 123], i);
        return { data };
      },
    }) };
    vi.spyOn(document, 'createElement')
      .mockReturnValueOnce(output as unknown as HTMLCanvasElement)
      .mockReturnValueOnce(scratch as unknown as HTMLCanvasElement);
    f.internals.generateGrayscaleTexture();
    expect([output.width, output.height]).toEqual([2, 130]);
    expect(Math.max(...reads)).toBeLessThanOrEqual(64);
    expect(reads.reduce((sum, height) => sum + height, 0)).toBe(130);
    expect(writes.map(({ y }) => y)).toEqual([0, 64, 128]);
    for (const { pixels } of writes) {
      for (let i = 0; i < pixels.length; i += 4) expect([...pixels.slice(i, i + 4)]).toEqual([54, 54, 54, 123]);
    }
    expect(create).toHaveBeenCalledWith('bw_generated', output);
    expect(addFrame).toHaveBeenCalledWith('__BASE', 0, 0, 0, 2, 130);
    expect([scratch.width, scratch.height]).toEqual([0, 0]);
  });
});

describe('GameScene reveal exposure lifecycle', () => {
  it('allows the GPU grayscale path to present using only its shared color source', () => {
    const f = readyFixture();
    Object.assign(f.scene, { usesGpuGrayscale: true });
    f.textures.delete('bw_generated');
    f.scene.create();
    f.events.emit('postrender');
    expect(revealPickupExperiment.exposure).toHaveBeenCalledTimes(1);
  });

  it('waits for a visible, uncovered POST_RENDER then emits exactly once and removes both listeners', () => {
    const f = readyFixture();
    f.scene.create();
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    f.events.emit('postrender');
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.body.innerHTML = '<div id="scene-transition-cover"></div>';
    f.events.emit('postrender');
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
    document.body.innerHTML = '';
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
    f.events.emit('postrender');
    f.events.emit('postrender');
    expect(revealPickupExperiment.exposure).toHaveBeenCalledExactlyOnceWith('classic');
    expect(analytics.experimentExposure).toHaveBeenCalledTimes(1);
    expect(f.events.listenerCount('postrender')).toBe(0);
    expect(f.sceneEvents.listenerCount('shutdown')).toBe(0);
  });

  it.each(['color', 'bw_generated'])('does not expose when %s is absent at the presented frame', (key) => {
    const f = readyFixture();
    f.scene.create();
    f.textures.delete(key);
    f.events.emit('postrender');
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
    f.sceneEvents.emit('shutdown');
    expect(f.events.listenerCount('postrender')).toBe(0);
    expect(f.sceneEvents.listenerCount('shutdown')).toBe(0);
  });

  it('shutdown before a presented frame cancels exposure and cleans up', () => {
    const f = readyFixture();
    f.scene.create();
    f.sceneEvents.emit('shutdown');
    f.events.emit('postrender');
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
    expect(f.events.listenerCount('postrender')).toBe(0);
    expect(f.sceneEvents.listenerCount('shutdown')).toBe(0);
  });

  it('does not expose an inactive scene or a scene entering shutdown', () => {
    const f = readyFixture();
    f.scene.create();
    Object.assign(f.scene.sys, { isActive: () => false });
    f.events.emit('postrender');
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
    Object.assign(f.scene.sys, { isActive: () => true });
    Object.assign(f.scene, { isShuttingDown: true });
    f.events.emit('postrender');
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
    f.sceneEvents.emit('shutdown');
    expect(f.events.listenerCount('postrender')).toBe(0);
  });

  it('a setup exception cannot install a pending exposure or schedule preloads', () => {
    const f = readyFixture();
    const error = new Error('setup failed');
    vi.spyOn(f.internals, 'setupLevel').mockImplementation(() => { throw error; });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    f.scene.create();
    f.events.emit('postrender');
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
    expect(f.internals.scheduleNonCriticalPreloads).not.toHaveBeenCalled();
    expect(f.events.listenerCount('postrender')).toBe(0);
    expect(f.sceneEvents.listenerCount('shutdown')).toBe(0);
    expect(f.start).toHaveBeenCalledWith('HomeScene');
  });

  it('restarting after shutdown installs only the new frame observer', () => {
    const f = readyFixture();
    f.scene.create();
    f.sceneEvents.emit('shutdown');
    f.scene.create();
    expect(f.events.listenerCount('postrender')).toBe(1);
    f.events.emit('postrender');
    expect(analytics.experimentExposure).toHaveBeenCalledTimes(1);
    expect(f.sceneEvents.listenerCount('shutdown')).toBe(0);
  });

  it('does not install observers when unenrolled', () => {
    const f = readyFixture();
    vi.mocked(revealPickupExperiment.assignment).mockReturnValueOnce(null);
    f.scene.create();
    f.events.emit('postrender');
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
    expect(f.events.listenerCount('postrender')).toBe(0);
    expect(f.sceneEvents.listenerCount('shutdown')).toBe(0);
  });

  it('cleans up even when the experiment has already been exposed', () => {
    const f = readyFixture();
    vi.mocked(revealPickupExperiment.exposure).mockReturnValueOnce(null);
    f.scene.create();
    f.events.emit('postrender');
    expect(analytics.experimentExposure).not.toHaveBeenCalled();
    expect(f.events.listenerCount('postrender')).toBe(0);
    expect(f.sceneEvents.listenerCount('shutdown')).toBe(0);
  });

  it.each(['background', 'sprite'])('keeps strict pickup %s checks with no reveal fallback', (missing) => {
    const f = fixture();
    Object.assign(f.scene, { level: { id: 'level-1', width: 100, height: 100,
      bgImageUrls: ['bg.png'], dogs: [{ id: 'dog-1', sprite: { image: 'dog.png' } }],
    } });
    vi.spyOn(f.internals, 'isRestorationMode').mockReturnValue(true);
    if (missing === 'sprite') f.textures.add('bg_0');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    f.scene.create();
    expect(console.error).toHaveBeenCalledWith('Failed to set up level', expect.objectContaining({
      message: expect.stringContaining(missing === 'background' ? 'missing loaded background' : 'missing loaded dog sprite'),
    }));
    expect(f.start).toHaveBeenCalledWith('HomeScene');
    f.events.emit('postrender');
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
    expect(f.events.listenerCount('postrender')).toBe(0);
  });

  it('requires generated BW even when color loaded', () => {
    const f = fixture();
    f.textures.add('color');
    vi.spyOn(f.internals, 'capTextureLongEdge').mockImplementation(() => {});
    vi.spyOn(f.internals, 'generateGrayscaleTexture').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    f.scene.create();
    expect(console.error).toHaveBeenCalledWith('Failed to set up level', expect.objectContaining({
      message: 'Reveal level level-1 is missing loaded texture: bw_generated',
    }));
    expect(f.start).toHaveBeenCalledWith('HomeScene');
    f.events.emit('postrender');
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
  });

  it('treats a failed color download as a recoverable load failure, never an exposure', () => {
    const f = fixture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => f.scene.create()).not.toThrow();
    f.events.emit('postrender');
    expect(f.start).toHaveBeenCalledWith('HomeScene');
    expect(console.error).toHaveBeenCalledWith('Failed to set up level', expect.objectContaining({
      message: 'Reveal level level-1 is missing loaded texture: color',
    }));
    expect(hideSceneTransitionCoverAfterPaint).toHaveBeenCalled();
    expect(revealPickupExperiment.exposure).not.toHaveBeenCalled();
    expect(analytics.experimentExposure).not.toHaveBeenCalled();
    expect(f.events.listenerCount('postrender')).toBe(0);
  });
});
