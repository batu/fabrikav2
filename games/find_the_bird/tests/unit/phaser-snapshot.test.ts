import type Phaser from 'phaser';
import { describe, expect, it } from 'vitest';
import { snapshotGameImage } from '../../src/utils/phaserSnapshot';

function gameReturning(result: HTMLImageElement | Phaser.Display.Color): Phaser.Game {
  return {
    renderer: {
      snapshot(callback: (image: HTMLImageElement | Phaser.Display.Color) => void): void {
        callback(result);
      },
    },
  } as unknown as Phaser.Game;
}

describe('snapshotGameImage', () => {
  it('resolves the image returned by Phaser', async () => {
    const image = new Image();

    await expect(snapshotGameImage(gameReturning(image))).resolves.toBe(image);
  });

  it('rejects a non-image snapshot result', async () => {
    const color = {} as Phaser.Display.Color;

    await expect(snapshotGameImage(gameReturning(color))).rejects.toThrow(
      'Phaser snapshot returned a Color instead of an Image',
    );
  });
});
