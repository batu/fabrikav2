import Phaser from 'phaser';
import { gameConfig } from '../../game.config';
import { GAME } from '../core/Constants';

/**
 * Menu vignette slot — an OPTIONAL ambient game scene rendered on the Phaser
 * canvas BEHIND the DOM home shell (the shell's surfaces are transparent, so
 * whatever the canvas draws shows through between the UI).
 *
 * Contract (tool-shaped: the shell owns when it runs):
 *  - No input: canvas input stays untouched; the vignette only draws.
 *  - Ambient only: slow, self-running motion. Respect prefers-reduced-motion.
 *  - Pausable: the shell calls pause() on lifecycle suspend and while a page
 *    overlay (shop/settings) is open; stop() tears everything down.
 *
 * A real game (e.g. marble_run) registers its own factory here — a marble
 * loop rolling behind the saga map — and flips game.config `menu.vignette`.
 */
export interface MenuVignette {
  pause(): void;
  resume(): void;
  stop(): void;
}

export type MenuVignetteFactory = (scene: Phaser.Scene) => MenuVignette;

/**
 * Demo vignette: a handful of soft translucent discs drifting slowly upward,
 * proving the canvas-behind-shell seam without asserting any brand. Replace
 * per game; delete nothing — the template keeps the seam alive and tested.
 */
export function createDemoVignette(scene: Phaser.Scene): MenuVignette {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const discs: Phaser.GameObjects.Arc[] = [];
  const tweens: Phaser.Tweens.Tween[] = [];

  const COUNT = 12;
  const PALETTE = [0xffffff, 0xffd54b, 0x48d8d4, 0xf1a957];
  for (let i = 0; i < COUNT; i += 1) {
    const radius = 40 + Math.random() * 90;
    const x = Math.random() * GAME.WIDTH;
    const y = Math.random() * GAME.HEIGHT;
    const disc = scene.add.circle(x, y, radius, PALETTE[i % PALETTE.length], 0.30 + Math.random() * 0.20);
    disc.setDepth(-10);
    discs.push(disc);
    if (!reducedMotion) {
      tweens.push(scene.tweens.add({
        targets: disc,
        y: y - GAME.HEIGHT * (0.15 + Math.random() * 0.2),
        x: x + (Math.random() - 0.5) * 120,
        alpha: { from: disc.alpha, to: 0.08 },
        duration: 9000 + Math.random() * 8000,
        repeat: -1,
        yoyo: true,
        ease: 'Sine.easeInOut',
        delay: Math.random() * 4000,
      }));
    }
  }

  return {
    pause(): void {
      for (const tween of tweens) tween.pause();
    },
    resume(): void {
      for (const tween of tweens) tween.resume();
    },
    stop(): void {
      for (const tween of tweens) tween.remove();
      tweens.length = 0;
      for (const disc of discs) disc.destroy();
      discs.length = 0;
    },
  };
}

const vignetteFactories: Record<string, MenuVignetteFactory> = {
  demo: createDemoVignette,
};

/** Resolve the configured vignette factory, or null when 'none'/unknown. */
export function configuredMenuVignetteFactory(): MenuVignetteFactory | null {
  const kind = gameConfig.menu.vignette;
  if (kind === 'none') return null;
  return vignetteFactories[kind] ?? null;
}
