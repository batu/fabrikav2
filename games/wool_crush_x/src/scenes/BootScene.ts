import Phaser from 'phaser';
import { remoteConfigService } from '../config/RemoteConfigService';

export class BootScene extends Phaser.Scene {
  private isShuttingDown: boolean = false;

  constructor() {
    super('BootScene');
  }

  preload(): void {
    this.load.image('wool-kitten', '/ui/gameplay/kitten-yarn-v2.png');
    this.load.image('wool-dragon-head', '/ui/gameplay/dragon-head-yarn-v2.png');
    this.load.image('wool-block', '/ui/gameplay/yarn-block-white-v2.png');
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
    this.scene.start('HomeScene');
  }
}
