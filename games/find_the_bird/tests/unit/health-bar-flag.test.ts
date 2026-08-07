import { describe, expect, it } from 'vitest';

import { REMOTE_CONFIG_DEFAULTS, REMOTE_CONFIG_DEFINITIONS_BY_KEY } from '../../src/config/remoteConfigSchema';

describe('health bar remote config flag', () => {
  it('ships OFF by default', () => {
    expect(REMOTE_CONFIG_DEFAULTS.healthBarEnabled).toBe(false);
  });

  it('is declared with a remote key so it can be flipped without a build', () => {
    const entry = REMOTE_CONFIG_DEFINITIONS_BY_KEY.healthBarEnabled;
    expect(entry.remoteKey).toBe('health_bar_enabled');
    expect(entry.type).toBe('boolean');
  });

  it('gates BOTH the hearts UI and the level-fail penalty', async () => {
    // A hidden bar that still drains lives would fail the level invisibly —
    // the whole point of the flag is that these move together.
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const hud = readFileSync(join(root, 'src/ui/HUD.ts'), 'utf8');
    const scene = readFileSync(join(root, 'src/scenes/GameScene.ts'), 'utf8');
    expect(hud).toContain("healthBarEnabled");
    expect(scene).toContain("healthBarEnabled");
    // Flag off removes the pill from the DOM (not merely hidden)...
    expect(hud).toMatch(/healthBarEnabled'\)\) \{[\s\S]{0,220}heartsEl\.remove\(\)/);
    // ...and a miss returns before ANY punishment: no lives, X, shake, dust,
    // sound or haptic. Only the counter and cooldown run.
    expect(scene).toMatch(/if \(!healthEnabled\) return;/);
    const missBody = scene.slice(scene.indexOf('private onWrongTap'), scene.indexOf('private onWrongTap') + 2200);
    const guardAt = missBody.indexOf('if (!healthEnabled) return;');
    expect(guardAt).toBeGreaterThan(0);
    for (const punishment of ['gameState.lives--', 'playWrongTap()', 'hapticWrong()', 'shakeBoardOnMiss', 'emitDustPoof', 'wrong-tap']) {
      const at = missBody.indexOf(punishment);
      expect(at, `${punishment} must sit AFTER the flag guard`).toBeGreaterThan(guardAt);
    }
  });
});
