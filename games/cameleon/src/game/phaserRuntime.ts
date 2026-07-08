import type Phaser from "phaser";

import type { CameleonController, CameleonSnapshot } from "./CameleonController.ts";
import type { CameleonDirection, CameleonHideDefinition, CameleonLevelDefinition } from "./level.ts";

export interface CameleonPhaserRuntime {
  destroy(): void;
}

export interface CameleonPhaserOptions {
  readonly canvas: HTMLCanvasElement;
  readonly controller: CameleonController;
}

const ZONE_LABELS = [
  "ZONE 1 - ENTRANCE",
  "ZONE 2 - TENTS",
  "ZONE 3 - POOL DECK",
  "ZONE 4 - TOWER",
  "ZONE 5 - KIOSK",
] as const;

const ZONE_COLORS: Record<CameleonDirection, readonly number[]> = {
  poster: [0x79d8d0, 0xf5d86c, 0x42b7d8, 0xff7a5f, 0xb2df7e],
  riso: [0x83e0d7, 0xff6f91, 0x47c5bf, 0xf6ff7c, 0xf78ad3],
  night: [0x14365f, 0x214973, 0x0e6070, 0x71386c, 0x1f7058],
};

const PAINTED_COLORS: Record<CameleonDirection, number> = {
  poster: 0x6f7f83,
  riso: 0xff5e7e,
  night: 0x6fb0bd,
};

const WHITE_BODY = 0xf8f8ef;
const DECOY_STROKE = 0x1f2430;

type PhaserStatic = typeof Phaser;

export async function mountCameleonPhaser(options: CameleonPhaserOptions): Promise<CameleonPhaserRuntime> {
  const PhaserRuntime = await importPhaser();
  const level = options.controller.level;
  const scene = createLidoSceneClass(PhaserRuntime, options.controller);
  const size = canvasSize(options.canvas);
  const game = new PhaserRuntime.Game({
    type: PhaserRuntime.AUTO,
    canvas: options.canvas,
    width: size.width,
    height: size.height,
    backgroundColor: "#77d6d1",
    scale: {
      mode: PhaserRuntime.Scale.RESIZE,
      width: size.width,
      height: size.height,
    },
    physics: { default: "arcade" },
    scene,
  });

  options.controller.setViewport(size);
  const onResize = (): void => {
    const next = canvasSize(options.canvas);
    game.scale.resize(next.width, next.height);
    options.controller.setViewport(next);
    game.scene.getScene("lido").cameras.main.setBounds(0, 0, level.world.width, level.world.height);
  };
  window.addEventListener("resize", onResize);

  return {
    destroy(): void {
      window.removeEventListener("resize", onResize);
      game.destroy(true);
    },
  };
}

async function importPhaser(): Promise<PhaserStatic> {
  return await import("phaser") as unknown as PhaserStatic;
}

