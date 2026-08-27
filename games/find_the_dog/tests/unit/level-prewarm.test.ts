import { describe, expect, it } from 'vitest';
import { buildLevelPrewarmTargets } from '../../src/scenes/LevelPrewarm';
import type { LevelData } from '../../src/data/levels';

const level = {
  id: 'portrait-level',
  width: 2560,
  height: 5600,
  colorImage: '/levels/portrait/color.webp',
  bgImageUrls: ['/levels/portrait/bg_01.webp'],
  dogs: [
    { id: 'dog-1', sprite: { image: '/levels/portrait/dogs/dog-1.png' } },
    { id: 'dog-2', sprite: { image: '/levels/portrait/dogs/dog-2.png' } },
  ],
} as LevelData;

describe('level texture prewarm targets', () => {
  it('keeps Classic prewarm to the one texture gameplay will use', () => {
    expect(buildLevelPrewarmTargets(level, 4096, false)).toEqual({
      targets: [{ key: 'color', url: level.colorImage }],
      spriteKeys: [],
    });
  });

  it('includes clean backgrounds and dog sprites for Restoration gameplay', () => {
    expect(buildLevelPrewarmTargets(level, 4096, true)).toEqual({
      targets: [
        { key: 'color', url: level.colorImage },
        { key: 'bg_0', url: level.bgImageUrls![0] },
        { key: 'dog_sprite_portrait-level_dog-1', url: level.dogs[0].sprite!.image },
        { key: 'dog_sprite_portrait-level_dog-2', url: level.dogs[1].sprite!.image },
      ],
      spriteKeys: [
        'dog_sprite_portrait-level_dog-1',
        'dog_sprite_portrait-level_dog-2',
      ],
    });
  });
});
