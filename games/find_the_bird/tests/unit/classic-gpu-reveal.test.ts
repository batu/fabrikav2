import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Renderer: { WebGL: { Pipelines: {
  SinglePipeline: class {},
} } } } }));

import { ClassicGpuReveal } from '../../../shared/ClassicGpuReveal';

interface FakeImage {
  pipelineData: { radius: number; center: { x: number; y: number } };
  destroy: ReturnType<typeof vi.fn>;
  clearMask: ReturnType<typeof vi.fn>;
  resetPipeline: ReturnType<typeof vi.fn>;
  setOrigin: ReturnType<typeof vi.fn>;
  setDisplaySize: ReturnType<typeof vi.fn>;
  setCrop: ReturnType<typeof vi.fn>;
  setMask: ReturnType<typeof vi.fn>;
  setPipeline: ReturnType<typeof vi.fn>;
}

function fixture(cold = false) {
  const images: FakeImage[] = [];
  const masks: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const scene = {
    game: { renderer: { pipelines: { has: () => !cold, add: vi.fn() } }, events: { once: vi.fn() } },
    textures: { get: () => ({ getSourceImage: () => ({ width: 4096, height: 2048 }) }) },
    add: { image: vi.fn(() => {
      const image: FakeImage = {
        pipelineData: { radius: 0, center: { x: 0, y: 0 } },
        destroy: vi.fn(), clearMask: vi.fn(), resetPipeline: vi.fn(),
        setOrigin: vi.fn().mockReturnThis(), setDisplaySize: vi.fn().mockReturnThis(),
        setCrop: vi.fn().mockReturnThis(), setMask: vi.fn().mockReturnThis(),
        setPipeline: vi.fn((_key, data) => { image.pipelineData = data; return image; }),
      };
      images.push(image); return image;
    }) },
    make: { graphics: vi.fn(() => {
      const mask = { destroy: vi.fn() }; masks.push(mask);
      return { fillStyle: vi.fn(), fillPoints: vi.fn(), createGeometryMask: () => mask, destroy: vi.fn() };
    }) },
  };
  const reveal = new ClassicGpuReveal(scene as never, { x: 10, y: 20, width: 1000, height: 500 }, 10);
  return { reveal, scene, images, masks };
}

const polygon = [{ x: 260, y: 145 }, { x: 510, y: 145 }, { x: 510, y: 270 }, { x: 260, y: 270 }];

describe('classic GPU reveal', () => {
  it('warms the first GPU draw invisibly during setup and retires it after rendering', () => {
    const { reveal, scene, images, masks } = fixture(true);
    expect(images[1].pipelineData.radius).toBe(0);
    expect(images[1].destroy).not.toHaveBeenCalled();
    expect(scene.game.events.once).toHaveBeenCalledWith('postrender', expect.any(Function));
    scene.game.events.once.mock.calls[0][1]();
    expect(images[1].destroy).toHaveBeenCalledOnce();
    expect(masks[1].destroy).toHaveBeenCalledOnce();
    reveal.destroy();
    expect(images[0].destroy).toHaveBeenCalledOnce();
  });

  it('reuses the full-resolution color texture and changes only radius during animation', () => {
    const { reveal, scene, images } = fixture();
    reveal.start(polygon, { x: 385, y: 207.5 });
    expect(scene.add.image).toHaveBeenCalledWith(10, 20, 'color');
    expect(images[1].setCrop).toHaveBeenCalledWith(1024, 512, 1024, 512);
    expect(images[1].pipelineData.center).toEqual({ x: 0.375, y: 0.375 });
    expect(images[1].pipelineData.radius).toBe(0);
    for (let radius = 1; radius <= 100; radius++) reveal.update(radius);
    expect(images[1].pipelineData.radius).toBe(100);
    expect(scene.add.image).toHaveBeenCalledTimes(2);
    expect(scene.make.graphics).toHaveBeenCalledTimes(2);
  });

  it('keeps one completed layer after many finds and a separate active cell', () => {
    const { reveal, images, masks } = fixture();
    for (let i = 0; i < 20; i++) {
      reveal.start(polygon, polygon[0]);
      reveal.update(null);
      expect(images.filter(image => image.destroy.mock.calls.length === 0)).toHaveLength(1);
    }
    expect(images[0].clearMask).not.toHaveBeenCalled();
    reveal.start(polygon, polygon[1]);
    reveal.update(50);
    expect(images[21].pipelineData.radius).toBe(50);
    expect(images.filter(image => image.destroy.mock.calls.length === 0)).toHaveLength(2);
    expect(images[0].pipelineData.radius).toBe(0);
    reveal.destroy();
    for (const image of images) expect(image.destroy).toHaveBeenCalledOnce();
    for (const mask of masks) expect(mask.destroy).toHaveBeenCalledOnce();
  });
});