function createLidoSceneClass(PhaserRuntime: PhaserStatic, controller: CameleonController) {
  return class LidoScene extends PhaserRuntime.Scene {
    private readonly hideSprites = new Map<string, { painted: Phaser.GameObjects.Image; white: Phaser.GameObjects.Image }>();
    private feedbackText: Phaser.GameObjects.Text | null = null;
    private unsubscribe: (() => void) | null = null;
    private drag: { startX: number; startScroll: number; moved: boolean; lastX: number; lastTime: number; velocity: number } | null = null;
    private flingVelocity = 0;

    constructor() {
      super("lido");
    }

    create(): void {
      const level = controller.level;
      this.cameras.main.setBounds(0, 0, level.world.width, level.world.height);
      this.cameras.main.setRoundPixels(true);
      generatePlaceholderTextures(this, level);
      this.addZonePanels(level, controller.snapshot().dir);
      this.addDecoys(level);
      this.addHides(controller.snapshot());
      this.installInput();
      this.unsubscribe = controller.subscribe(() => this.renderSnapshot(controller.snapshot()));
      this.events.once(PhaserRuntime.Scenes.Events.SHUTDOWN, () => this.unsubscribe?.());
    }

    override update(_time: number, delta: number): void {
      if (this.drag || Math.abs(this.flingVelocity) < 1) return;
      controller.scrollTo(controller.snapshot().scrollX - (this.flingVelocity * delta) / 1000);
      this.flingVelocity *= 0.92;
    }

    private addZonePanels(level: CameleonLevelDefinition, direction: CameleonDirection): void {
      const keys = level.assetKeys.zonePanels[direction];
      keys.forEach((key, index) => {
        this.add.image(index * level.world.zoneWidth, 0, key).setOrigin(0, 0).setDepth(0);
        this.add.text(index * level.world.zoneWidth + 42, 118, ZONE_LABELS[index] ?? "", {
          fontFamily: "system-ui, sans-serif",
          fontSize: "34px",
          color: direction === "night" ? "#f8f8ef" : "#1f2430",
          backgroundColor: direction === "night" ? "#14365f" : "#fff7df",
          padding: { x: 12, y: 8 },
        }).setDepth(2);
      });
    }

    private addDecoys(level: CameleonLevelDefinition): void {
      const graphics = this.add.graphics().setDepth(4);
      graphics.lineStyle(4, DECOY_STROKE, 0.42);
      for (const decoy of level.decoys) {
        graphics.strokeRoundedRect(decoy.rect.x, decoy.rect.y, decoy.rect.w, decoy.rect.h, 10);
      }
    }

    private addHides(snapshot: CameleonSnapshot): void {
      for (const view of snapshot.hides) {
        const painted = this.add.image(view.rect.x, view.rect.y, view.painted.key).setOrigin(0, 0).setDepth(6);
        const white = this.add.image(view.rect.x, view.rect.y, view.white.key).setOrigin(0, 0).setDepth(7);
        this.hideSprites.set(view.id, { painted, white });
      }
      this.renderSnapshot(snapshot);
    }

    private installInput(): void {
      this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (controller.snapshot().scene !== "playing") return;
        this.flingVelocity = 0;
        this.drag = {
          startX: pointer.x,
          startScroll: controller.snapshot().scrollX,
          moved: false,
          lastX: pointer.x,
          lastTime: pointer.downTime,
          velocity: 0,
        };
      });

      this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
        if (!this.drag || !pointer.isDown) return;
        const dx = pointer.x - this.drag.startX;
        if (Math.abs(dx) > 6) this.drag.moved = true;
        controller.scrollTo(this.drag.startScroll - dx);
        const dt = Math.max(1, pointer.event.timeStamp - this.drag.lastTime);
        this.drag.velocity = ((pointer.x - this.drag.lastX) / dt) * 1000;
        this.drag.lastX = pointer.x;
        this.drag.lastTime = pointer.event.timeStamp;
      });

      this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        const drag = this.drag;
        this.drag = null;
        if (!drag) return;
        if (!drag.moved) {
          controller.tapWorld({ x: pointer.worldX, y: pointer.worldY });
          return;
        }
        this.flingVelocity = drag.velocity;
      });
    }

    private renderSnapshot(snapshot: CameleonSnapshot): void {
      this.cameras.main.scrollX = snapshot.scrollX;
      for (const view of snapshot.hides) {
        const sprites = this.hideSprites.get(view.id);
        if (!sprites) continue;
        sprites.painted.setTexture(view.painted.key).setAlpha(view.painted.alpha).setVisible(view.painted.visible);
        sprites.white.setTexture(view.white.key).setAlpha(view.white.alpha).setVisible(view.white.visible);
      }
      this.renderFeedback(snapshot);
    }

    private renderFeedback(snapshot: CameleonSnapshot): void {
      const feedback = snapshot.feedback;
      if (!feedback?.point) return;
      this.feedbackText?.destroy();
      const label = labelForFeedback(feedback.kind);
      const color = feedback.kind === "hit" ? "#d8342f" : "#5f6875";
      const text = this.add.text(feedback.point.x, Math.max(96, feedback.point.y - 42), label, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "32px",
        color,
        backgroundColor: "#fff7df",
        padding: { x: 10, y: 6 },
      }).setOrigin(0.5).setDepth(20).setAngle(feedback.kind === "hit" ? -8 : 0);
      this.feedbackText = text;
      this.tweens.add({
        targets: text,
        alpha: 0,
        y: text.y - 24,
        delay: 450,
        duration: 360,
        onComplete: () => text.destroy(),
      });
    }
  };
}

