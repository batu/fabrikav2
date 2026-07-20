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
    harness.gotoGameScene(pose.levelId);
    await waitForLevel(harness, pose.levelId);
    const scene = game.scene.getScene('GameScene');
    const camera = scene.cameras.main;
    camera.setZoom(pose.zoom);
    camera.setScroll(pose.scrollX, pose.scrollY);
    await nextFrame();
    await nextFrame();
    const snapshot = await waitForLevel(harness, pose.levelId);
    if (Math.abs(snapshot.cameraZoom - pose.zoom) > EPSILON
      || Math.abs(snapshot.cameraScrollX - pose.scrollX) > EPSILON
      || Math.abs(snapshot.cameraScrollY - pose.scrollY) > EPSILON) {
      throw new Error(`[zoom-eval ${pose.levelId}] effective pose mismatch: requested ${JSON.stringify(pose)}, got ${JSON.stringify({ zoom: snapshot.cameraZoom, scrollX: snapshot.cameraScrollX, scrollY: snapshot.cameraScrollY })}`);
    }
    const pngDataUrl = game.canvas.toDataURL('image/png');
    if (!pngDataUrl.startsWith('data:image/png;base64,') || pngDataUrl.length < 100) {
      throw new Error(`[zoom-eval ${pose.levelId}] canvas serialization was blank`);
    }
    return Object.freeze({
      levelId: pose.levelId,
      pngDataUrl,
      zoom: snapshot.cameraZoom,
      scrollX: snapshot.cameraScrollX,
      scrollY: snapshot.cameraScrollY,
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

