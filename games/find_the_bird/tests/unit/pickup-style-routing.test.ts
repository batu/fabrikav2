import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PICKUP_STYLE,
  resolvePickupStyle,
} from '../../src/settings/pickupStylePreference';

const gameScene = readFileSync(join(process.cwd(), 'src/scenes/GameScene.ts'), 'utf8');
const pickupPreference = readFileSync(join(process.cwd(), 'src/settings/pickupStylePreference.ts'), 'utf8');
const hud = readFileSync(join(process.cwd(), 'src/ui/HUD.ts'), 'utf8');
const testHarness = readFileSync(join(process.cwd(), 'src/testing/TestHarness.ts'), 'utf8');

describe('pickup style routing', () => {
  it('uses the visible bird-sprite flight as the single production pickup', () => {
    expect(DEFAULT_PICKUP_STYLE).toBe('classic');
    expect(resolvePickupStyle('classic', false)).toBe('classic');
    for (const experimental of ['dissolve', 'feathers', 'flashbulb', 'burst', 'tumble']) {
      expect(resolvePickupStyle(experimental, false)).toBe('classic');
    }
    expect(resolvePickupStyle('not-a-style', false)).toBe('classic');
    expect(resolvePickupStyle('classic', true)).toBe('classic');
    expect(pickupPreference).toContain("export const DEFAULT_PICKUP_STYLE: PickupStyle = 'classic';");
    expect(gameScene).toContain('resolvePickupStyle(');
    expect(hud).not.toContain('pickup-style');
    expect(hud).not.toContain('Pickup Style');
    expect(gameScene).toContain('default: this.playPickupClassic(dog);');
  });

  it('routes the feathers style to an animation that never creates a bird cutout', () => {
    expect(gameScene).toContain("case 'feathers': this.playPickupFeathers(dog); return;");

    const method = gameScene.match(
      /private playPickupFeathers\(dog: LevelDog\): void \{([\s\S]*?)\n {2}\}\n\n {2}\/\*\*/,
    )?.[1];

    expect(method).toBeDefined();
    expect(method).toContain("'pickup-feather'");
    expect(method).not.toContain('spawnPickupImage');
    expect(method).not.toContain('restorationSpriteForDog');
    expect(method).not.toContain('spriteTextureKeyForDog');
  });

  it('keeps experimental styles available to the test harness across scene restarts', () => {
    expect(testHarness).toContain('setPickupStylePreference(style);');
  });

  it('preserves sprite flip metadata through both cutout pickup paths', () => {
    expect(gameScene.match(/image\.setFlip\(sprite\.flipX \?\? false, sprite\.flipY \?\? false\);/g)).toHaveLength(2);
    expect(gameScene).toContain('sprite.flipX ? 1 - (sprite.anchorX ?? 0.5)');
    expect(gameScene).toContain('sprite.flipY ? 1 - (sprite.anchorY ?? 0.5)');
  });
});
