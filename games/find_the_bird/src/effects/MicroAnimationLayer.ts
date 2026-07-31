import Phaser from 'phaser';
import { GAME } from '../core/Constants';

export interface MicroAnimationSnapshot {
  activeObjects: number;
  activeTweens: number;
}

interface AmbientAccent {
  container: Phaser.GameObjects.Container;
  tween: Phaser.Tweens.Tween;
}

/**
 * Small non-target ambience layer. It deliberately uses screen-space accents,
 * not dog sprites or level hitbox positions, so motion adds polish without
 * teaching the player where hidden targets are.
 */
export class MicroAnimationLayer {
  private readonly accents: AmbientAccent[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  start(): void {
    if (this.accents.length > 0) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion) return;

    const anchors = [
      { x: GAME.WIDTH * 0.14, y: GAME.HEIGHT * 0.18, delay: 0, angle: -7 },
      { x: GAME.WIDTH * 0.86, y: GAME.HEIGHT * 0.24, delay: 420, angle: 9 },
      { x: GAME.WIDTH * 0.16, y: GAME.HEIGHT * 0.76, delay: 840, angle: -4 },
    ];

    for (const anchor of anchors) {
      const accent = this.createAccent(anchor.x, anchor.y)
        .setScrollFactor(0)
        .setDepth(18)
        .setAlpha(0.46)
        .setScale(0.66)
        .setAngle(anchor.angle);
      const tween = this.scene.tweens.add({
        targets: accent,
        y: anchor.y - 9,
        alpha: 0.14,
        scale: 0.98,
        angle: anchor.angle * -0.65,
        duration: 1650,
        delay: anchor.delay,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.accents.push({ container: accent, tween });
    }
  }

  stop(): void {
    for (const accent of this.accents) {
      accent.tween.destroy();
      accent.container.destroy(true);
    }
    this.accents.length = 0;
  }

  snapshot(): MicroAnimationSnapshot {
    return {
      activeObjects: this.accents.filter((accent) => accent.container.active).length,
      activeTweens: this.accents.filter((accent) => accent.tween.isPlaying()).length,
    };
  }

  private createAccent(x: number, y: number): Phaser.GameObjects.Container {
    const halo = this.scene.add.circle(0, 0, 9, 0xfff0a6, 0.1);
    const verticalGlint = this.scene.add.rectangle(0, 0, 2, 16, 0xfff0a6, 0.5);
    const horizontalGlint = this.scene.add.rectangle(0, 0, 14, 2, 0xfff0a6, 0.38);
    const warmCore = this.scene.add.circle(0, 0, 2.4, 0xffffff, 0.38);

    return this.scene.add.container(x, y, [
      halo,
      verticalGlint,
      horizontalGlint,
      warmCore,
    ]);
  }
}
