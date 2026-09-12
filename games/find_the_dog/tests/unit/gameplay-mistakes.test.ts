import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../../../shared/ClassicGpuReveal', () => ({ ClassicGpuReveal: class {} }));
vi.mock('../../src/audio/AudioManager', () => ({ playWrongTap: vi.fn() }));

import { GameScene } from '../../src/scenes/GameScene';
import { gameState } from '../../src/core/GameState';
import { GAMEPLAY } from '../../src/core/Constants';
import { configureRemoteConfigService, createFtdRemoteConfigService, remoteConfigService } from '../../src/config/RemoteConfigService';
import { initHUD, updateHUD } from '../../src/ui/HUD';
import { playWrongTap } from '../../src/audio/AudioManager';

beforeEach(() => {
  configureRemoteConfigService(createFtdRemoteConfigService());
  gameState.lives = GAMEPLAY.LIVES_PER_LEVEL;
  gameState.penaltyCooldownUntil = 0;
  document.body.innerHTML = '<div id="hud-overlay"></div>';
});

afterEach(() => { vi.restoreAllMocks(); });

describe('mistakes disabled by default', () => {
  it('ignores repeated wrong taps without losing lives or starting failure effects', () => {
    const scene = new GameScene() as unknown as { onWrongTap(x: number, y: number): void };
    for (let i = 0; i < 20; i++) scene.onWrongTap(50, 50);
    expect(gameState.lives).toBe(GAMEPLAY.LIVES_PER_LEVEL);
    expect(gameState.penaltyCooldownUntil).toBe(0);
    expect(playWrongTap).not.toHaveBeenCalled();
  });

  it('hides hearts on initial render and HUD updates, and supports enabling them', () => {
    initHUD();
    expect(document.getElementById('hearts')?.style.display).toBe('none');
    updateHUD(10);
    expect(document.getElementById('hearts')?.style.display).toBe('none');
    remoteConfigService.setValuesForTest({ gameplayMistakesEnabled: true });
    updateHUD(10);
    expect(document.getElementById('hearts')?.style.display).toBe('flex');
    expect(document.querySelectorAll('#hearts .heart-icon')).toHaveLength(GAMEPLAY.LIVES_PER_LEVEL);
    remoteConfigService.setValuesForTest({ gameplayMistakesEnabled: false });
    updateHUD(10);
    expect(document.getElementById('hearts')?.style.display).toBe('none');
  });

  it('restores wrong-tap penalties when enabled remotely', () => {
    remoteConfigService.setValuesForTest({ gameplayMistakesEnabled: true });
    initHUD();
    const graphics = {
      lineStyle: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      strokePath: vi.fn(), setPosition: vi.fn(), setScrollFactor: vi.fn(), destroy: vi.fn(),
    };
    const scene = new GameScene();
    Object.assign(scene, {
      level: { dogs: [] },
      prefersReducedMotion: () => true,
      shakeBoardOnMiss: vi.fn(), emitDustPoof: vi.fn(),
      viewportToScrollFactorZeroPoint: (x: number, y: number) => ({ x, y }),
      add: { graphics: () => graphics }, tweens: { add: vi.fn() },
    });
    (scene as unknown as { onWrongTap(x: number, y: number): void }).onWrongTap(50, 50);
    expect(gameState.lives).toBe(GAMEPLAY.LIVES_PER_LEVEL - 1);
    expect(gameState.penaltyCooldownUntil).toBeGreaterThan(Date.now());
    expect(playWrongTap).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('#hearts .empty')).toHaveLength(1);
  });
});
