import type Phaser from "phaser";

import { assetEntriesForLevel } from "./assets.ts";
import type { CameleonController, CameleonSnapshot } from "./CameleonController.ts";
import type { CameleonDirection, CameleonLevelDefinition, WorldRect } from "./level.ts";

export interface CameleonPhaserRuntime {
  destroy(): void;
}

export interface CameleonPhaserOptions {
  readonly canvas: HTMLCanvasElement;
  readonly controller: CameleonController;
}

type PhaserStatic = typeof Phaser;

export async function mountCameleonPhaser(options: CameleonPhaserOptions): Promise<CameleonPhaserRuntime> {
  const PhaserRuntime = await importPhaser();
  const level = options.controller.level;
  const scene = createLidoSceneClass(PhaserRuntime, options.controller);
  const size = canvasSize(options.canvas);
  const game = new PhaserRuntime.Game({
    // Explicit renderer: AUTO throws "custom environment" outside a detected
    // browser (seen in instrumented Chromium) and would abort the whole boot.
    type: typeof WebGLRenderingContext === "undefined" ? PhaserRuntime.CANVAS : PhaserRuntime.WEBGL,
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

  options.controller.setViewport(worldViewport(size, level));
  const onResize = (): void => {
    const next = canvasSize(options.canvas);
    game.scale.resize(next.width, next.height);
    options.controller.setViewport(worldViewport(next, level));
    const camera = game.scene.getScene("lido").cameras.main;
    camera.setBounds(0, 0, level.world.width, level.world.height);
    camera.setZoom(next.height / level.world.height);
  };
  window.addEventListener("resize", onResize);

  return {
    destroy(): void {
      window.removeEventListener("resize", onResize);
      game.destroy(true);
    },
  };
}

function worldViewport(size: { width: number; height: number }, level: CameleonLevelDefinition): { width: number; height: number } {
  const zoom = size.height / level.world.height;
  return { width: size.width / zoom, height: level.world.height };
}

function worldPointFor(camera: Phaser.Cameras.Scene2D.Camera, pointer: Phaser.Input.Pointer): { x: number; y: number } {
  const point = camera.getWorldPoint(pointer.x, pointer.y);
  return { x: point.x, y: point.y };
}

async function importPhaser(): Promise<PhaserStatic> {
  return await import("phaser") as unknown as PhaserStatic;
}

function createLidoSceneClass(PhaserRuntime: PhaserStatic, controller: CameleonController) {
  return class LidoScene extends PhaserRuntime.Scene {
    private readonly panelSprites: Phaser.GameObjects.Image[] = [];
    private readonly hideSprites = new Map<string, { painted: Phaser.GameObjects.Image; white: Phaser.GameObjects.Image }>();
    private activePanelDirection: CameleonDirection | null = null;
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

    preload(): void {
      preloadLevelAssets(this, controller.level);
    }

    create(): void {
      const level = controller.level;
      this.cameras.main.setBounds(0, 0, level.world.width, level.world.height);
      // Fit the full 1440px world height into the canvas; the camera shows
      // ~height/zoom world px, so scroll/pointer math converts via zoom.
      this.cameras.main.setZoom(this.scale.height / level.world.height);
      this.cameras.main.setRoundPixels(true);
      this.addZonePanels(level, controller.snapshot().dir);
      this.addVisualOverlays(level);
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
        const panel = this.add.image(index * level.world.zoneWidth, 0, key)
          .setOrigin(0, 0)
          .setDisplaySize(level.world.zoneWidth, level.world.height)
          .setDepth(0);
        this.panelSprites[index] = panel;
      });
      this.activePanelDirection = direction;
    }

    private renderPanels(level: CameleonLevelDefinition, direction: CameleonDirection): void {
      if (this.activePanelDirection === direction) return;
      const keys = level.assetKeys.zonePanels[direction];
      keys.forEach((key, index) => {
        this.panelSprites[index]?.setTexture(key).setDisplaySize(level.world.zoneWidth, level.world.height);
      });
      this.activePanelDirection = direction;
    }

    private addVisualOverlays(level: CameleonLevelDefinition): void {
      for (const overlay of level.visualOverlays) {
        fitImageToRect(this.add.image(overlay.rect.x, overlay.rect.y, overlay.spriteKey), overlay.rect)
          .setOrigin(0, 0)
          .setDepth(3);
      }
    }

    private addDecoys(level: CameleonLevelDefinition): void {
      for (const decoy of level.decoys) {
        fitImageToRect(this.add.image(decoy.rect.x, decoy.rect.y, decoy.spriteKey), decoy.rect)
          .setOrigin(0, 0)
          .setDepth(4);
      }
    }

    private addHides(snapshot: CameleonSnapshot): void {
      for (const view of snapshot.hides) {
        const painted = fitImageToRect(this.add.image(view.rect.x, view.rect.y, view.painted.key), view.rect)
          .setOrigin(0, 0)
          .setDepth(6);
        const white = fitImageToRect(this.add.image(view.rect.x, view.rect.y, view.white.key), view.rect)
          .setOrigin(0, 0)
          .setDepth(7);
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
          controller.aimAtWorld(worldPointFor(this.cameras.main, pointer));
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
          controller.aimAtWorld(worldPointFor(this.cameras.main, pointer));
          return;
        }
        if (!this.drag || !pointer.isDown) return;
        const dx = (pointer.x - this.drag.startX) / this.cameras.main.zoom;
        if (Math.abs(pointer.x - this.drag.startX) > 6) this.drag.moved = true;
        controller.scrollTo(this.drag.startScroll - dx);
        const dt = Math.max(1, pointer.event.timeStamp - this.drag.lastTime);
        this.drag.velocity = ((pointer.x - this.drag.lastX) / dt) * 1000;
        this.drag.lastX = pointer.x;
        this.drag.lastTime = pointer.event.timeStamp;
      });

      this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        if (this.confirmPointer === pointer) {
          controller.aimAtWorld(worldPointFor(this.cameras.main, pointer));
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
        this.flingVelocity = drag.velocity / this.cameras.main.zoom;
      });
    }

    private renderSnapshot(snapshot: CameleonSnapshot): void {
      const cam = this.cameras.main;
      // worldView.x = scrollX + width/2 - displayWidth/2; pin left edge to
      // the controller's world-space scrollX.
      cam.scrollX = snapshot.scrollX - cam.width / 2 + cam.width / (2 * cam.zoom);
      this.renderPanels(controller.level, snapshot.dir);
      if (snapshot.foundCount === 0) this.collectedHideIds.clear();
      for (const view of snapshot.hides) {
        const sprites = this.hideSprites.get(view.id);
        if (!sprites) continue;
        if (this.activeFoundBeatHideId === view.id) continue;
        const collected = this.collectedHideIds.has(view.id);
        fitImageToRect(sprites.painted.setTexture(view.painted.key), view.rect).setAngle(0);
        fitImageToRect(sprites.white.setTexture(view.white.key), view.rect).setAngle(0);
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
      const point = clampFeedbackPoint(snapshot.scrollX, snapshot.viewport.width, feedback.point);
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
      fitImageToRect(sprites.painted.setTexture(view.painted.key), view.rect)
        .setVisible(true)
        .setAlpha(1)
        .setAngle(0);
      fitImageToRect(sprites.white.setTexture(view.white.key), view.rect)
        .setVisible(true)
        .setAlpha(0)
        .setAngle(0);

      this.cameras.main.shake(80, 0.004);
      const baseZoom = this.scale.height / controller.level.world.height;
      this.cameras.main.zoomTo(baseZoom * 1.018, 80);
      this.time.delayedCall(90, () => this.cameras.main.zoomTo(baseZoom, 120));
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
          displayWidth: view.rect.w * 1.08,
          displayHeight: view.rect.h * 0.9,
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
          displayWidth: view.rect.w * 0.24,
          displayHeight: view.rect.h * 0.24,
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

function preloadLevelAssets(scene: Phaser.Scene, level: CameleonLevelDefinition): void {
  for (const entry of assetEntriesForLevel(level)) {
    if (scene.textures.exists(entry.key)) continue;
    scene.load.image(entry.key, entry.url);
  }
}

function fitImageToRect(image: Phaser.GameObjects.Image, rect: WorldRect): Phaser.GameObjects.Image {
  return image
    .setPosition(rect.x, rect.y)
    .setDisplaySize(rect.w, rect.h);
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
