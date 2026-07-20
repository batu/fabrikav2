import type Phaser from 'phaser';
import { PINCH } from '../scenes/PinchZoom';
import type { FindTheDogHarness, FindTheDogSnapshot } from './TestHarness';

export interface ZoomEvalPose {
  levelId: string;
  zoom: number;
  scrollX: number;
  scrollY: number;
}

export interface ZoomEvalCapture {
  levelId: string;
  pngDataUrl: string;
  zoom: number;
  scrollX: number;
  scrollY: number;
  canvasWidth: number;
  canvasHeight: number;
  levelWidth: number;
  levelHeight: number;
  imgScale: number;
  imgOffsetX: number;
  imgOffsetY: number;
  maxZoom: number;
}

declare global {
  interface Window {
    __zoomEval?: (pose: ZoomEvalPose) => Promise<ZoomEvalCapture>;
  }
}

const POLL_MS = 25;
const TIMEOUT_MS = 15_000;
const EPSILON = 1e-6;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForLevel(harness: FindTheDogHarness, levelId: string): Promise<FindTheDogSnapshot> {
  const deadline = performance.now() + TIMEOUT_MS;
  while (performance.now() < deadline) {
    const snapshot = harness.snapshot();
    if (snapshot.levelId === levelId && snapshot.levelDataReady && snapshot.activeScene === 'GameScene') return snapshot;
    await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
  }
  throw new Error(`[zoom-eval ${levelId}] timed out waiting for settled GameScene`);
}

function validatePose(pose: ZoomEvalPose): void {
  if (typeof pose?.levelId !== 'string' || pose.levelId.length === 0) throw new Error('[zoom-eval] levelId is required');
  for (const [name, value] of Object.entries({ zoom: pose.zoom, scrollX: pose.scrollX, scrollY: pose.scrollY })) {
    if (!Number.isFinite(value)) throw new Error(`[zoom-eval ${pose.levelId}] ${name} must be finite`);
  }
  if (pose.zoom < PINCH.minZoom || pose.zoom > PINCH.maxZoom) {
    throw new Error(`[zoom-eval ${pose.levelId}] zoom ${pose.zoom} is outside ${PINCH.minZoom}-${PINCH.maxZoom}`);
  }
}

export function installZoomEvalHook(game: Phaser.Game, harness: FindTheDogHarness): () => void {
  const capture = async (pose: ZoomEvalPose): Promise<ZoomEvalCapture> => {
    validatePose(pose);
    // Only (re)start the scene on a level change: gotoGameScene restarts
    // GameScene, and a restart between pose captures would race the settled
    // check (the stale snapshot still reports ready) then reset the camera.
    const current = harness.snapshot();
    if (current.levelId !== pose.levelId || !current.levelDataReady || current.activeScene !== 'GameScene') {
      harness.gotoGameScene(pose.levelId);
    }
    await waitForLevel(harness, pose.levelId);
    const scene = game.scene.getScene('GameScene');
    // Freeze sprite animations and tweens AT A FIXED PHASE so repeated
    // captures of the same pose are bit-comparable (animated dogs frozen at
    // an arbitrary frame otherwise add run-to-run variance).
    scene.anims.pauseAll();
    for (const child of scene.children.list) {
      const sprite = child as Phaser.GameObjects.Sprite;
      const currentAnim = sprite.anims?.currentAnim;
      if (currentAnim && currentAnim.frames.length > 0) {
        sprite.anims.pause();
        sprite.anims.setCurrentFrame(currentAnim.frames[0]);
      }
    }
    for (const tween of scene.tweens.getTweens()) {
      tween.pause();
      tween.seek(0);
    }
    const camera = scene.cameras.main;
    camera.setZoom(pose.zoom);
    camera.setScroll(pose.scrollX, pose.scrollY);
    // Bounds clamping applies in a later preRender pass, so wait until the
    // effective camera values are identical across two consecutive frames —
    // otherwise the pixel snapshot can catch a half-clamped frame that does
    // not match the metadata returned below.
    {
      const deadline = performance.now() + TIMEOUT_MS;
      let previous = { zoom: NaN, x: NaN, y: NaN };
      for (;;) {
        await nextFrame();
        const current = { zoom: camera.zoom, x: camera.scrollX, y: camera.scrollY };
        if (current.zoom === previous.zoom && current.x === previous.x && current.y === previous.y) break;
        if (performance.now() > deadline) throw new Error(`[zoom-eval ${pose.levelId}] camera never stabilized`);
        previous = current;
      }
    }
    const snapshot = await waitForLevel(harness, pose.levelId);
    // Scroll is intentionally not checked: camera bounds clamp it and
    // roundPixels quantizes it — both are real renderer behavior, and the
    // capture below reports the EFFECTIVE scroll for downstream crop mapping.
    if (Math.abs(snapshot.cameraZoom - pose.zoom) > EPSILON) {
      throw new Error(`[zoom-eval ${pose.levelId}] effective zoom mismatch: requested ${pose.zoom}, got ${snapshot.cameraZoom}`);
    }
    // renderer.snapshot reads pixels during the render pass — canvas.toDataURL
    // races the WebGL buffer clear (no preserveDrawingBuffer) and returns
    // intermittent black frames, especially with the 30fps limiter. Camera
    // metadata is read INSIDE the callback (post-render of the captured
    // frame): the render loop runs at 30fps while this async code runs at
    // rAF cadence, so values read outside the callback can describe a
    // different frame than the captured pixels.
    const captured = await new Promise<{ image: HTMLImageElement; zoom: number; scrollX: number; scrollY: number }>((resolve) => {
      game.renderer.snapshot((image) => resolve({
        image: image as HTMLImageElement,
        zoom: camera.zoom,
        scrollX: camera.scrollX,
        scrollY: camera.scrollY,
      }));
    });
    if (Math.abs(captured.zoom - pose.zoom) > EPSILON) {
      throw new Error(`[zoom-eval ${pose.levelId}] captured frame zoom mismatch: requested ${pose.zoom}, rendered ${captured.zoom}`);
    }
    const snapshotImage = captured.image;
    const offscreen = document.createElement('canvas');
    offscreen.width = snapshotImage.width;
    offscreen.height = snapshotImage.height;
    const context = offscreen.getContext('2d');
    if (context === null) throw new Error(`[zoom-eval ${pose.levelId}] 2d context unavailable`);
    context.drawImage(snapshotImage, 0, 0);
    const pngDataUrl = offscreen.toDataURL('image/png');
    if (!pngDataUrl.startsWith('data:image/png;base64,') || pngDataUrl.length < 100) {
      throw new Error(`[zoom-eval ${pose.levelId}] canvas serialization was blank`);
    }
    return Object.freeze({
      levelId: pose.levelId,
      pngDataUrl,
      zoom: captured.zoom,
      scrollX: captured.scrollX,
      scrollY: captured.scrollY,
      canvasWidth: game.canvas.width,
      canvasHeight: game.canvas.height,
      levelWidth: snapshot.levelSize.width,
      levelHeight: snapshot.levelSize.height,
      imgScale: snapshot.imgScale,
      imgOffsetX: snapshot.imgOffsetX,
      imgOffsetY: snapshot.imgOffsetY,
      maxZoom: PINCH.maxZoom,
    });
  };
  window.__zoomEval = capture;
  return (): void => {
    if (window.__zoomEval === capture) delete window.__zoomEval;
  };
}

