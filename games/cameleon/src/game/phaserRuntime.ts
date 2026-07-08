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
    private confirmPointer: Phaser.Input.Pointer | null = null;
    private flingVelocity = 0;
    private lastFeedbackSequence = 0;
    private lastShimmerSequence = 0;
    private activeFoundBeatHideId: string | null = null;
    private readonly collectedHideIds = new Set<string>();

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
      controller.tick();
      this.updateConfirmAim(delta);
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
        const snapshot = controller.snapshot();
        if (snapshot.scene !== "playing") return;
        if (snapshot.mode === "confirm") {
          this.flingVelocity = 0;
          this.drag = null;
          this.confirmPointer = pointer;
          controller.aimAtWorld({ x: snapshot.scrollX + pointer.x, y: pointer.y });
          return;
        }
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
        if (this.confirmPointer === pointer && pointer.isDown) {
          const snapshot = controller.snapshot();
          controller.aimAtWorld({ x: snapshot.scrollX + pointer.x, y: pointer.y });
          return;
        }
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
        if (this.confirmPointer === pointer) {
          const snapshot = controller.snapshot();
          controller.aimAtWorld({ x: snapshot.scrollX + pointer.x, y: pointer.y });
          this.confirmPointer = null;
          return;
        }
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
      if (snapshot.foundCount === 0) this.collectedHideIds.clear();
      for (const view of snapshot.hides) {
        const sprites = this.hideSprites.get(view.id);
        if (!sprites) continue;
        if (this.activeFoundBeatHideId === view.id) continue;
        const collected = this.collectedHideIds.has(view.id);
        const x = view.rect.x;
        const y = view.rect.y;
        sprites.painted.setTexture(view.painted.key).setPosition(x, y).setScale(1).setAngle(0);
        sprites.white.setTexture(view.white.key).setPosition(x, y).setScale(1).setAngle(0);
        if (collected) {
          sprites.painted.setVisible(false).setAlpha(0);
          sprites.white.setVisible(false).setAlpha(0);
          continue;
        }
        sprites.painted.setTexture(view.painted.key).setAlpha(view.painted.alpha).setVisible(view.painted.visible);
        sprites.white.setTexture(view.white.key).setAlpha(view.white.alpha).setVisible(view.white.visible);
      }
      this.renderFeedback(snapshot);
      this.renderIdleShimmer(snapshot);
    }

    private renderFeedback(snapshot: CameleonSnapshot): void {
      const feedback = snapshot.feedback;
      if (!feedback || feedback.sequence === this.lastFeedbackSequence) return;
      this.lastFeedbackSequence = feedback.sequence;
      if (!feedback.point) return;
      this.feedbackText?.destroy();
      const label = labelForFeedback(snapshot, feedback.kind);
      const color = feedback.kind === "hit" ? "#d8342f" : "#5f6875";
      const point = clampFeedbackPoint(this.cameras.main.scrollX, snapshot.viewport.width, feedback.point);
      if (feedback.kind === "hit" && feedback.id) {
        this.playFoundBeat(snapshot, feedback.id, feedback.point, label);
        return;
      }
      if (feedback.kind === "decoy") {
        this.playDecoyHit(snapshot, feedback.id, feedback.point);
        return;
      }
      if (feedback.kind === "miss") this.playMissBeat(snapshot, feedback.point);
      const text = this.add.text(point.x, point.y, label, {
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

    private renderIdleShimmer(snapshot: CameleonSnapshot): void {
      const shimmer = snapshot.idleShimmer;
      if (!shimmer || shimmer.sequence === this.lastShimmerSequence) return;
      this.lastShimmerSequence = shimmer.sequence;
      const ring = this.add.ellipse(shimmer.point.x, shimmer.point.y, 112, 78)
        .setStrokeStyle(4, 0xfff7df, 0.9)
        .setDepth(18);
      this.tweens.add({
        targets: ring,
        alpha: 0,
        scaleX: 1.1,
        scaleY: 1.1,
        duration: 180,
        yoyo: true,
        repeat: 1,
        onComplete: () => ring.destroy(),
      });
    }

    private updateConfirmAim(delta: number): void {
      const pointer = this.confirmPointer;
      if (!pointer?.isDown) return;
      const snapshot = controller.snapshot();
      if (snapshot.mode !== "confirm" || snapshot.scene !== "playing") return;
      const edge = 72;
      const speed = snapshot.viewport.width * 0.58;
      let nextScroll = snapshot.scrollX;
      if (pointer.x < edge) nextScroll -= (speed * delta) / 1000;
      if (pointer.x > snapshot.viewport.width - edge) nextScroll += (speed * delta) / 1000;
      if (nextScroll !== snapshot.scrollX) controller.scrollTo(nextScroll);
      const nextSnapshot = controller.snapshot();
      controller.aimAtWorld({ x: nextSnapshot.scrollX + pointer.x, y: pointer.y });
    }

    private playFoundBeat(snapshot: CameleonSnapshot, hideId: string, point: { x: number; y: number }, label: string): void {
      const sprites = this.hideSprites.get(hideId);
      const hideIndex = snapshot.hides.findIndex((hide) => hide.id === hideId);
      const view = snapshot.hides[hideIndex];
      if (!sprites || !view) return;

      this.activeFoundBeatHideId = hideId;
      sprites.painted
        .setTexture(view.painted.key)
        .setVisible(true)
        .setAlpha(1)
        .setPosition(view.rect.x, view.rect.y)
        .setScale(1)
        .setAngle(0);
      sprites.white
        .setTexture(view.white.key)
        .setVisible(true)
        .setAlpha(0)
        .setPosition(view.rect.x, view.rect.y)
        .setScale(1)
        .setAngle(0);

      this.cameras.main.shake(80, 0.004);
      this.cameras.main.zoomTo(1.018, 80);
      this.time.delayedCall(90, () => this.cameras.main.zoomTo(1, 120));
      this.playVignettePulse();
      this.playFoundStamp(snapshot, point, label);
      this.playPaintPeel(snapshot, point);

      this.tweens.add({
        targets: sprites.painted,
        alpha: 0,
        delay: 200,
        duration: 250,
      });
      this.tweens.add({
        targets: sprites.white,
        alpha: 1,
        delay: 200,
        duration: 250,
      });

      this.time.delayedCall(450, () => this.playShock(point));
      this.time.delayedCall(650, () => {
        this.tweens.add({
          targets: sprites.white,
          angle: hideIndex % 2 === 0 ? 540 : -420,
          y: Math.min(snapshot.world.height - view.rect.h, Math.max(point.y + 72, snapshot.world.height - 190)),
          scaleX: 1.08,
          scaleY: 0.9,
          duration: 500,
          ease: "Sine.easeInOut",
        });
      });
      this.time.delayedCall(1_150, () => {
        const slot = benchSlotCenter(snapshot, hideIndex);
        this.tweens.add({
          targets: sprites.white,
          x: snapshot.scrollX + slot.x - view.rect.w * 0.12,
          y: slot.y - view.rect.h * 0.12,
          angle: 0,
          scaleX: 0.24,
          scaleY: 0.24,
          duration: 250,
          ease: "Cubic.easeIn",
          onComplete: () => {
            this.collectedHideIds.add(hideId);
            sprites.white.setVisible(false).setAlpha(0);
            sprites.painted.setVisible(false).setAlpha(0);
            this.activeFoundBeatHideId = null;
          },
        });
      });
    }

    private playFoundStamp(snapshot: CameleonSnapshot, point: { x: number; y: number }, label: string): void {
      const stampPoint = clampFeedbackPoint(this.cameras.main.scrollX, snapshot.viewport.width, point);
      const burst = this.add.star(stampPoint.x, stampPoint.y, 16, 24, 58, 0xd8342f, 0.22).setDepth(19);
      const stamp = this.add.text(stampPoint.x, stampPoint.y, label, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "34px",
        color: "#d8342f",
        backgroundColor: "#fff7df",
        padding: { x: 12, y: 8 },
      }).setOrigin(0.5).setDepth(22).setAngle(-9).setScale(0.82);
      this.tweens.add({
        targets: [burst, stamp],
        scaleX: 1,
        scaleY: 1,
        duration: 120,
        ease: "Back.easeOut",
      });
      this.tweens.add({
        targets: [burst, stamp],
        alpha: 0,
        delay: 700,
        duration: 220,
        onComplete: () => {
          burst.destroy();
          stamp.destroy();
        },
      });
    }

    private playPaintPeel(snapshot: CameleonSnapshot, point: { x: number; y: number }): void {
      const colors = flakeColors(snapshot.dir);
      for (let index = 0; index < 12; index += 1) {
        const angle = (index * 137.5 * Math.PI) / 180;
        const flake = this.add.rectangle(point.x, point.y, 8 + (index % 3) * 3, 5 + (index % 2) * 4, colors[index % colors.length] ?? 0xfff7df)
          .setDepth(21)
          .setAngle(index * 23);
        this.tweens.add({
          targets: flake,
          x: point.x + Math.cos(angle) * (48 + index * 4),
          y: point.y + Math.sin(angle) * (34 + index * 3),
          alpha: 0,
          angle: flake.angle + 120,
          delay: 150,
          duration: 250,
          onComplete: () => flake.destroy(),
        });
      }
    }

    private playShock(point: { x: number; y: number }): void {
      const eyeLeft = this.add.circle(point.x - 12, point.y - 4, 4, 0x1f2430).setDepth(22);
      const eyeRight = this.add.circle(point.x + 12, point.y - 4, 4, 0x1f2430).setDepth(22);
      const bang = this.add.text(point.x + 26, point.y - 34, "!!", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "30px",
        color: "#1f2430",
      }).setOrigin(0.5).setDepth(22);
      this.tweens.add({
        targets: [eyeLeft, eyeRight, bang],
        x: "+=2",
        yoyo: true,
        repeat: 5,
        duration: 24,
      });
      this.tweens.add({
        targets: [eyeLeft, eyeRight, bang],
        alpha: 0,
        delay: 220,
        duration: 120,
        onComplete: () => {
          eyeLeft.destroy();
          eyeRight.destroy();
          bang.destroy();
        },
      });
    }

    private playVignettePulse(): void {
      const camera = this.cameras.main;
      const pulse = this.add.rectangle(0, 0, camera.width, camera.height, 0xd8342f, 0.18)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(40);
      this.tweens.add({
        targets: pulse,
        alpha: 0,
        duration: 120,
        onComplete: () => pulse.destroy(),
      });
    }

    private playDecoyHit(snapshot: CameleonSnapshot, decoyId: string | undefined, point: { x: number; y: number }): void {
      const decoy = controller.level.decoys.find((candidate) => candidate.id === decoyId);
      const rect = decoy?.rect;
      const wobble = this.add.rectangle(
        rect ? rect.x + rect.w / 2 : point.x,
        rect ? rect.y + rect.h / 2 : point.y,
        rect?.w ?? 96,
        rect?.h ?? 72,
        0xfff7df,
        0.24,
      ).setStrokeStyle(4, 0x1f2430, 0.68).setDepth(17);
      this.tweens.add({
        targets: wobble,
        angle: 5,
        yoyo: true,
        repeat: 4,
        duration: 60,
        onComplete: () => wobble.destroy(),
      });
      this.playSmallStamp(snapshot, point, "IT'S JUST A SIGN", "#1f2430");
    }

    private playMissBeat(snapshot: CameleonSnapshot, point: { x: number; y: number }): void {
      const ripple = this.add.circle(point.x, point.y, 12, 0x5f6875, 0.12)
        .setStrokeStyle(4, 0x5f6875, 0.82)
        .setDepth(18);
      this.tweens.add({
        targets: ripple,
        radius: snapshot.mode === "confirm" ? 54 : 44,
        alpha: 0,
        duration: snapshot.mode === "shoot" ? 220 : 320,
        onComplete: () => ripple.destroy(),
      });
      if (snapshot.mode === "confirm") this.playVignettePulse();
    }

    private playSmallStamp(snapshot: CameleonSnapshot, point: { x: number; y: number }, label: string, color: string): void {
      const stampPoint = clampFeedbackPoint(this.cameras.main.scrollX, snapshot.viewport.width, point);
      const stamp = this.add.text(stampPoint.x, stampPoint.y + 38, label, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "24px",
        color,
        backgroundColor: "#fff7df",
        padding: { x: 10, y: 6 },
      }).setOrigin(0.5).setDepth(23).setAngle(4);
      this.tweens.add({
        targets: stamp,
        alpha: 0,
        y: stamp.y - 20,
        delay: 420,
        duration: 220,
        onComplete: () => stamp.destroy(),
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

function labelForFeedback(
  snapshot: CameleonSnapshot,
  kind: CameleonSnapshot["feedback"] extends infer F ? F extends { kind: infer K } ? K : never : never,
): string {
  switch (kind) {
    case "hit":
      return "FOUND!";
    case "decoy":
      return "IT'S JUST A SIGN";
    case "miss":
      if (snapshot.mode === "shoot") return "THUNK";
      if (snapshot.mode === "confirm") return "-2";
      return "SPLASH?";
    case "mode":
      return "MODE";
  }
}

function clampFeedbackPoint(scrollX: number, viewportWidth: number, point: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return {
    x: clampNumber(point.x, scrollX + 48, scrollX + viewportWidth - 48),
    y: Math.max(116, point.y - 42),
  };
}

function flakeColors(direction: CameleonDirection): readonly number[] {
  switch (direction) {
    case "poster":
      return [0xd8342f, 0xf5d86c, 0x79d8d0, 0xff7a5f];
    case "riso":
      return [0xff5e7e, 0xf6ff7c, 0x47c5bf, 0xf78ad3];
    case "night":
      return [0x6fb0bd, 0x80dce4, 0x71386c, 0xf8f8ef];
  }
}

function benchSlotCenter(snapshot: CameleonSnapshot, hideIndex: number): { x: number; y: number } {
  const slotCount = 12;
  const gap = 4;
  const inset = 10;
  const width = Math.max(1, snapshot.viewport.width - inset * 2);
  const slotWidth = (width - gap * (slotCount - 1)) / slotCount;
  return {
    x: inset + slotWidth / 2 + hideIndex * (slotWidth + gap),
    y: snapshot.viewport.height - 38,
  };
}

function canvasSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width || window.innerWidth || canvas.width)),
    height: Math.max(1, Math.round(rect.height || window.innerHeight || canvas.height)),
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
