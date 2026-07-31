import Phaser from 'phaser';

/**
 * Two-finger pinch zoom for GameScene.
 *
 * Bounds:
 *   - Landscape (sectioned) levels: the camera stays clamped to its current
 *     section (or full-world during the finale — whichever bounds are set).
 *   - Portrait/square levels: the camera is clamped to the full level.
 *
 * Phaser's camera.zoom + setBounds already enforces the clamp, so this class
 * only owns gesture detection and the zoom/scroll math.
 *
 * One-finger drag while zoomed pans the camera inside its bounds.
 *
 * Mouse users: this also works with mouse + shift/alt drags if you want to
 * extend it later, but the current implementation is touch-only (requires
 * 2 simultaneous active pointers).
 */

export const PINCH = {
  minZoom: 1.0,
  maxZoom: 2.5,
  // Below this delta, ignore — prevents jitter while finger is "pressed but still"
  minDistPx: 8,
  // Pointer movement threshold: below this, ignore movement as touch jitter.
  tapMoveSlop: 12,
} as const;

const PAN_INERTIA = {
  decayMs: 140,
  stopVelocity: 0.01,
  maxVelocity: 1.6,
} as const;

export function stepPanInertiaAxis(
  position: number,
  velocity: number,
  deltaMs: number,
  min: number,
  max: number,
): { position: number; velocity: number } {
  if (Math.abs(velocity) <= PAN_INERTIA.stopVelocity) {
    return { position, velocity: 0 };
  }

  const nextPosition = Phaser.Math.Clamp(position + velocity * deltaMs, min, max);
  if (nextPosition === min || nextPosition === max) {
    return { position: nextPosition, velocity: 0 };
  }

  const nextVelocity = velocity * Math.exp(-deltaMs / PAN_INERTIA.decayMs);
  return {
    position: nextPosition,
    velocity: Math.abs(nextVelocity) <= PAN_INERTIA.stopVelocity ? 0 : nextVelocity,
  };
}

export class PinchZoom {
  private scene: Phaser.Scene;
  private enabled = true;
  private pinchActive = false;
  private pinchInitialDistance = 0;
  private pinchInitialZoom = 1;
  private panStartPointer = { x: 0, y: 0 };
  private panStartScroll = { x: 0, y: 0 };
  private panDragging = false;
  private panVelocity = { x: 0, y: 0 };
  private lastPanSample = { x: 0, y: 0, time: 0 };
  private panAtMinZoom: boolean;

  constructor(scene: Phaser.Scene, options: { panAtMinZoom?: boolean } = {}) {
    this.scene = scene;
    this.panAtMinZoom = options.panAtMinZoom ?? false;

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    scene.events.on('update', this.updateInertia, this);

    scene.events.once('shutdown', () => {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
      scene.events.off('update', this.updateInertia, this);
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.pinchActive = false;
      this.stopInertia();
    }
  }

  /** The scene asks us: is the user currently pinching? If so, tap-handling should skip. */
  get isPinching(): boolean {
    return this.pinchActive;
  }

  /** True while a zoomed one-finger drag is panning the camera. */
  get isPanning(): boolean {
    return this.panDragging;
  }

  /** True iff camera is currently zoomed past the reset threshold. */
  isZoomed(): boolean {
    return this.scene.cameras.main.zoom > PINCH.minZoom + 0.001;
  }

  private onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (!this.enabled) return;
    this.stopInertia();
    const pointers = this.activePointersIncluding(pointer);
    if (pointers.length >= 2) {
      this.startPinch(pointers);
      return;
    }
    const cam = this.scene.cameras.main;
    this.panStartPointer = { x: pointer.x, y: pointer.y };
    this.panStartScroll = { x: cam.scrollX, y: cam.scrollY };
    this.panDragging = false;
    this.lastPanSample = { x: cam.scrollX, y: cam.scrollY, time: this.scene.time.now };
  };

  private onPointerUp = (): void => {
    // Phaser can emit POINTER_UP before `manager.pointers` has fully
    // reflected the released touch. Re-read active pointers on the next
    // tick so pinch state does not leak into the first later one-finger pan.
    this.scene.time.delayedCall(0, () => {
      const pointers = this.activePointers();
      if (pointers.length >= 2) return;
      this.pinchActive = false;
      this.resetPanAnchor(pointers[0] ?? null);
    });
  };