function generatePlaceholderTextures(scene: Phaser.Scene, level: CameleonLevelDefinition): void {
  for (const direction of Object.keys(ZONE_COLORS) as CameleonDirection[]) {
    const zoneColors = ZONE_COLORS[direction];
    for (const [index, key] of level.assetKeys.zonePanels[direction].entries()) {
      if (scene.textures.exists(key)) continue;
      const graphics = scene.make.graphics(undefined, false);
      graphics.fillStyle(zoneColors[index] ?? zoneColors[0] ?? 0xffffff, 1);
      graphics.fillRect(0, 0, level.world.zoneWidth, level.world.height);
      graphics.fillStyle(direction === "night" ? 0x0a223c : 0xfff7df, 0.35);
      graphics.fillRect(0, 0, level.world.zoneWidth, 180);
      graphics.lineStyle(10, direction === "night" ? 0x80dce4 : 0x1f2430, 0.35);
      graphics.strokeRect(0, 0, level.world.zoneWidth, level.world.height);
      graphics.generateTexture(key, level.world.zoneWidth, level.world.height);
      graphics.destroy();
    }
  }

  for (const hide of level.hides) {
    generateHideTexture(scene, hide.spritePair.white, hide, WHITE_BODY);
    for (const direction of Object.keys(PAINTED_COLORS) as CameleonDirection[]) {
      generateHideTexture(scene, hide.spritePair.painted[direction], hide, PAINTED_COLORS[direction]);
    }
  }
}

function generateHideTexture(scene: Phaser.Scene, key: string, hide: CameleonHideDefinition, color: number): void {
  if (scene.textures.exists(key)) return;
  const graphics = scene.make.graphics(undefined, false);
  graphics.fillStyle(color, 1);
  drawPoseSilhouette(graphics, hide.pose, hide.rect.w, hide.rect.h);
  graphics.lineStyle(3, 0x1f2430, 0.32);
  drawPoseOutline(graphics, hide.pose, hide.rect.w, hide.rect.h);
  graphics.generateTexture(key, Math.ceil(hide.rect.w), Math.ceil(hide.rect.h));
  graphics.destroy();
}

function drawPoseSilhouette(graphics: Phaser.GameObjects.Graphics, pose: string, width: number, height: number): void {
  if (pose.includes("prone") || pose.includes("lane")) {
    graphics.fillRoundedRect(0, height * 0.18, width, height * 0.62, height * 0.31);
    return;
  }
  if (pose.includes("curl")) {
    graphics.fillCircle(width * 0.42, height * 0.5, Math.min(width, height) * 0.42);
    graphics.fillCircle(width * 0.66, height * 0.44, Math.min(width, height) * 0.25);
    return;
  }
  if (pose.includes("slanted") || pose.includes("backbend")) {
    graphics.save();
    graphics.translateCanvas(width * 0.5, height * 0.5);
    graphics.rotateCanvas(-0.28);
    graphics.fillRoundedRect(-width * 0.22, -height * 0.42, width * 0.44, height * 0.84, width * 0.18);
    graphics.fillCircle(0, -height * 0.48, width * 0.22);
    graphics.restore();
    return;
  }
  graphics.fillRoundedRect(width * 0.24, height * 0.12, width * 0.52, height * 0.78, width * 0.22);
  graphics.fillCircle(width * 0.5, height * 0.1, width * 0.24);
}

function drawPoseOutline(graphics: Phaser.GameObjects.Graphics, pose: string, width: number, height: number): void {
  if (pose.includes("prone") || pose.includes("lane")) {
    graphics.strokeRoundedRect(0, height * 0.18, width, height * 0.62, height * 0.31);
    return;
  }
  if (pose.includes("curl")) {
    graphics.strokeCircle(width * 0.42, height * 0.5, Math.min(width, height) * 0.42);
    graphics.strokeCircle(width * 0.66, height * 0.44, Math.min(width, height) * 0.25);
    return;
  }
  graphics.strokeRoundedRect(width * 0.24, height * 0.12, width * 0.52, height * 0.78, width * 0.22);
}

function labelForFeedback(kind: CameleonSnapshot["feedback"] extends infer F ? F extends { kind: infer K } ? K : never : never): string {
  switch (kind) {
    case "hit":
      return "FOUND!";
    case "decoy":
      return "JUST A SIGN";
    case "miss":
      return "SPLASH?";
    case "mode":
      return "MODE";
  }
}

function canvasSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width || window.innerWidth || canvas.width)),
    height: Math.max(1, Math.round(rect.height || window.innerHeight || canvas.height)),
  };
}
