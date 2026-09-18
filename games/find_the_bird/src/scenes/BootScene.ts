import Phaser from 'phaser';
import { remoteConfigService } from '../config/RemoteConfigService';
import { gameState } from '../core/GameState';

export class BootScene extends Phaser.Scene {
  private isShuttingDown: boolean = false;

  constructor() {
    super('BootScene');
  }

  create(): void {
    this.isShuttingDown = false;
    this.events.once('shutdown', () => {
      this.isShuttingDown = true;
    });
    void this.chooseStartScene();
  }

  private async chooseStartScene(): Promise<void> {
    await remoteConfigService.initAndWaitForTest();
    if (this.isShuttingDown || !this.sys.isActive()) return;
    // A brand-new player opens on the first level, not on a home menu whose
    // rail, wallet and nav mean nothing yet. The flag is spent here, so the
    // second launch and every launch after it open on the home menu. GameScene
    // loads the level for the current progression itself when given no data,
    // and runtime.ts has already built the HUD.
    if (!gameState.firstLaunchDone) {
      gameState.markFirstLaunchDone();
      this.scene.start('GameScene', {});
      return;
    }
    this.scene.start('HomeScene');
  }
}
