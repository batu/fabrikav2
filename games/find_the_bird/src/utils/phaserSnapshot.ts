import type Phaser from 'phaser';

export function snapshotGameImage(game: Phaser.Game): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    game.renderer.snapshot((image: HTMLImageElement | Phaser.Display.Color): void => {
      if (image instanceof HTMLImageElement) resolve(image);
      else reject(new Error('Phaser snapshot returned a Color instead of an Image'));
    });
  });
}
