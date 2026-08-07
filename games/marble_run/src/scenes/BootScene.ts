import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  private isShuttingDown: boolean = false;

  constructor() {
    super('BootScene');
  }

  create(): void {
    console.info(`[startup] boot-scene-create ${performance.now().toFixed(1)}ms`);
    this.isShuttingDown = false;
    this.events.once('shutdown', () => {
      this.isShuttingDown = true;
    });
    // Phaser marks the scene RUNNING only after create() returns. Defer one
    // microtask so the active-state guard observes that lifecycle transition.
    queueMicrotask(() => this.chooseStartScene());
  }

  private chooseStartScene(): void {
    if (this.isShuttingDown || !this.sys.isActive()) return;
    this.scene.start('HomeScene');
  }
}