  private onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (!this.enabled) return;
    const pointers = this.activePointersIncluding(pointer);
    if (pointers.length !== 2) {
      if (this.pinchActive) {
        this.pinchActive = false;
        this.resetPanAnchor(pointers[0] ?? null);
        return;
      }
      if (pointers.length === 1) this.updatePan(pointers[0]);
      return;
    }
    if (!this.pinchActive) {
      this.startPinch(pointers);
      return;
    }
    this.updatePinch(pointers);
  };

  private activePointers(): Phaser.Input.Pointer[] {
    const manager = this.scene.input.manager;
    // `manager.pointers` also includes Phaser's mouse pointer. On mobile
    // emulation Chrome can leave that synthetic pointer marked down while
    // a real touch is active, which makes a one-finger tap look like a
    // two-finger pinch and causes GameScene to swallow the release.
    return manager.pointers.filter((p) => p.isDown && p !== manager.mousePointer);
  }

  private activePointersIncluding(pointer: Phaser.Input.Pointer): Phaser.Input.Pointer[] {
    const manager = this.scene.input.manager;
    if (pointer === manager.mousePointer) return this.activePointers();
    const pointers = this.activePointers();
    return pointers.includes(pointer) ? pointers : [...pointers, pointer];
  }

  private startPinch(pointers: Phaser.Input.Pointer[]): void {
    const [a, b] = pointers;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < PINCH.minDistPx) return;
    this.stopInertia();
    this.pinchActive = true;
    this.pinchInitialDistance = dist;
    this.pinchInitialZoom = this.scene.cameras.main.zoom;
  }

  private updatePinch(pointers: Phaser.Input.Pointer[]): void {
    const [a, b] = pointers;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < PINCH.minDistPx) return;

    const ratio = dist / this.pinchInitialDistance;
    const rawZoom = this.pinchInitialZoom * ratio;
    const zoom = Phaser.Math.Clamp(rawZoom, PINCH.minZoom, PINCH.maxZoom);

    const cam = this.scene.cameras.main;
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const cameraCenter = { x: cam.width / 2, y: cam.height / 2 };
    const worldBeforeZoom = {
      x: cam.scrollX + cameraCenter.x + (midpoint.x - cameraCenter.x) / cam.zoom,
      y: cam.scrollY + cameraCenter.y + (midpoint.y - cameraCenter.y) / cam.zoom,
    };
    cam.setZoom(zoom);
    this.setCameraScroll(
      worldBeforeZoom.x - cameraCenter.x - (midpoint.x - cameraCenter.x) / zoom,
      worldBeforeZoom.y - cameraCenter.y - (midpoint.y - cameraCenter.y) / zoom,
    );
  }

  private updatePan(pointer: Phaser.Input.Pointer): void {
    if (!this.panAtMinZoom && !this.isZoomed()) return;

    const dx = pointer.x - this.panStartPointer.x;
    const dy = pointer.y - this.panStartPointer.y;
    if (!this.panDragging && dx * dx + dy * dy <= PINCH.tapMoveSlop * PINCH.tapMoveSlop) {
      return;
    }
    this.panDragging = true;

    const cam = this.scene.cameras.main;
    const nextX = this.panStartScroll.x - dx / cam.zoom;
    const nextY = this.panStartScroll.y - dy / cam.zoom;
    this.setCameraScroll(nextX, nextY);
    const now = this.scene.time.now;
    const elapsed = Math.max(1, now - this.lastPanSample.time);
    const measuredX = (cam.scrollX - this.lastPanSample.x) / elapsed;
    const measuredY = (cam.scrollY - this.lastPanSample.y) / elapsed;
    this.panVelocity = {
      x: Phaser.Math.Clamp(this.panVelocity.x * 0.35 + measuredX * 0.65, -PAN_INERTIA.maxVelocity, PAN_INERTIA.maxVelocity),
      y: Phaser.Math.Clamp(this.panVelocity.y * 0.35 + measuredY * 0.65, -PAN_INERTIA.maxVelocity, PAN_INERTIA.maxVelocity),
    };
    this.lastPanSample = { x: cam.scrollX, y: cam.scrollY, time: now };
  }

  private resetPanAnchor(pointer: Phaser.Input.Pointer | null): void {
    const cam = this.scene.cameras.main;
    this.panStartPointer = pointer === null
      ? { x: 0, y: 0 }
      : { x: pointer.x, y: pointer.y };
    this.panStartScroll = { x: cam.scrollX, y: cam.scrollY };
    this.panDragging = false;
  }

  private updateInertia = (_time: number, deltaMs: number): void => {
    if (!this.enabled || this.panDragging || this.pinchActive) return;
    if (this.panVelocity.x === 0 && this.panVelocity.y === 0) return;

    const cam = this.scene.cameras.main;
    const ranges = this.cameraScrollRanges();
    const x = stepPanInertiaAxis(cam.scrollX, this.panVelocity.x, deltaMs, ranges.minX, ranges.maxX);
    const y = stepPanInertiaAxis(cam.scrollY, this.panVelocity.y, deltaMs, ranges.minY, ranges.maxY);
    this.panVelocity = { x: x.velocity, y: y.velocity };
    this.setCameraScroll(x.position, y.position);
  };

  private stopInertia(): void {
    this.panVelocity = { x: 0, y: 0 };
  }

  private cameraScrollRanges(): { minX: number; minY: number; maxX: number; maxY: number } {
    const cam = this.scene.cameras.main;
    if (!cam.useBounds) {
      return { minX: Number.NEGATIVE_INFINITY, minY: Number.NEGATIVE_INFINITY, maxX: Number.POSITIVE_INFINITY, maxY: Number.POSITIVE_INFINITY };
    }

    const bounds = cam.getBounds();
    const viewWidth = cam.width / cam.zoom;
    const viewHeight = cam.height / cam.zoom;
    const originOffsetX = (cam.width - viewWidth) * cam.originX;
    const originOffsetY = (cam.height - viewHeight) * cam.originY;
    const minX = bounds.x - originOffsetX;
    const minY = bounds.y - originOffsetY;
    return {
      minX,
      minY,
      maxX: Math.max(minX, bounds.right - viewWidth - originOffsetX),
      maxY: Math.max(minY, bounds.bottom - viewHeight - originOffsetY),
    };
  }

  private setCameraScroll(x: number, y: number): void {
    const cam = this.scene.cameras.main;
    if (!cam.useBounds) {
      cam.setScroll(x, y);
      return;
    }

    const ranges = this.cameraScrollRanges();
    cam.scrollX = Phaser.Math.Clamp(x, ranges.minX, ranges.maxX);
    cam.scrollY = Phaser.Math.Clamp(y, ranges.minY, ranges.maxY);
  }
}
