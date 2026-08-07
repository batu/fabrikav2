import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const gameScene = readFileSync(join(process.cwd(), 'src/scenes/GameScene.ts'), 'utf8');
const pickupPreference = readFileSync(join(process.cwd(), 'src/settings/pickupStylePreference.ts'), 'utf8');
const hud = readFileSync(join(process.cwd(), 'src/ui/HUD.ts'), 'utf8');
const testHarness = readFileSync(join(process.cwd(), 'src/testing/TestHarness.ts'), 'utf8');

describe('pickup style routing', () => {
  it('uses Classic as the single default for gameplay and Settings', () => {
    expect(pickupPreference).toContain("export const DEFAULT_PICKUP_STYLE: PickupStyle = 'classic';");
    expect(gameScene).toContain('?? DEFAULT_PICKUP_STYLE;');
    expect(hud).toContain('getPickupStylePreference() ?? DEFAULT_PICKUP_STYLE');
    expect(gameScene).not.toContain("?? 'dissolve';");
    expect(hud).not.toContain("getPickupStylePreference() ?? 'dissolve'");
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

  it('keeps harness-selected styles aligned with Settings across scene restarts', () => {
    expect(testHarness).toContain('setPickupStylePreference(style);');
  });
});
