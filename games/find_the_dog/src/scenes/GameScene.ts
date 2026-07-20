import Phaser from 'phaser';
import { Capacitor } from '@capacitor/core';
import { COLORS, GAME, GAMEPLAY, TEST_HARNESS_ENABLED, TIMING } from '../core/Constants';
import { gameState } from '../core/GameState';
import { disposeLevelUrls, getLevelIndex, loadLevel, loadLevelForProgression, withDirectSelectServingAttempt } from '../data/levels';
import type { LevelData, LevelDog, LevelSection } from '../data/levels';
import { playFind, playWrongTap, preloadDogFoundSounds } from '../audio/AudioManager';
import { crossfadeTo as crossfadeAmbient, presetForLevel } from '../audio/AmbientManager';
import { adService, showRewardedAdForEconomy } from '../ads/Service';
import { trackRewardedWatchedIfGranted } from '../attribution/RewardedAttribution';
import { analytics } from '../analytics/AnalyticsService';
import { resolveAnalyticsLevelAttributionFromServingAttempt, type AnalyticsLevelAttribution } from '../analytics/AnalyticsEventContract';
import { hapticFound, hapticWrong, hapticLevelComplete } from '../haptics/HapticsManager';
import {
  updateHUD,
  animateLifeLost,
  setHintCallback,
  setDebugOverlayCallback,
  setLevelSelectCallback,
  setHomeCallback,
  setGameModeChangeCallback,
} from '../ui/HUD';
import { showTutorialOverlay, phaserPointToCssPoint, type TutorialHandle } from '../ui/TutorialOverlay';
import { preloadLevelCompleteAssets, showLevelCompleteOverlay, dismissLevelCompleteOverlay } from '../ui/LevelCompleteOverlay';
import type { RatePromptHandle } from '../ui/RatePrompt';
import { showLevelFailedOverlay, type FailContinueActionContext } from '../ui/LevelFailedOverlay';
import {
  hidePlayEntryTransitionCoverAfterSceneRender,
  hideSceneTransitionCoverAfterPaint,
  showSceneTransitionCover,
} from '../ui/SceneTransitionCover';
import { remoteConfigService } from '../config/RemoteConfigService';
import { buildFailContinueOffers, type FailContinueOfferSet, type FailContinueOption } from '../shop/FailContinueOffers';
import { iapService } from '../shop/IapService';
import { buildShopCatalog } from '../shop/ProductCatalog';
import { fulfillVerifiedPurchaseOnce, makePurchaseRestoreRetry, reportUnfulfilledPurchase } from '../shop/PurchaseFulfillment';
import { buildDogFoundAnalyticsParams, buildHintUsedAnalyticsParams } from './GameSceneAnalytics';
import {
  type CancelScheduledIdleWork,
  hasUserActivated,
  runWhenVisibleAndIdle,
} from '../platform/browserScheduling';
import { registerLifecycleHooks } from '../platform/gameLifecycle';
import { computeVoronoiCell, maxDistToPolygon, pointInPolygon } from '../utils/voronoi';
import type { Point } from '../utils/voronoi';
import { SectionController } from './SectionController';
import { PinchZoom, PINCH } from './PinchZoom';
import { MicroAnimationLayer, type MicroAnimationSnapshot } from '../effects/MicroAnimationLayer';
import { FALLBACK_RUNTIME_TEXTURE_LONG_EDGE, resolveRuntimeTextureLongEdge } from './RuntimeTexturePolicy';

export interface GameSceneData {
  levelId?: string;
  levelData?: LevelData;
}

/** A revealed cell: its polygon in level coords + pre-computed screen points. */
interface RevealedCell {
  polygon: Point[];
  screenPoints: Phaser.Geom.Point[];
}

interface RevealContext {
  bounds: Point[];
  otherSites: Point[];
}

type HitboxVisibilityWarning = 'clipped' | 'near border' | 'HUD' | 'AD' | 'SAFE_L' | 'SAFE_R';

const CLASSIC_REVEAL_EDGE_FEATHER_PX = 10;
const RESTORATION_CLEANUP_FOOTPRINT_SCALE = 2;
const FAST_E2E_UI = String(import.meta.env.VITE_FTD_FAST_E2E_UI) === 'true';
const TUTORIAL_PROMPT_DELAY_MS = FAST_E2E_UI ? 40 : 500;
// Zoom increase (in camera-zoom units, minZoom 1.0 → maxZoom 2.5) required over
// the baseline captured at zoom-step entry before the tutorial completes. Small
// enough that any deliberate pinch clears it, large enough to ignore jitter.
const TUTORIAL_ZOOM_COMPLETE_DELTA = 0.05;
const NONCRITICAL_PRELOAD_DELAY_MS = 1_500;
const NONCRITICAL_PRELOAD_IDLE_TIMEOUT_MS = 5_000;
const AMBIENT_START_DELAY_MS = 1_500;
const AMBIENT_IDLE_TIMEOUT_MS = 3_000;

type ClassicRenderPath = 'bitmap-mask' | 'cpu-composite' | 'patch-composite' | 'restoration-bitmap-mask';

interface DirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LevelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ViewportEffectSnapshot {
  kind: 'paw' | 'dust' | 'wrong-tap';
  requested: Point;
  emitted: Point;
}

interface ClassicPatch {
  textureKey: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: Phaser.GameObjects.Image;
  rect: DirtyRect;
}

export interface RuntimeTextureSnapshot {
  sourceWidth: number;
  sourceHeight: number;
  displayWidth: number | null;
  displayHeight: number | null;
}

export interface RuntimeTexturesSnapshot {
  maxLongEdge: number;
  color: RuntimeTextureSnapshot | null;
  bw: RuntimeTextureSnapshot | null;
  bg: RuntimeTextureSnapshot[];
}

export interface ClassicRenderDiagnosticsSnapshot {
  platform: string;
  renderer: 'webgl' | 'canvas' | 'unknown';
  classicRenderPath: ClassicRenderPath;
  maskCanvas: { width: number; height: number } | null;
  compositeCanvas: { width: number; height: number } | null;
  probes: {
    canvasFilterGrayscale: boolean;
    generatedBwTextureGrayscale: boolean | null;
    sourceInEmptyMaskHidesColor: boolean;
    destinationInEmptyMaskHidesColor: boolean;
    bitmapMaskPipelineAvailable: boolean;
  };
  lastReveal: {
    frames: number;
    totalMaskRedrawMs: number;
    totalMaskRefreshMs: number;
    totalCpuCompositeMs: number;
    maxFrameMs: number;
    lastDirtyArea: number;
  };
}

export class GameScene extends Phaser.Scene {
  private level: LevelData | null = null;
  private bwImage: Phaser.GameObjects.Image | null = null;
  private colorImage: Phaser.GameObjects.Image | null = null;
  private runtimeTextureLongEdge = FALLBACK_RUNTIME_TEXTURE_LONG_EDGE;

  // Canvas-based mask. Classic mode composites bw + masked color on CPU
  // (BitmapMask is unreliable on iOS WKWebView). Restoration keeps BitmapMask.
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private permanentCanvas: HTMLCanvasElement | null = null;
  private permanentCtx: CanvasRenderingContext2D | null = null;
  private maskImage: Phaser.GameObjects.Image | null = null;
  /** Classic mode: single visible layer (bw base + masked color overlay). */
  private compositeCanvas: HTMLCanvasElement | null = null;
  private compositeCtx: CanvasRenderingContext2D | null = null;
  private compositeImage: Phaser.GameObjects.Image | null = null;
  /** Scratch buffer for masked color before blitting onto compositeCanvas. */
  private classicOverlayCanvas: HTMLCanvasElement | null = null;
  private classicOverlayCtx: CanvasRenderingContext2D | null = null;
  /** iOS classic: static bw base baked once per level (overlay mutates on reveal). */
  private classicBaseCanvas: HTMLCanvasElement | null = null;
  private classicBaseBaked: boolean = false;
  private classicRenderPath: ClassicRenderPath = 'bitmap-mask';
  /** Fallback for iOS builds where WebGL/custom pipelines are unavailable. */
  private classicUsesCpuComposite: boolean = false;
  private classicUsesPatchComposite: boolean = false;
  private classicActivePatch: ClassicPatch | null = null;
  private classicPatchImages: Phaser.GameObjects.Image[] = [];
  private classicPatchTextureKeys: string[] = [];
  private classicPatchTextureCounter: number = 0;
  private pendingRevealDirtyRect: DirtyRect | null = null;
  private classicRenderProbes: ClassicRenderDiagnosticsSnapshot['probes'] = {
    canvasFilterGrayscale: false,
    generatedBwTextureGrayscale: null,
    sourceInEmptyMaskHidesColor: false,
    destinationInEmptyMaskHidesColor: false,
    bitmapMaskPipelineAvailable: false,
  };
  private lastRevealDiagnostics: ClassicRenderDiagnosticsSnapshot['lastReveal'] = {
    frames: 0,
    totalMaskRedrawMs: 0,
    totalMaskRefreshMs: 0,
    totalCpuCompositeMs: 0,
    maxFrameMs: 0,
    lastDirtyArea: 0,
  };

  private revealedCells: RevealedCell[] = [];
  private activeRevealRadius: number = 0;
  private activeRevealCenter: Point | null = null;
  private activeRevealPolygon: Point[] | null = null;
  private activeRevealTween: Phaser.Tweens.Tween | null = null;
  private activeRevealDirty: boolean = false;

  /**
   * Restoration mode: resolved once in `setupLevel` and stable for the
   * scene's lifetime. A mid-level Settings toggle updates
   * `gameState.settings.gameMode` + saves — but the active level keeps
   * its mode until the next scene.restart (init() resets this field;
   * setupLevel recomputes it). This lock prevents garbage renders: the
   * bg layer was placed / not placed and the mask pre-filled / not at
   * setup time, so flipping mid-level would mismatch visible state.
   */
  private isRestoration: boolean = false;
  /** Restoration mode: per-section (landscape) or single (portrait) clean background images. */
  private bgLayers: Phaser.GameObjects.Image[] = [];
  /**
   * Mirrored copies of the clean bg flipped into the letterbox margin so a
   * contain-scaled image reads as extending past its edge instead of sitting
   * on bars. Decorative only — sit behind everything, never interactive.
   */
  private edgeMirrorImages: Phaser.GameObjects.Image[] = [];
  /**
   * Restoration mode: in-flight dissolve cells for legacy animated deletes.
   * New deletes complete instantly, but this remains for shutdown safety,
   * old active-cell hit testing, and tests that inspect the runtime shape.
   */
  private dissolveActiveCells: Array<{
    dogId: string;
    polygon: Point[];
    screenPoints: Phaser.Geom.Point[];
    alpha: number;
  }> = [];
  /** Restoration mode: dissolve cells that have finished animating and now exist only in permanentCanvas. Kept for hit-testing (tap-on-revealed-area). */
  private dissolveCompletedCells: Array<{ polygon: Point[] }> = [];
  private lastRestorationDissolveBounds: LevelRect | null = null;
  private pickupAnimationsActive: number = 0;
  private pickupAnimationsCompleted: number = 0;
  private microAnimationLayer: MicroAnimationLayer | null = null;
  private levelComplete: boolean = false;
  private levelDataReady: boolean = false;
  private levelStartedAt: number = 0;
  private wrongTapsCount: number = 0;
  private hintsUsedThisLevel: number = 0;
  private lastViewportEffect: ViewportEffectSnapshot | null = null;
  private analyticsLevelAttribution: AnalyticsLevelAttribution | null = null;

  /** Scale factor: canvas pixels per level pixel */
  imgScale: number = 1;
  /** X offset of the level image in canvas coords */
  imgOffsetX: number = 0;
  /** Y offset of the level image in canvas coords */
  imgOffsetY: number = 0;

  /** Set for landscape levels with a `sections` array; null for portrait/legacy levels. */
  private sectionController: SectionController | null = null;

  /** Two-finger pinch-zoom gesture controller; bounded to section (landscape) or full level (portrait). */
  private pinchZoom: PinchZoom | null = null;


  /** Active tutorial handle (field-tracked so shutdown can dismiss cleanly without leaking DOM). */
  private tutorialHandle: TutorialHandle | null = null;
  /** Active tutorial highlight ring. Null when tutorial not shown. */
  private tutorialRing: Phaser.GameObjects.Graphics | null = null;
  private tutorialRingTween: Phaser.Tweens.Tween | null = null;
  /**
   * True while the tutorial is on its final zoom step, waiting for the player
   * to perform a real pinch-zoom. `update()` completes the tutorial once the
   * camera zooms in past `tutorialZoomBaseline`.
   */
  private tutorialAwaitingZoom = false;
  /**
   * Camera zoom captured when the zoom step is entered. Completion requires the
   * player to zoom in *beyond* this — so a camera that was already zoomed (the
   * player pinched during an earlier step and stayed zoomed) doesn't instantly
   * satisfy an absolute `isZoomed()` check and flash the lesson away in a frame.
   */
  private tutorialZoomBaseline: number = PINCH.minZoom;
  /**
   * True while the tutorial is on step 2 (the "try a hint" bubble). The next
   * hint-button tap advances the tutorial to the zoom step and is SUPPRESSED in
   * onHintRequested — so no hint circle pulses during the zoom lesson and no
   * hint is spent on a tutorial tap. Set here (before the tap) rather than
   * relying on event ordering, which is not guaranteed at the target element.
   */
  private tutorialHintStep = false;

  /** Active rate-prompt handle. Set while a rate prompt is on screen. */
  ratePromptHandle: RatePromptHandle | null = null;

  private pointerDownAt: { x: number; y: number } | null = null;
  private preserveLevelUrlsOnShutdown: boolean = false;

  /**
   * True once this scene's shutdown handler has started. Microtasks queued
   * by overlay `.dismissed.then()` chains fire AFTER the handler's sync
   * block (including tweens.killAll); any tween/scene work in those
   * callbacks must check this flag first to avoid adding to a dead
   * tween manager or restarting an already-shut-down scene.
   */
  private isShuttingDown: boolean = false;
  private cancelNonCriticalPreloadSchedule: CancelScheduledIdleWork | null = null;
  private cancelAmbientCrossfadeSchedule: CancelScheduledIdleWork | null = null;
  private unregisterLifecycleHooks: (() => void) | null = null;
  private wasClockPausedBeforeLifecycleSuspend: boolean = false;
  private wasTweenManagerPausedBeforeLifecycleSuspend: boolean = false;
  private wasMicroAnimationLayerActiveBeforeLifecycleSuspend: boolean = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: GameSceneData): void {
    this.level = data.levelData ?? null;
    this.maskCanvas = null;
    this.maskCtx = null;
    this.permanentCanvas = null;
    this.permanentCtx = null;
    this.maskImage = null;
    this.compositeCanvas = null;
    this.compositeCtx = null;
    this.compositeImage = null;
    this.classicOverlayCanvas = null;
    this.classicOverlayCtx = null;
    this.classicBaseCanvas = null;
    this.classicBaseBaked = false;
    this.classicRenderPath = 'bitmap-mask';
    this.classicUsesCpuComposite = false;
    this.classicUsesPatchComposite = false;
    this.classicActivePatch = null;
    this.classicPatchImages = [];
    this.classicPatchTextureKeys = [];
    this.classicPatchTextureCounter = 0;
    this.pendingRevealDirtyRect = null;
    this.classicRenderProbes = this.runClassicRenderProbes();
    this.resetRevealDiagnostics();
    this.revealedCells = [];
    this.activeRevealRadius = 0;
    this.activeRevealCenter = null;
    this.activeRevealPolygon = null;
    this.activeRevealTween = null;
    this.activeRevealDirty = false;
    this.levelComplete = false;
    this.levelDataReady = false;
    this.wrongTapsCount = 0;
    this.hintsUsedThisLevel = 0;
    this.lastViewportEffect = null;
    this.analyticsLevelAttribution = null;
    this.sectionController = null;
    this.pinchZoom = null;
    this.tutorialHandle = null;
    this.tutorialRing = null;
    this.tutorialRingTween = null;
    this.tutorialAwaitingZoom = false;
    this.tutorialHintStep = false;
    this.ratePromptHandle = null;
    this.pointerDownAt = null;
    this.preserveLevelUrlsOnShutdown = false;
    this.isShuttingDown = false;
    this.cancelNonCriticalPreloadSchedule?.();
    this.cancelNonCriticalPreloadSchedule = null;
    this.cancelAmbientCrossfadeSchedule?.();
    this.cancelAmbientCrossfadeSchedule = null;
    this.unregisterLifecycleHooks?.();
    this.unregisterLifecycleHooks = null;
    this.wasClockPausedBeforeLifecycleSuspend = false;
    this.wasTweenManagerPausedBeforeLifecycleSuspend = false;
    this.wasMicroAnimationLayerActiveBeforeLifecycleSuspend = false;
    this.isRestoration = false;
    this.bgLayers = [];
    this.edgeMirrorImages = [];
    this.dissolveActiveCells = [];
    this.dissolveCompletedCells = [];
    this.pickupAnimationsActive = 0;
    this.pickupAnimationsCompleted = 0;
    this.microAnimationLayer?.stop();
    this.microAnimationLayer = null;
    // Phaser destroyed the previous scene's debug overlay objects on
    // shutdown, but these field references survive `scene.restart()`.
    // Without resetting them, `showDebugOverlay()` early-returns because
    // it sees `this.debugGfx` as truthy and assumes the overlay is
    // already drawn — so toggling debug ON before a transition silently
    // fails to redraw on the next level.
    this.debugGfx = null;
    this.debugTexts = [];

    gameState.reset();
  }

  /**
   * Restoration mode is active iff the user picked it. Once selected, the
   * level must satisfy the restoration asset contract; missing clean bg or
   * sprite metadata is a broken level, not a request to switch cleanup paths.
   */
  private isRestorationMode(): boolean {
    if (gameState.settings.gameMode !== 'restoration') return false;
    const level = this.level;
    if (!level) return false;
    this.assertRestorationLevelReady(level);
    return true;
  }

  preload(): void {
    if (!this.level) return;
    const level = this.level;

    // Reuse textures across same-level scene.restarts (fail overlay,
    // tutorial reset). ~10 MB of decode + GPU upload saved per restart
    // for a landscape level. When the level id changes, nuke + reload.
    // setupLevel will still re-run, so this only skips the heavy
    // texture work; mask canvases + positioning all recompute.
    const levelChanged = GameScene.lastLoadedLevelId !== level.id;
    if (levelChanged) {
      if (this.textures.exists('color')) this.textures.remove('color');
      if (this.textures.exists('bw_generated')) this.textures.remove('bw_generated');
      for (const key of GameScene.lastLoadedSpriteTextureKeys) {
        if (this.textures.exists(key)) this.textures.remove(key);
      }
      GameScene.lastLoadedSpriteTextureKeys = [];
      this.load.image('color', level.colorImage);
    }

    // Restoration mode: load either one full-level bg or one bg texture per
    // section. Keys match the index so setupLevel can look them up by section
    // number. Only load keys that aren't already in
    // the texture cache — skips the reload for same-level restarts and
    // picks up new bgs when the level changed or the mode toggled from
    // Classic to Restoration between sessions.
    if (this.isRestorationMode()) {
      const urls = level.bgImageUrls!;
      for (let i = 0; i < urls.length; i++) {
        const key = `bg_${i}`;
        if (levelChanged && this.textures.exists(key)) this.textures.remove(key);
        if (!this.textures.exists(key)) this.load.image(key, urls[i]);
      }
      const spriteKeys: string[] = [];
      for (const dog of level.dogs) {
        const sprite = this.restorationSpriteForDog(dog);
        const key = this.spriteTextureKeyForDog(dog);
        spriteKeys.push(key);
        if (!this.textures.exists(key)) this.load.image(key, sprite.image);
      }
      GameScene.lastLoadedSpriteTextureKeys = spriteKeys;
    }

    GameScene.lastLoadedLevelId = level.id;
  }

  /** Survives scene.restart — the preload skip gate (todo 049). */
  private static lastLoadedLevelId: string | null = null;
  private static lastLoadedSpriteTextureKeys: string[] = [];

  /** TEMP perf instrumentation (ftd-play-load-perf): tap→ready timing. */
  /**
   * Warm a level's GPU textures off the Play-tap critical path.
   *
   * Phaser 3.90's loader decodes + uploads images on the main thread inside
   * `preload()`. For a restoration level (color + one bg per section + dog
   * sprites) that costs ~850ms on a mid-range Android WebView — the entire
   * felt "chug" after tapping Play. Here we decode each source via
   * `HTMLImageElement.decode()` (off the main thread in Chromium) while the
   * player sits on the home map, then `addImage()` uploads to the GPU. By the
   * time Play is pressed, `preload()` finds every texture already cached and
   * becomes a no-op (measured tap→ready ~64ms vs ~960ms).
   *
   * Keys MUST match `preload()` / `spriteTextureKeyForDog()` exactly:
   * `'color'`, `bg_${i}`, and `dog_sprite_${level.id}_${dog.id}`. On full
   * success we set the same `lastLoadedLevelId` / `lastLoadedSpriteTextureKeys`
   * bookkeeping `preload()` reads for its skip gate, so its `levelChanged`
   * branch won't evict the warmed textures.
   *
   * `isStale()` lets the caller abort a warm that has been superseded — a CDN
   * fallback may serve a different level than the one being warmed, in which
   * case the launching scene's loader will claim the shared `'color'`/`bg_i`
   * keys and we must stop touching them. Callers await this before
   * `scene.start` for the matching level, and flip `isStale` for a divergent
   * one, so a warm never races Phaser's loader on the same key.
   */
  static async prewarmLevel(
    textures: Phaser.Textures.TextureManager,
    level: LevelData,
    isStale: () => boolean,
  ): Promise<void> {
    const targets: Array<{ key: string; url: string }> = [{ key: 'color', url: level.colorImage }];
    for (let i = 0; i < (level.bgImageUrls?.length ?? 0); i++) {
      targets.push({ key: `bg_${i}`, url: level.bgImageUrls![i] });
    }
    const spriteKeys: string[] = [];
    for (const dog of level.dogs) {
      const spriteUrl = dog.sprite?.image;
      if (spriteUrl === undefined) continue;
      const key = `dog_sprite_${level.id}_${dog.id}`;
      spriteKeys.push(key);
      targets.push({ key, url: spriteUrl });
    }

    // Warming a different level than the one currently resident: evict its
    // textures first. `'color'`/`bg_i` are shared keys (addImage throws on a
    // live key) and per-level dog sprites would otherwise leak — preload's own
    // levelChanged eviction won't run once the skip-gate write below makes it a
    // no-op. Invalidate the gate up front so that if we bail early (stale or a
    // decode throws) preload() reloads from scratch rather than trusting
    // half-evicted state. Safe to remove here: prewarm only runs on the
    // foreground HomeScene, with no live GameScene rendering these textures.
    if (GameScene.lastLoadedLevelId !== level.id) {
      GameScene.lastLoadedLevelId = null;
      if (textures.exists('color')) textures.remove('color');
      if (textures.exists('bw_generated')) textures.remove('bw_generated');
      for (const key of GameScene.lastLoadedSpriteTextureKeys) {
        if (textures.exists(key)) textures.remove(key);
      }
      GameScene.lastLoadedSpriteTextureKeys = [];
    }

    for (const { key, url } of targets) {
      if (isStale()) return;
      if (textures.exists(key)) continue;
      const img = new Image();
      img.src = url;
      await img.decode();
      // Re-check after the await: a divergent launch may have marked us stale,
      // or another path populated the key while we decoded. addImage() on a
      // live key throws in Phaser, so guard both.
      if (isStale()) return;
      if (textures.exists(key)) continue;
      textures.addImage(key, img);
    }

    if (isStale()) return;
    GameScene.lastLoadedLevelId = level.id;
    GameScene.lastLoadedSpriteTextureKeys = spriteKeys;
  }

  create(): void {
    if (!this.level) {
      showSceneTransitionCover();
      this.loadLevelAndRestart();
      return;
    }
    this.setupLevel();
    this.scheduleNonCriticalPreloads();
  }

  private scheduleNonCriticalPreloads(): void {
    const run = (): void => {
      if (this.isShuttingDown || !this.sys.isActive()) return;
      void preloadLevelCompleteAssets();
      if (hasUserActivated()) void preloadDogFoundSounds();
    };

    if (FAST_E2E_UI) {
      run();
      return;
    }

    this.cancelNonCriticalPreloadSchedule?.();
    this.cancelNonCriticalPreloadSchedule = runWhenVisibleAndIdle(run, {
      delayMs: NONCRITICAL_PRELOAD_DELAY_MS,
      idleTimeoutMs: NONCRITICAL_PRELOAD_IDLE_TIMEOUT_MS,
      shouldRun: () => !this.isShuttingDown && this.sys.isActive(),
    });
  }

  override update(): void {
    // Final tutorial step: complete once the player zooms in beyond the level
    // captured when the step began. Polling here (rather than an event) keeps
    // PinchZoom free of tutorial coupling — it already owns the camera zoom; we
    // just observe it. Requiring an increase over the baseline (not an absolute
    // isZoomed()) avoids instant-completing when the camera was already zoomed.
    if (
      this.tutorialAwaitingZoom &&
      this.cameras.main.zoom > this.tutorialZoomBaseline + TUTORIAL_ZOOM_COMPLETE_DELTA
    ) {
      this.tutorialAwaitingZoom = false;
      this.tutorialHintStep = false;
      this.tutorialHandle?.dismiss(true);
    }

    if (this.activeRevealDirty) {
      this.activeRevealDirty = false;
      const dirtyRect = this.pendingRevealDirtyRect ?? this.getActiveRevealDirtyRect();
      this.pendingRevealDirtyRect = null;
      this.redrawComposite(dirtyRect);
    }
  }

  /**
   * Generation token for `loadLevelAndRestart`. Bumped on every call AND
   * on every style-swap restart. Each in-flight load captures the value
   * at start; on resolve, it bails if the token changed — preventing a
   * stale `scene.restart({ levelData })` from a load that started under
   * the old style from stomping the fresh restart.
   */
  private static loadGen: number = 0;

  private async loadLevelAndRestart(): Promise<void> {
    GameScene.loadGen += 1;
    const myGen = GameScene.loadGen;
    try {
      const index = await getLevelIndex();
      if (myGen !== GameScene.loadGen) return;
      if (index.length === 0) {
        console.error('No portrait levels available');
        hideSceneTransitionCoverAfterPaint();
        return;
      }
      gameState.reconcileLevelOrder(index.map((entry) => entry.id));
      const levelData = await loadLevelForProgression(gameState.currentLevelIndex);
      if (myGen !== GameScene.loadGen) {
        // A newer load superseded us. `loadLevelForProgression` created
        // and cached Object URLs under the served level id; if we just
        // drop `levelData` without revoking, the Blob URLs live until
        // the next explicit disposeLevelUrls(servedId) call. Revoke now
        // so the stale load doesn't pin memory.
        disposeLevelUrls(levelData.id);
        return;
      }
      this.scene.restart({ levelData } as GameSceneData);
    } catch (error) {
      console.error('Failed to load level', error);
      hideSceneTransitionCoverAfterPaint();
      return;
    }
  }

  private async trackLevelStart(): Promise<void> {
    if (!this.level) return;
    const level = this.level;
    const levelAttribution = this.resolveCurrentLevelAnalyticsAttribution(level);
    await analytics.levelStart({
      level_id: level.id,
      level_name: level.name,
      ...(levelAttribution ?? {}),
    });
  }

  private async trackLevelComplete(timeSeconds: number): Promise<void> {
    if (!this.level) return;
    const level = this.level;
    const levelAttribution = this.resolveCurrentLevelAnalyticsAttribution(level);
    await analytics.levelComplete({
      level_id: level.id,
      time_seconds: timeSeconds,
      hints_used: this.hintsUsedThisLevel,
      wrong_taps: this.wrongTapsCount,
      ...(levelAttribution ?? {}),
    });
  }

  private async trackLevelFailed(dogsFound: number): Promise<void> {
    if (!this.level) return;
    const level = this.level;
    const levelAttribution = this.resolveCurrentLevelAnalyticsAttribution(level);
    await analytics.levelFailed({
      level_id: level.id,
      dogs_found: dogsFound,
      ...(levelAttribution ?? {}),
    });
  }

  private trackDogFoundAnalytics(dogIndex: number, timeSinceStart: number): void {
    if (!this.level) return;
    void analytics.dogFound(buildDogFoundAnalyticsParams(this.level, dogIndex, timeSinceStart));
  }

  private trackHintUsedAnalytics(): void {
    if (!this.level) return;
    void analytics.hintUsed(buildHintUsedAnalyticsParams(this.level, gameState.foundDogIds.size));
  }

  private resolveCurrentLevelAnalyticsAttribution(level: LevelData): AnalyticsLevelAttribution | null {
    if (this.analyticsLevelAttribution !== null) return this.analyticsLevelAttribution;
    try {
      const servingAttempt = level.servingAttempt;
      if (servingAttempt === undefined) return null;
      const levelAttribution = resolveAnalyticsLevelAttributionFromServingAttempt(servingAttempt);
      this.analyticsLevelAttribution = levelAttribution;
      return levelAttribution;
    } catch (error) {
      console.warn('[analytics] level attribution unavailable:', error);
      return null;
    }
  }

  private setupLevel(): void {
    if (!this.level) return;

    if (gameState.settings.adsEnabled) {
      void adService.showBanner().then((shown: boolean): void => {
        if (!this.level) return;
        if (shown) {
          void analytics.adShown({ ad_type: 'banner', placement: 'gameplay' });
        } else if (adService.enabled) {
          // 38% of banner shows in the UA test failed invisibly — GA's native
          // integration saw them, our owned funnel did not. Count them here.
          void analytics.adShowFailed({ ad_type: 'banner', placement: 'gameplay', reason: 'not_shown' });
        }
      });
    }

    const sections = this.level.sections;
    const isSectioned = Array.isArray(sections) && sections.length > 0;

    if (isSectioned) {
      // Landscape / wide level — the image fills the portrait viewport
      // vertically (cover-scale on height), overflows horizontally, and
      // the camera slides across that single continuous image per section.
      // No letterbox: HUD + banner sit on top of the scene image (same as
      // portrait levels). Dogs placed in the level's HUD/banner forbidden
      // zones (top/bottom strips) are still behind the UI, which is why
      // the generator excludes those strips during hitbox placement.
      const scaleX = GAME.WIDTH / this.level.width;
      const scaleY = GAME.HEIGHT / this.level.height;
      this.imgScale = Math.max(scaleX, scaleY);
      this.imgOffsetX = 0;
      this.imgOffsetY = (GAME.HEIGHT - this.level.height * this.imgScale) / 2;
    } else {
      // Portrait / square — scale to CONTAIN: fit the whole image inside the
      // viewport so no dog is ever cropped off-screen (cover-scale cropped the
      // overflow dimension and pushed edge dogs out of reach, making some
      // levels unplayable). The resulting letterbox margin is filled with a
      // mirror of the clean bg (addEdgeMirrors) so it reads as the scene
      // continuing, not as bars.
      const scaleX = GAME.WIDTH / this.level.width;
      const scaleY = GAME.HEIGHT / this.level.height;
      this.imgScale = Math.min(scaleX, scaleY);
      this.imgOffsetX = (GAME.WIDTH - this.level.width * this.imgScale) / 2;
      this.imgOffsetY = (GAME.HEIGHT - this.level.height * this.imgScale) / 2;
    }

    // Resolve Restoration once and field-cache it. All subsequent
    // per-frame / per-tap paths read `this.isRestoration`; the predicate
    // only runs in preload (before this field exists) and here. See the
    // field's JSDoc for the mid-level-toggle rationale.
    this.isRestoration = this.isRestorationMode();
    if (this.isRestoration && !this.hasLoadedRestorationSpriteTextures()) {
      throw new Error(`Restoration level ${this.level.id} is missing loaded dog sprite textures`);
    }
    const isRestoration = this.isRestoration;
    this.runtimeTextureLongEdge = this.resolveRuntimeTextureLongEdge();
    this.capTextureLongEdge('color');
    if (isRestoration) {
      if (this.textures.exists('bw_generated')) this.textures.remove('bw_generated');
      const bgCount = this.level.bgImageUrls?.length ?? 0;
      for (let i = 0; i < bgCount; i += 1) this.capTextureLongEdge(`bg_${i}`);
    } else {
      this.generateGrayscaleTexture();
    }
    this.classicRenderProbes = {
      ...this.classicRenderProbes,
      generatedBwTextureGrayscale: this.isGeneratedBwTextureGrayscale(),
    };

    // Restoration mode: clean bg layer(s) go FIRST (behind everything).
    // Landscape supports either a single full-level bg or one bg per section.
    // Portrait uses a single bg covering the full level.
    // Sections are assumed generated at section-native dimensions
    // (section width × level height) — landscape bg images land in place
    // at section.xStart without extra scaling. Portrait bg matches
    // color.png exactly.
    if (isRestoration) {
      const urls = this.level.bgImageUrls!;
      if (isSectioned && sections) {
        if (urls.length === 1) {
          const bg = this.add.image(0, 0, 'bg_0');
          bg.setOrigin(0, 0);
          bg.setPosition(this.imgOffsetX, this.imgOffsetY);
          bg.setDisplaySize(this.level.width * this.imgScale, this.level.height * this.imgScale);
          this.bgLayers.push(bg);
        } else {
          for (let i = 0; i < urls.length && i < sections.length; i++) {
            const sec = sections[i];
            const bg = this.add.image(0, 0, `bg_${i}`);
            bg.setOrigin(0, 0);
            bg.setPosition(
              this.imgOffsetX + sec.xStart * this.imgScale,
              this.imgOffsetY,
            );
            bg.setDisplaySize((sec.xEnd - sec.xStart) * this.imgScale, this.level.height * this.imgScale);
            this.bgLayers.push(bg);
          }
        }
      } else {
        const bg = this.add.image(0, 0, 'bg_0');
        bg.setOrigin(0, 0);
        bg.setPosition(this.imgOffsetX, this.imgOffsetY);
        bg.setDisplaySize(this.level.width * this.imgScale, this.level.height * this.imgScale);
        this.bgLayers.push(bg);
      }
    }

    // B&W base layer (grayscale of color.png — dogs ARE visible).
    // Restoration mode skips the grayscale texture entirely: the bg layer is
    // the default view and the color layer (with dogs) dissolves away on find.
    if (!isRestoration) {
      this.bwImage = this.add.image(0, 0, 'bw_generated');
      this.bwImage.setOrigin(0, 0);
      this.bwImage.setPosition(this.imgOffsetX, this.imgOffsetY);
      this.bwImage.setDisplaySize(this.level.width * this.imgScale, this.level.height * this.imgScale);
    }

    // Color layer (full color with dogs)
    this.colorImage = this.add.image(0, 0, 'color');
    this.colorImage.setOrigin(0, 0);
    this.colorImage.setPosition(this.imgOffsetX, this.imgOffsetY);
    this.colorImage.setDisplaySize(this.level.width * this.imgScale, this.level.height * this.imgScale);

    // Fill the contain-scale letterbox margin with a flipped copy of the clean
    // bg so edges look like the scene continues. Restoration uses bg_0 (no
    // dogs, so the margin never shows a phantom uncatchable dog); classic falls
    // back to the color image.
    const mirrorTexture = isRestoration && this.textures.exists('bg_0') ? 'bg_0' : 'color';
    this.addEdgeMirrors(mirrorTexture);

    // Canvas-based mask — plain 2D canvas updated each frame, pushed to WebGL via refresh().
    // More reliable than RenderTexture BitmapMask which doesn't update dynamically on mobile WebGL.
    // Sized to cover the full color-image world extent so dogs in off-viewport
    // sections (landscape levels) can still write their reveal cells to the mask.
    // For portrait/square levels this collapses to GAME.WIDTH×GAME.HEIGHT (unchanged).
    const colorExtentW = Math.max(GAME.WIDTH, Math.ceil(this.level.width * this.imgScale));
    const colorExtentH = Math.max(GAME.HEIGHT, Math.ceil(this.level.height * this.imgScale));
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = colorExtentW;
    this.maskCanvas.height = colorExtentH;

    // Persistent canvas for completed cells — avoids re-drawing all polygons every frame
    this.permanentCanvas = document.createElement('canvas');
    this.permanentCanvas.width = colorExtentW;
    this.permanentCanvas.height = colorExtentH;
    this.permanentCtx = this.permanentCanvas.getContext('2d')!;

    // Register the mask canvas with Phaser BEFORE acquiring a 2D context.
    // Safari/WKWebView can attach a second context when willReadFrequently
    // differs; drawing on our own pre-Phaser context then leaves the GPU
    // mask texture stale (classic starts fully color-revealed on iOS).
    if (this.textures.exists('reveal_mask')) this.textures.remove('reveal_mask');
    this.textures.addCanvas('reveal_mask', this.maskCanvas);
    const revealMaskTexture = this.textures.get('reveal_mask') as Phaser.Textures.CanvasTexture;
    this.maskCtx = revealMaskTexture.context;

    // In restoration mode the mask starts OPAQUE white (colorImage fully
    // visible, dogs still in place); dog-found carves transparency into
    // the mask via destination-out, letting bg show through. In classic
    // the canvas starts transparent (colorImage hidden) and white is
    // painted in for each revealed cell.
    if (isRestoration) {
      this.maskCtx.fillStyle = 'white';
      this.maskCtx.fillRect(0, 0, colorExtentW, colorExtentH);
      this.permanentCtx.fillStyle = 'white';
      this.permanentCtx.fillRect(0, 0, colorExtentW, colorExtentH);
    } else {
      this.maskCtx.clearRect(0, 0, colorExtentW, colorExtentH);
    }

    const isIosClassic = !isRestoration && Capacitor.getPlatform() === 'ios';
    this.classicUsesPatchComposite = isIosClassic;
    this.classicUsesCpuComposite = isIosClassic && !this.classicUsesPatchComposite;
    this.classicRenderPath = isRestoration
      ? 'restoration-bitmap-mask'
      : this.classicUsesPatchComposite
        ? 'patch-composite'
        : this.classicUsesCpuComposite
          ? 'cpu-composite'
          : 'bitmap-mask';
    this.refreshRevealMask();

    if (isRestoration) {
      this.maskImage = this.add.image(0, 0, 'reveal_mask');
      this.maskImage.setOrigin(0, 0);
      this.maskImage.setVisible(false);
      const bitmapMask = this.maskImage.createBitmapMask();
      this.colorImage.setMask(bitmapMask);
    } else if (this.classicUsesPatchComposite) {
      this.colorImage.setVisible(false).setActive(false);
    } else if (this.classicUsesCpuComposite) {
      this.compositeCanvas = document.createElement('canvas');
      this.compositeCanvas.width = colorExtentW;
      this.compositeCanvas.height = colorExtentH;
      this.classicBaseCanvas = document.createElement('canvas');
      this.classicBaseCanvas.width = colorExtentW;
      this.classicBaseCanvas.height = colorExtentH;
      this.classicOverlayCanvas = document.createElement('canvas');
      this.classicOverlayCanvas.width = colorExtentW;
      this.classicOverlayCanvas.height = colorExtentH;
      this.classicOverlayCtx = this.classicOverlayCanvas.getContext('2d')!;

      if (this.textures.exists('classic_composite')) this.textures.remove('classic_composite');
      this.textures.addCanvas('classic_composite', this.compositeCanvas);
      const compositeTexture = this.textures.get('classic_composite') as Phaser.Textures.CanvasTexture;
      this.compositeCtx = compositeTexture.context;

      this.compositeImage = this.add.image(0, 0, 'classic_composite');
      this.compositeImage.setOrigin(0, 0);

      this.bwImage!.setVisible(false).setActive(false);
      this.colorImage.setVisible(false).setActive(false);
      this.bakeClassicCompositeBase();
      this.syncClassicComposite(null);
    } else {
      this.maskImage = this.add.image(0, 0, 'reveal_mask');
      this.maskImage.setOrigin(0, 0);
      this.maskImage.setVisible(false);
      const bitmapMask = this.maskImage.createBitmapMask();
      this.colorImage.setMask(bitmapMask);
    }

    this.createPawTexture();
    this.createDustTexture();

    const pointerDownHandler = (pointer: Phaser.Input.Pointer): void => {
      this.pointerDownAt = { x: pointer.x, y: pointer.y };
    };
    const tapHandler = (pointer: Phaser.Input.Pointer): void => {
      if (this.levelComplete) return;
      if (!this.isTapRelease(pointer)) return;
      // Mid-pan, only allow taps after the midpan threshold AND restrict
      // them to dogs in the destination section. Routing happens inside
      // handleTap; the input gate just blocks pre-midpan input entirely.
      if (this.sectionController?.isPanning && !this.sectionController.isAfterMidpan) return;
      // Pinch gesture in progress: swallow the tap.
      if (this.pinchZoom?.isPinching) return;
      // Zoomed drag just panned the camera; don't treat the release as gameplay.
      if (this.pinchZoom?.isPanning) return;
      // Pass world + screen coords explicitly. World coords drive the
      // hit-test (so landscape section-1+ taps land on the correct dog).
      // Screen coords drive visual effects that should render where the
      // finger landed, not where the world point is.
      this.handleTap({
        worldX: pointer.worldX,
        worldY: pointer.worldY,
        screenX: pointer.x,
        screenY: pointer.y,
      });
    };
    this.input.on('pointerdown', pointerDownHandler);
    this.input.on('pointerup', tapHandler);

    this.pinchZoom = new PinchZoom(this);

    if (import.meta.env.DEV) {
      this.input.keyboard?.on('keydown-D', () => {
        this.toggleDebugOverlay();
      });
    }

    // Instantiate SectionController for landscape levels; set up camera bounds
    // for section 0 so the player starts with the leftmost third in view.
    if (isSectioned && sections) {
      this.sectionController = new SectionController(
        this,
        this.level,
        sections,
        this.imgScale,
        GAME.WIDTH,
        GAME.HEIGHT,
        {
          onSectionEntered: () => this.onRevealedCellComplete(),
        },
      );
      this.sectionController.clampCameraToCurrentSection();
    } else {
      const imageLeft = this.imgOffsetX;
      const imageTop = this.imgOffsetY;
      const imageRight = this.imgOffsetX + this.level.width * this.imgScale;
      const imageBottom = this.imgOffsetY + this.level.height * this.imgScale;
      const boundsX = Math.min(0, imageLeft);
      const boundsY = Math.min(0, imageTop);
      const boundsW = Math.max(GAME.WIDTH, imageRight - boundsX);
      const boundsH = Math.max(GAME.HEIGHT, imageBottom - boundsY);
      this.cameras.main.setBounds(boundsX, boundsY, boundsW, boundsH);
      this.cameras.main.setScroll(0, 0);
    }

    setHintCallback(() => this.onHintRequested());
    this.levelStartedAt = Date.now();
    void this.trackLevelStart();

    setDebugOverlayCallback((on) => {
      if (on) this.showDebugOverlay();
      else this.hideDebugOverlay();
    });
    setLevelSelectCallback((levelId) => {
      void this.selectLevel(levelId);
    });
    setHomeCallback(() => {
      this.scene.start('HomeScene');
    });
    setGameModeChangeCallback(() => {
      if (this.level) {
        this.preserveLevelUrlsOnShutdown = true;
        this.scene.restart({ levelData: this.level });
      }
    });
    updateHUD(this.level.dogs.length, this.isRestoration);
    this.startMicroAnimationsIfEnabled();
    this.levelDataReady = true;
    this.publishClassicRenderDiagnostics();

    // Crossfade to the ambient track for this level (no-op if the level
    // has no mapping — e.g. legacy levels, random pixelart levels).
    this.scheduleAmbientCrossfade(this.level.name);

    // Apply persisted debug-overlay preference. Lets players (and QA)
    // keep the overlay on across scene restarts.
    if (gameState.settings.showDebugOverlay) this.showDebugOverlay();

    hidePlayEntryTransitionCoverAfterSceneRender(this);
    this.registerLifecycleSuspendHooks();

    // First-time tutorial — anchor the first bubble at an actual dog
    // on screen so the arrow reads "there's one right here". A short
    // delay lets the first-find ribbon / level load settle.
    if (
      gameState.settings.tutorialEnabled &&
      !gameState.tutorialShown &&
      this.level.dogs.length > 0
    ) {
      // Tutorial state 2 ("try a hint") requires hintsRemaining > 0 to
      // be reachable — a 0-hint user softlocks on the bubble because
      // the hint button is disabled (or asks for an ad). Top up here
      // so the tutorial can always complete its flow.
      if (gameState.hintsRemaining <= 0) {
        gameState.ensureMinimumHints(GAMEPLAY.INITIAL_HINTS, 'tutorial');
      }
      const dog = this.level.dogs[0];
      const phaserX = this.imgOffsetX + dog.x * this.imgScale;
      const phaserY = this.imgOffsetY + dog.y * this.imgScale;
      this.time.delayedCall(TUTORIAL_PROMPT_DELAY_MS, () => this.showFirstTimeTutorial(dog, phaserX, phaserY));
    }

    this.events.once('shutdown', () => {
      // Flag first: any microtasks queued by handle dismissals below
      // check this and bail before touching the dying scene.
      this.isShuttingDown = true;
      this.cancelNonCriticalPreloadSchedule?.();
      this.cancelNonCriticalPreloadSchedule = null;
      this.cancelAmbientCrossfadeSchedule?.();
      this.cancelAmbientCrossfadeSchedule = null;
      this.unregisterLifecycleHooks?.();
      this.unregisterLifecycleHooks = null;

      // Revoke any Object URL held for this level's color image so
      // CDN-fetched Blobs don't leak across scene restarts. Safe for
      // bundled levels (no-op when nothing is held). Must run before
      // the texture cache clears because the texture's underlying
      // image element still references the URL.
      if (this.level !== null && !this.preserveLevelUrlsOnShutdown) disposeLevelUrls(this.level.id);

      this.input.off('pointerdown', pointerDownHandler);
      this.input.off('pointerup', tapHandler);
      setHomeCallback(null);
      setGameModeChangeCallback(null);
      this.bwImage = null;
      this.colorImage = null;
      this.maskCanvas = null;
      this.maskCtx = null;
      this.permanentCanvas = null;
      this.permanentCtx = null;
      this.maskImage = null;
      this.compositeCanvas = null;
      this.compositeCtx = null;
      this.compositeImage = null;
      this.classicOverlayCanvas = null;
      this.classicOverlayCtx = null;
      this.classicBaseCanvas = null;
      this.classicBaseBaked = false;
      this.classicRenderPath = 'bitmap-mask';
      this.classicUsesCpuComposite = false;
      this.classicUsesPatchComposite = false;
      this.classicActivePatch = null;
      for (const textureKey of this.classicPatchTextureKeys) {
        if (this.textures.exists(textureKey)) this.textures.remove(textureKey);
      }
      this.classicPatchImages = [];
      this.classicPatchTextureKeys = [];
      this.classicPatchTextureCounter = 0;
      this.pendingRevealDirtyRect = null;
      // Explicit overlay teardown — markShown=false on tutorial so a
      // shutdown-during-tutorial doesn't permanently flip tutorialShown.
      // Rate-prompt handle resolves its Promise so any awaiter
      // (LevelCompleteOverlay's Next-Level click path) unblocks — but
      // the .then() at the awaiter must itself guard on isShuttingDown
      // to avoid running scene mutations on a dying scene.
      this.tutorialHandle?.dismiss(false);
      this.tutorialHandle = null;
      this.ratePromptHandle?.dismiss();
      this.ratePromptHandle = null;
      this.microAnimationLayer?.stop();
      this.microAnimationLayer = null;
      // killAll BEFORE clearing the dissolve arrays. A tween completing
      // at the exact frame of shutdown can synchronously invoke its
      // onComplete; those closures read dissolveActiveCells to decide
      // whether to fire onRevealedCellComplete. Emptying the arrays
      // first would make the last-cell check succeed on a zombie dog
      // and leak a registerLevelComplete mutation onto the dying scene
      // (todo 040 + pattern 2026-04-15-reentrant-tween-guard).
      this.tweens.killAll();
      this.bgLayers = [];
      this.edgeMirrorImages = [];
      this.dissolveActiveCells = [];
      this.dissolveCompletedCells = [];
      // Dismiss the level-complete overlay via its core handle so close() runs
      // (aborts the AbortSignal its callbacks observe, clears its scheduled
      // timeouts + message interval, resolves dismissed) — not just a raw node
      // removal, which would defeat those guards and leak the timers. The
      // raw-remove below stays as a belt-and-suspenders fallback.
      dismissLevelCompleteOverlay();
      document.getElementById('tutorial-overlay')?.remove();
      document.getElementById('rate-prompt-overlay')?.remove();
      document.getElementById('hud-overlay')?.classList.remove('completion-mode');
      document.getElementById('level-complete-overlay')?.remove();
      document.getElementById('level-failed-overlay')?.remove();
    });
  }

  private registerLifecycleSuspendHooks(): void {
    this.unregisterLifecycleHooks?.();
    this.unregisterLifecycleHooks = registerLifecycleHooks('game-scene', {
      onSuspend: (): void => {
        if (this.isShuttingDown || !this.sys.isActive()) return;

        this.cancelNonCriticalPreloadSchedule?.();
        this.cancelNonCriticalPreloadSchedule = null;
        this.cancelAmbientCrossfadeSchedule?.();
        this.cancelAmbientCrossfadeSchedule = null;

        this.wasClockPausedBeforeLifecycleSuspend = this.time.paused;
        this.wasTweenManagerPausedBeforeLifecycleSuspend = this.tweens.paused;
        this.time.paused = true;
        this.tweens.pauseAll();

        // Tutorial and decision overlays own player-facing choices. Leaving
        // them mounted is safer than converting a background event into an
        // implicit dismiss/claim/retry/next decision; the Phaser loop/tweens,
        // audio, and ambient motion are already stopped by the lifecycle
        // authority.

        this.wasMicroAnimationLayerActiveBeforeLifecycleSuspend = this.microAnimationLayer !== null;
        this.microAnimationLayer?.stop();
        this.microAnimationLayer = null;
      },
      onResume: (): void => {
        if (this.isShuttingDown || !this.sys.isActive()) return;
        if (!this.wasClockPausedBeforeLifecycleSuspend) this.time.paused = false;
        if (!this.wasTweenManagerPausedBeforeLifecycleSuspend) this.tweens.resumeAll();
        if (this.wasMicroAnimationLayerActiveBeforeLifecycleSuspend) this.startMicroAnimationsIfEnabled();
        this.wasClockPausedBeforeLifecycleSuspend = false;
        this.wasTweenManagerPausedBeforeLifecycleSuspend = false;
        this.wasMicroAnimationLayerActiveBeforeLifecycleSuspend = false;
      },
    });
  }

  private isTapRelease(pointer: Phaser.Input.Pointer): boolean {
    if (this.pointerDownAt === null) return false;
    const dx = pointer.x - this.pointerDownAt.x;
    const dy = pointer.y - this.pointerDownAt.y;
    this.pointerDownAt = null;
    return dx * dx + dy * dy <= GAMEPLAY.DRAG_TAP_THRESHOLD_PX * GAMEPLAY.DRAG_TAP_THRESHOLD_PX;
  }

  private async selectLevel(levelId: string): Promise<void> {
    showSceneTransitionCover();
    try {
      const index = await getLevelIndex();
      const nextIndex = index.findIndex((entry) => entry.id === levelId);
      if (nextIndex < 0) {
        hideSceneTransitionCoverAfterPaint();
        return;
      }

      gameState.currentLevelIndex = nextIndex;
      gameState.save();

      const levelData = withDirectSelectServingAttempt(await loadLevel(levelId), nextIndex, index.map((entry) => entry.id));
      if (this.isShuttingDown) return;
      this.scene.restart({ levelData } as GameSceneData);
    } catch (err) {
      hideSceneTransitionCoverAfterPaint();
      throw err;
    }
  }

  /**
   * Handle a tap. `worldX/Y` are camera-adjusted world coords (used for
   * hit-testing against the level's dog coordinates). `screenX/Y` are
   * unscrolled screen coords (used for visual-effect placement — paw
   * burst, wrong-tap X — which should render where the finger landed,
   * not where the world point is). The two coincide for portrait levels
   * (no camera scroll); they diverge for landscape after a section pan.
   *
   * The object-param signature forces callers to name both pairs rather
   * than risk a default-arg pitfall where `screenX = worldX` silently
   * produces wrong visuals when a later caller omits them after
   * introducing scroll.
   */
  handleTap(tap: { worldX: number; worldY: number; screenX: number; screenY: number }): void {
    if (!this.level || this.levelComplete) return;

    const { worldX, worldY, screenX, screenY } = tap;
    const levelX = (worldX - this.imgOffsetX) / this.imgScale;
    const levelY = (worldY - this.imgOffsetY) / this.imgScale;

    // Mid-pan paths:
    //   - pre-midpan: swallow taps entirely (camera still framing
    //     source section visually; pretend no input).
    //   - post-midpan: route to destination-section dogs only.
    //     Source-section dogs are already found, so a hit on them
    //     is impossible. Skip wrong-tap penalty entirely — player is
    //     mid-transition, no time to "be wrong" yet.
    const sc = this.sectionController;
    if (sc?.isPanning) {
      if (!sc.isAfterMidpan) return;
      if (sc.targetSectionIndex === null) return;
      const incomingDogs = sc.dogsInSection(sc.targetSectionIndex);
      const hit = this.findClosestUnfoundDogInSet(levelX, levelY, incomingDogs);
      if (hit) this.onDogFound(hit, screenX, screenY);
      return;
    }

    // First-time tutorial, "Tap the dog" phase (pulsing ring up): only the
    // spotlighted target (dogs[0]) is interactive. Taps on other dogs and
    // wrong-tap penalties are swallowed — the overlay is pointing at ONE
    // dog, so collecting others (or losing lives) mid-instruction breaks
    // the tutorial contract. The gate lifts when the ring tears down
    // (target found, hint used, or overlay dismissed).
    if (this.tutorialRing !== null && this.level.dogs.length > 0) {
      const tutorialHit = this.findClosestUnfoundDogInSet(levelX, levelY, [this.level.dogs[0]]);
      if (tutorialHit) this.onDogFound(tutorialHit, screenX, screenY);
      return;
    }

    // 1. Dismiss hint circle if active (tap counts as both dismiss + find)
    if (gameState.hintCircleActive) {
      this.dismissHintCircle();
    }

    // 2. Check if tap hits an unfound dog (within tolerance)
    const hitDog = this.findClosestUnfoundDog(levelX, levelY);
    if (hitDog) {
      this.onDogFound(hitDog, screenX, screenY);
      return;
    }

    // 3. Check if tap is inside any revealed Voronoi cell — no penalty
    if (this.isOnRevealedArea(levelX, levelY)) {
      return;
    }

    // 4. Taps on the mirrored decorative margin (outside the level image) are
    // no-ops — the player tapped scenery padding, not a missed guess, so no
    // wrong-tap penalty.
    if (
      levelX < 0 || levelY < 0 ||
      levelX > this.level.width || levelY > this.level.height
    ) {
      return;
    }

    // 5. Wrong tap — penalty with cooldown
    this.onWrongTap(screenX, screenY);
  }

  /**
   * Add flipped copies of the clean bg into the contain-scale letterbox margin
   * so the scene reads as continuing past its edge instead of ending on bars.
   * Contain leaves a gap on exactly one axis (the image is full-bleed on the
   * other), so only the matching pair of mirrors is created. Each mirror shares
   * the main image's scale and abuts its edge, so the seam is the literal
   * reflection of the boundary pixels.
   */
  private addEdgeMirrors(textureKey: string): void {
    if (!this.level) return;
    const w = this.level.width * this.imgScale;
    const h = this.level.height * this.imgScale;
    const x0 = this.imgOffsetX;
    const y0 = this.imgOffsetY;
    const EPSILON = 0.5;

    const addMirror = (x: number, y: number, flipX: boolean, flipY: boolean): void => {
      const mirror = this.add.image(x, y, textureKey);
      mirror.setOrigin(0, 0);
      mirror.setDisplaySize(w, h);
      mirror.setFlip(flipX, flipY);
      mirror.setDepth(-10);
      this.edgeMirrorImages.push(mirror);
    };

    if (x0 > EPSILON) {
      // Horizontal letterbox — mirror left and right.
      addMirror(x0 - w, y0, true, false);
      addMirror(x0 + w, y0, true, false);
    }
    if (y0 > EPSILON) {
      // Vertical letterbox — mirror top and bottom.
      addMirror(x0, y0 - h, false, true);
      addMirror(x0, y0 + h, false, true);
    }
  }

  private findClosestUnfoundDog(levelX: number, levelY: number): LevelDog | null {
    if (!this.level) return null;
    return this.findClosestUnfoundDogInSet(levelX, levelY, this.level.dogs);
  }

  private findClosestUnfoundDogInSet(
    levelX: number,
    levelY: number,
    candidates: LevelDog[],
  ): LevelDog | null {
    let closest: LevelDog | null = null;
    let closestDist = Infinity;

    for (const dog of candidates) {
      if (gameState.foundDogIds.has(dog.id)) continue;

      const dx = levelX - dog.x;
      const dy = levelY - dog.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const toleranceRadius = dog.r * GAMEPLAY.TOLERANCE_MULTIPLIER;

      if (dist <= toleranceRadius && dist < closestDist) {
        closest = dog;
        closestDist = dist;
      }
    }

    return closest;
  }

  /** Check if a point is inside any revealed Voronoi cell polygon (completed or animating). */
  private isOnRevealedArea(levelX: number, levelY: number): boolean {
    const pt = { x: levelX, y: levelY };
    // Check completed cells
    for (const cell of this.revealedCells) {
      if (pointInPolygon(pt, cell.polygon)) return true;
    }
    // Check actively animating cell
    if (this.activeRevealPolygon && pointInPolygon(pt, this.activeRevealPolygon)) return true;
    // Restoration mode: dissolve cells (completed or animating) count too —
    // tapping empty dissolved space shouldn't be penalized as a wrong tap.
    for (const cell of this.dissolveCompletedCells) {
      if (pointInPolygon(pt, cell.polygon)) return true;
    }
    for (const cell of this.dissolveActiveCells) {
      if (pointInPolygon(pt, cell.polygon)) return true;
    }
    return false;
  }

  /** Dog found — reveal Voronoi cell clipped to polygon bounds. */
  private onDogFound(dog: LevelDog, canvasX: number, canvasY: number): void {
    if (this.isRestoration) this.assertRestorationDogReady(dog);

    gameState.foundDogIds.add(dog.id);
    playFind();
    hapticFound();
    updateHUD(this.level!.dogs.length, this.isRestoration);
    // Tutorial points its pulsing ring at dogs[0] and says "Tap the dog".
    // Only advance when the player taps THAT dog — if their eye catches a
    // different one first, leave the ring intact so the contract holds.
    if (this.level && dog.id === this.level.dogs[0].id) {
      this.advanceTutorial();
    }

    const dogIndex = this.level!.dogs.findIndex((d) => d.id === dog.id);
    this.trackDogFoundAnalytics(dogIndex, Math.round((Date.now() - this.levelStartedAt) / 1000));

    // Restoration mode: remove the tapped dog instantly by carving its
    // local cell area out of the color layer. If the level ships a
    // separated sprite, fly that sprite into the HUD counter as the
    // collection affordance.
    if (this.isRestoration) {
      this.playRestorationPickupAnimation(dog);
      this.spawnRestorationDissolve(dog);
      this.emitPawBurst(canvasX, canvasY);
      return;
    }

    const revealContext = this.getClassicRevealContext(dog);

    let cellPolygon: Point[];
    if (gameState.settings.voronoiReveal) {
      cellPolygon = computeVoronoiCell({ x: dog.x, y: dog.y }, revealContext.otherSites, revealContext.bounds);
    } else {
      const r = Math.max(this.level!.width, this.level!.height) * 0.15;
      const circlePolygon: Point[] = [];
      for (let i = 0; i < 32; i++) {
        const angle = (i / 32) * Math.PI * 2;
        circlePolygon.push({
          x: dog.x + Math.cos(angle) * r,
          y: dog.y + Math.sin(angle) * r,
        });
      }
      cellPolygon = this.clipPolygonToRectBounds(circlePolygon, revealContext.bounds);
    }

    const maxRadius = maxDistToPolygon({ x: dog.x, y: dog.y }, cellPolygon) * this.imgScale;

    // If a previous reveal is still animating, complete it instantly
    if (this.activeRevealTween) {
      this.activeRevealTween.complete();
      this.activeRevealTween = null;
      this.flushPendingRevealRedraw();
    }

    // Store active reveal state for clipped animation
    this.activeRevealCenter = { x: dog.x, y: dog.y };
    this.activeRevealPolygon = cellPolygon;
    const screenPoints = cellPolygon.map((p) =>
      new Phaser.Geom.Point(this.imgOffsetX + p.x * this.imgScale, this.imgOffsetY + p.y * this.imgScale),
    );
    this.startClassicPatch(screenPoints);
    this.pendingRevealDirtyRect = null;
    this.resetRevealDiagnostics();

    const animTarget = { radius: 0 };
    this.activeRevealTween = this.tweens.add({
      targets: animTarget,
      radius: maxRadius,
      duration: TIMING.REVEAL_MS,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        this.activeRevealRadius = animTarget.radius;
        this.activeRevealDirty = true;
      },
      onComplete: () => {
        this.revealedCells.push({ polygon: cellPolygon, screenPoints });
        this.stampPermanentCell(screenPoints);
        this.pendingRevealDirtyRect = this.getPolygonDirtyRect(screenPoints, CLASSIC_REVEAL_EDGE_FEATHER_PX + 4);

        this.activeRevealCenter = null;
        this.activeRevealRadius = 0;
        this.activeRevealPolygon = null;
        this.activeRevealTween = null;
        this.activeRevealDirty = true;

        this.onRevealedCellComplete();
      },
    });

    this.emitPawBurst(canvasX, canvasY);
  }

  private getClassicRevealContext(dog: LevelDog): RevealContext {
    const level = this.level!;
    const section = this.sectionForClassicRevealDog(dog);
    const bounds = section
      ? this.boundsForSection(section)
      : this.fullLevelBounds();
    const otherSites = level.dogs
      .filter((d) => d.id !== dog.id)
      .filter((d) => (section ? this.isDogInSection(d, section) : true))
      .map((d) => ({ x: d.x, y: d.y }));

    return { bounds, otherSites };
  }

  private sectionForClassicRevealDog(dog: LevelDog): LevelSection | null {
    const sections = this.level?.sections;
    if (!sections || sections.length === 0) return null;
    return sections.find((section) => this.isDogInSection(dog, section))
      ?? sections[sections.length - 1];
  }

  private isDogInSection(dog: LevelDog, section: LevelSection): boolean {
    return dog.x >= section.xStart && dog.x < section.xEnd;
  }

  private fullLevelBounds(): Point[] {
    const level = this.level!;
    return [
      { x: 0, y: 0 },
      { x: level.width, y: 0 },
      { x: level.width, y: level.height },
      { x: 0, y: level.height },
    ];
  }

  private boundsForSection(section: LevelSection): Point[] {
    const level = this.level!;
    return [
      { x: section.xStart, y: 0 },
      { x: section.xEnd, y: 0 },
      { x: section.xEnd, y: level.height },
      { x: section.xStart, y: level.height },
    ];
  }

  private clipPolygonToRectBounds(polygon: Point[], bounds: Point[]): Point[] {
    const minX = bounds[0].x;
    const maxX = bounds[1].x;
    const minY = bounds[0].y;
    const maxY = bounds[2].y;
    return this.clipPolygonByAxis(
      this.clipPolygonByAxis(
        this.clipPolygonByAxis(
          this.clipPolygonByAxis(polygon, 'x', minX, 'min'),
          'x', maxX, 'max',
        ),
        'y', minY, 'min',
      ),
      'y', maxY, 'max',
    );
  }

  private clipPolygonByAxis(
    polygon: Point[],
    axis: 'x' | 'y',
    limit: number,
    side: 'min' | 'max',
  ): Point[] {
    if (polygon.length === 0) return [];
    const output: Point[] = [];
    const inside = (p: Point): boolean => side === 'min' ? p[axis] >= limit : p[axis] <= limit;

    for (let i = 0; i < polygon.length; i++) {
      const current = polygon[i];
      const next = polygon[(i + 1) % polygon.length];
      const currentInside = inside(current);
      const nextInside = inside(next);

      if (currentInside) output.push(current);
      if (currentInside !== nextInside) {
        const denom = next[axis] - current[axis];
        if (Math.abs(denom) < 1e-10) continue;
        const t = (limit - current[axis]) / denom;
        output.push({
          x: current.x + (next.x - current.x) * t,
          y: current.y + (next.y - current.y) * t,
        });
      }
    }

    return output;
  }

  /**
   * Decide what to do after a Voronoi reveal finishes:
   * - Landscape level: maybe pan to next section, or trigger finale zoom.
   * - Portrait level: maybe trigger the level-complete overlay.
   */
  private onRevealedCellComplete(): void {
    if (this.isShuttingDown || this.levelComplete || !this.level) return;

    const foundIds = gameState.foundDogIds;
    const allFound = foundIds.size === this.level.dogs.length;

    // Landscape / sectioned flow
    if (this.sectionController) {
      const sc = this.sectionController;
      // Re-entry guard: if a pan is already in flight, don't fire
      // another. This case happens when a mid-pan tap finds a dog
      // in the destination section — its reveal completes mid-pan
      // and would re-trigger transitionToNextSection against a
      // stale currentSectionIndex. The in-flight pan will reach
      // its target on its own.
      if (sc.isPanning) return;
      const currentIdx = sc.currentSectionIndex;
      if (sc.isSectionComplete(currentIdx, foundIds)) {
        if (!sc.isLastSection) {
          this.transitionToNextSection(currentIdx + 1).catch((err) => {
            // Section-pan failures are non-fatal: the camera may get stuck
            // mid-section, but the game remains interactive. Log so we can
            // correlate with device reports; swallow so the promise chain
            // doesn't blow up as an unhandled rejection.
            console.warn('panToSection failed', err);
          });
          return;
        }
        // Last section just completed → finale
        if (allFound) {
          this.triggerLevelFinale();
        }
        return;
      }
      // Section not complete yet — nothing to do; wait for more finds
      return;
    }

    // Portrait flow (existing behaviour)
    if (allFound) {
      this.triggerLevelFinale();
    }
  }

  /**
   * Pan the camera to the given section index. Extracted from an inline
   * floating IIFE so the promise has an explicit rejection path.
   */
  private async transitionToNextSection(nextIdx: number): Promise<void> {
    const sc = this.sectionController;
    if (!sc || !this.level?.sections) return;
    await sc.panToSection(nextIdx);
  }

  /**
   * Final celebration: for landscape levels, zoom out to show the whole map
   * before the overlay. For portrait levels, just the overlay. In both cases,
   * the same complete-analytics + confetti + overlay + restart sequence runs.
   */
  private triggerLevelFinale(): void {
    if (this.levelComplete) return;
    this.levelComplete = true;
    this.clearCompletionGuidance();
    this.startCompletionPanorama();
    const timeSeconds = Math.round((Date.now() - this.levelStartedAt) / 1000);
    void this.trackLevelComplete(timeSeconds);

    const servingAttempt = this.level!.servingAttempt;
    const completion = gameState.beginLevelCompletionTransaction({
      levelId: this.level!.id,
      levelIndex: gameState.currentLevelIndex,
      timeSeconds,
      baseCoinReward: remoteConfigService.value('levelCompleteCoinReward'),
      ...(servingAttempt !== undefined
        ? {
            intendedLevelId: servingAttempt.intendedLevelId,
            servedLevelId: servingAttempt.servedLevelId,
            sequenceVersion: servingAttempt.sequenceVersion,
            catalogRevision: servingAttempt.catalogRevision,
            fallbackReason: servingAttempt.fallbackReason,
          }
        : {}),
    });
    if (completion.baseCoinsGrantedNow) {
      void analytics.resourceChanged({
        flow_type: 'source',
        currency: 'coins',
        amount: completion.transaction.baseCoinReward,
        item_type: 'level',
        item_id: 'level_complete',
        level_id: this.level!.id,
        transaction_id: completion.transaction.id,
      });
    }
    const previousBest = completion.previousBest;
    const newBest = completion.newBest;
    const displayTimeSeconds = completion.transaction.timeSeconds;
    if (remoteConfigService.value('rewardProgressEnabled')) {
      const rewardProgress = gameState.applyRewardProgressToActiveCompletion(
        remoteConfigService.value('rewardProgressGoal'),
        remoteConfigService.value('rewardHintsAmount'),
      );
      if (rewardProgress.hintsGranted > 0) {
        void analytics.resourceChanged({
          flow_type: 'source',
          currency: 'hints',
          amount: rewardProgress.hintsGranted,
          item_type: 'level',
          item_id: 'reward_progress',
          level_id: this.level!.id,
          transaction_id: completion.transaction.id,
        });
      }
    }
    updateHUD(this.level!.dogs.length, this.isRestoration);

    this.time.delayedCall(TIMING.LEVEL_COMPLETE_DELAY_MS, () => {
      hapticLevelComplete();
      void adService.hideBanner();

      const claimX2Available =
        remoteConfigService.value('levelEndClaimX2Enabled') &&
        gameState.settings.adsEnabled &&
        !gameState.hasNoAdsEntitlement &&
        !completion.transaction.bonusCoinsGranted &&
        !completion.transaction.advanced;

      const overlayPromise = showLevelCompleteOverlay(this.level!.id, {
        timeSeconds: displayTimeSeconds,
        newBest,
        previousBest,
        baseCoins: completion.transaction.baseCoinReward,
        coinBalance: gameState.coinBalance,
        claimX2Available,
        onClaimX2: async () => {
          const adResult = await showRewardedAdForEconomy();
          if (!adResult.granted) {
            void analytics.settingsChanged({ setting_name: 'claimX2', new_value: 'ad-unavailable' });
            return { granted: false, coinBalance: gameState.coinBalance };
          }
          const claim = gameState.claimActiveCompletionBonusCoins(
            completion.transaction.id,
            completion.transaction.baseCoinReward,
          );
          if (claim.granted) {
            trackRewardedWatchedIfGranted(adResult, 'level_complete_claim_x2');
            void analytics.rewardedAdGranted({ placement: 'level_complete_claim_x2' });
            if (claim.coinsGranted > 0) {
              void analytics.resourceChanged({
                flow_type: 'source',
                currency: 'coins',
                amount: claim.coinsGranted,
                item_type: 'rewarded',
                item_id: 'claim_x2',
                level_id: this.level!.id,
                transaction_id: completion.transaction.id,
              });
            }
            updateHUD(this.level!.dogs.length, this.isRestoration);
            void analytics.settingsChanged({ setting_name: 'claimX2', new_value: 'granted' });
          }
          return { granted: claim.granted, coinBalance: gameState.coinBalance };
        },
        onRatePromptHandle: (handle) => {
          // Field-track the handle so scene shutdown can dismiss a live
          // rate-prompt and unblock its awaiter in LevelCompleteOverlay.
          this.ratePromptHandle = handle;
        },
      });

      void overlayPromise.then((overlayResult) => {
        // Guard: if shutdown fired while the overlay was awaiting the
        // rate prompt, shutdown-path dismissed the handle and unblocked
        // us. Running session-counter + scene.restart here would double-
        // advance currentLevelIndex and skew the interstitial cadence.
        // Ship-or-skip decision lives in shutdown; this .then is a no-op.
        if (this.isShuttingDown || !this.sys.isActive()) return;

        // Interstitial fires on Next Level (after the "Well Done" moment),
        // not on complete. Cadence (every-Nth-level, frequency cap, level
        // floor) comes from Remote Config so it's tunable without a
        // release. Gated on settings.adsEnabled so the toggle holds.
        gameState.levelsCompletedThisSession += 1;
        const everyNLevels = remoteConfigService.value('interstitialEveryNLevels');
        const minLevelNumber = remoteConfigService.value('interstitialMinLevel');
        const shouldTry =
          everyNLevels > 0 &&
          gameState.levelsCompletedThisSession % everyNLevels === 0 &&
          gameState.currentLevelIndex + 1 >= minLevelNumber;
        const restartToNextLevel = (): void => {
          if (this.isShuttingDown || !this.sys.isActive()) return;
          this.scene.restart(
            overlayResult.nextLevelData !== null
              ? ({ levelData: overlayResult.nextLevelData } as GameSceneData)
              : ({} as GameSceneData),
          );
        };
        if (shouldTry && gameState.settings.adsEnabled) {
          // The next level must not start under the ad: the restart is
          // sequenced after the show promise settles (= ad dismissed; the
          // provider resolves immediately when no ad is preloaded).
          void adService
            .maybeShowInterstitial({ minIntervalMs: remoteConfigService.value('interstitialMinIntervalS') * 1000 })
            .then((shown: boolean): void => {
              if (shown) {
                void analytics.adShown({ ad_type: 'interstitial', placement: 'between_levels' });
              } else if (adService.enabled) {
                void analytics.adShowFailed({ ad_type: 'interstitial', placement: 'between_levels', reason: 'not_shown' });
              }
            })
            .finally(restartToNextLevel);
        } else {
          restartToNextLevel();
        }
      });
    });

    // Landscape levels keep the image full-screen and slowly sweep the
    // completed panorama instead of zooming out into letterbox.
  }

  private scheduleAmbientCrossfade(levelName: string): void {
    const preset = presetForLevel(levelName);
    if (FAST_E2E_UI) {
      crossfadeAmbient(preset);
      return;
    }

    this.cancelAmbientCrossfadeSchedule?.();
    this.cancelAmbientCrossfadeSchedule = runWhenVisibleAndIdle((): void => {
      if (this.isShuttingDown || !this.sys.isActive()) return;
      crossfadeAmbient(preset);
    }, {
      delayMs: AMBIENT_START_DELAY_MS,
      idleTimeoutMs: AMBIENT_IDLE_TIMEOUT_MS,
      shouldRun: () => !this.isShuttingDown && this.sys.isActive(),
    });
  }

  private clearCompletionGuidance(): void {
    this.dismissHintCircle();
    this.tutorialRingTween?.destroy();
    this.tutorialRingTween = null;
    this.tutorialRing?.destroy();
    this.tutorialRing = null;
    this.tutorialAwaitingZoom = false;
    this.tutorialHintStep = false;
    this.tutorialHandle?.dismiss(true);
    this.tutorialHandle = null;
  }

  private startCompletionPanorama(): void {
    if (!this.level || !this.sectionController) return;

    const camera = this.cameras.main;
    const worldWidth = Math.max(GAME.WIDTH, Math.ceil(this.level.width * this.imgScale));
    const maxScrollX = Math.max(0, worldWidth - GAME.WIDTH);
    const startScrollX = Phaser.Math.Clamp(camera.scrollX, 0, maxScrollX);
    camera.setZoom(1);
    camera.setBounds(0, 0, worldWidth, GAME.HEIGHT);
    camera.setScroll(startScrollX, 0);

    if (startScrollX <= 1) return;

    this.tweens.add({
      targets: camera,
      scrollX: 0,
      duration: 16000,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });
  }

  /**
   * Show the first-time tutorial with a pulsing highlight ring around the
   * target dog. Ring persists until the player taps "Got it!", then fades
   * out. Without the ring, the bubble arrow points at a visually identical
   * patch of B&W — players can't tell where "the dog" actually is.
   *
   * CSS coords are derived via getBoundingClientRect, which is the only
   * robust conversion from Phaser internal (DPR-scaled) coords to viewport
   * CSS pixels under FIT + zoom=1/DPR scaling.
   */
  /**
   * Advance the tutorial from state 1 (dog bubble) to state 2 (hint
   * bubble) and tear down the pulsing ring that anchored the dog bubble.
   * Final dismissal happens via the hint-button capture listener inside
   * TutorialOverlay.
   */
  private advanceTutorial(): void {
    if (!this.tutorialHandle) return;
    // Now on the "try a hint" step — arm hint suppression so the tap that
    // advances to the zoom step neither fires a hint nor draws a hint circle.
    this.tutorialHintStep = true;
    this.tutorialHandle.advanceToHintState();
    this.tutorialRingTween?.destroy();
    this.tutorialRingTween = null;
    this.tutorialRing?.destroy();
    this.tutorialRing = null;
  }

  private showFirstTimeTutorial(dog: LevelDog, phaserX: number, phaserY: number): void {
    const canvas = this.scale.canvas;
    if (!canvas) return;

    const dogScreen = phaserPointToCssPoint(canvas, GAME.WIDTH, GAME.HEIGHT, phaserX, phaserY);

    const ringRadius = dog.r * this.imgScale * GAMEPLAY.TOLERANCE_MULTIPLIER;
    // Ring radius in CSS px (FIT scaling makes the canvas CSS size differ from
    // GAME.WIDTH) so the overlay's spotlight cutout matches the on-canvas ring.
    const dogRadiusCss = ringRadius * (canvas.getBoundingClientRect().width / GAME.WIDTH);
    const ring = this.add.graphics().setDepth(60);
    this.tutorialRing = ring;
    const drawRing = (scale: number, alpha: number): void => {
      ring.clear();
      ring.lineStyle(4, COLORS.HINT_CIRCLE, alpha);
      ring.strokeCircle(phaserX, phaserY, ringRadius * scale);
      ring.lineStyle(2, 0xffffff, alpha * 0.6);
      ring.strokeCircle(phaserX, phaserY, ringRadius * scale - 3);
    };
    drawRing(1, 0.95);
    const pulse = { scale: 1, alpha: 0.95 };
    this.tutorialRingTween = this.tweens.add({
      targets: pulse,
      scale: 1.15,
      alpha: 0.6,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => drawRing(pulse.scale, pulse.alpha),
    });

    // Field-track the handle so shutdown can call dismiss() cleanly.
    this.tutorialHandle = showTutorialOverlay({
      dogScreen,
      dogRadius: dogRadiusCss,
      onZoomStateEntered: () => {
        this.tutorialZoomBaseline = this.cameras.main.zoom;
        this.tutorialAwaitingZoom = true;
      },
    });
    void this.tutorialHandle.dismissed.then(() => {
      // Clear the zoom watch on any dismissal path (real pinch, "Got it"
      // skip, or scene teardown) so update() stops polling. Null the handle
      // too: advanceTutorial() infers a live tutorial from a non-null handle,
      // so a lingering dismissed handle would let a later dog-tap re-arm
      // tutorialHintStep and silently swallow the player's next real hint.
      this.tutorialAwaitingZoom = false;
      this.tutorialHintStep = false;
      this.tutorialHandle = null;
      this.tutorialRingTween?.destroy();
      this.tutorialRingTween = null;
      const r = this.tutorialRing;
      this.tutorialRing = null;
      // Shutdown guard: if the scene is tearing down, tween.killAll has
      // (or is about to) wipe the tween manager. Adding a fade tween now
      // would either silently no-op or queue into a dead manager. Skip
      // the graceful fade; shutdown will auto-destroy the ring Graphics
      // as a scene-owned child anyway.
      if (!r || this.isShuttingDown || !this.sys.isActive()) {
        r?.destroy();
        return;
      }
      this.tweens.add({
        targets: r,
        alpha: 0,
        duration: 220,
        onComplete: () => r.destroy(),
      });
    });
  }

  /** Whether the user has asked for reduced motion. Read live (not cached) so a
   *  mid-session OS toggle is honored; cheap enough to call per interaction. */
  private prefersReducedMotion(): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  /** Wrong tap — show red X, decrement lives. */
  private onWrongTap(canvasX: number, canvasY: number): void {
    const now = Date.now();
    if (now < gameState.penaltyCooldownUntil) return;

    // Read once per miss and thread the boolean through the effects, rather than
    // re-querying matchMedia in each helper (and so they can never disagree).
    const reducedMotion = this.prefersReducedMotion();

    gameState.lives--;
    gameState.penaltyCooldownUntil = now + TIMING.PENALTY_COOLDOWN_MS;
    this.wrongTapsCount += 1;
    playWrongTap();
    hapticWrong();
    this.shakeBoardOnMiss(reducedMotion);
    this.emitDustPoof(canvasX, canvasY, reducedMotion);
    updateHUD(this.level!.dogs.length, this.isRestoration);
    // Must follow updateHUD(): animateLifeLost() indexes into the heart pips
    // updateHUD just rebuilt. Reordering silently animates the wrong pip / none.
    animateLifeLost();

    if (gameState.lives <= 0) {
      void this.trackLevelFailed(gameState.foundDogIds.size);
    }

    // Draw the X centered at local (0,0) and position the object at the tap
    // point, so the scale-in tween pops around the X center rather than flying
    // in from the world origin. Convert the viewport tap to the coordinate a
    // scroll-factor-zero object needs before camera zoom is applied.
    const markPoint = this.viewportToScrollFactorZeroPoint(canvasX, canvasY);
    this.lastViewportEffect = {
      kind: 'wrong-tap',
      requested: { x: canvasX, y: canvasY },
      emitted: markPoint,
    };
    const gfx = this.add.graphics();
    gfx.lineStyle(3, COLORS.WRONG_TAP, 1);
    const size = 12;
    gfx.beginPath();
    gfx.moveTo(-size, -size);
    gfx.lineTo(size, size);
    gfx.moveTo(size, -size);
    gfx.lineTo(-size, size);
    gfx.strokePath();
    gfx.setPosition(markPoint.x, markPoint.y);
    gfx.setScrollFactor(0);

    // Bouncy overshoot entrance — a playful "pop" instead of a flat appear.
    if (!reducedMotion) {
      gfx.setScale(0);
      this.tweens.add({
        targets: gfx,
        scale: 1,
        duration: 220,
        ease: 'Back.easeOut',
      });
    }

    this.tweens.add({
      targets: gfx,
      alpha: 0,
      duration: TIMING.WRONG_TAP_FADE_MS,
      onComplete: () => gfx.destroy(),
    });

    if (gameState.lives <= 0) {
      this.levelComplete = true;
      // Tear down any live first-time tutorial before the fail overlay mounts.
      // The tutorial overlay is z-index 50 vs the fail overlay's 10 (both are
      // siblings in #hud-overlay), so a tutorial still on its open-ended zoom
      // step would otherwise sit on top of the fail/continue UI and keep the
      // update() pinch-poll running behind it.
      this.clearCompletionGuidance();
      showLevelFailedOverlay(this.level!.id, {
        getOffers: () => this.buildFailContinueOfferSet(),
        getCoinBalance: () => gameState.coinBalance,
        getIapProducts: () => iapService.snapshot().products,
        shouldRefreshOffers: () => {
          const iapSnapshot = iapService.snapshot();
          const egoOfferProductId = remoteConfigService.value('egoOfferProductId');
          const egoOfferStoreProduct = iapSnapshot.products.find((product) => product.productId === egoOfferProductId)?.storeProduct ?? null;
          return iapSnapshot.state === 'idle'
            || iapSnapshot.state === 'initializing'
            || iapSnapshot.nativeOperationInProgress
            || (iapSnapshot.state === 'ready' && egoOfferStoreProduct === null);
        },
        onRetry: () => {
          const retryLevel = this.level;
          showSceneTransitionCover();
          gameState.reset();
          if (retryLevel !== null) {
            this.preserveLevelUrlsOnShutdown = true;
            this.scene.restart({ levelData: retryLevel } as GameSceneData);
          } else {
            this.scene.restart({} as GameSceneData);
          }
        },
        onCoinContinue: async (option) => this.continueWithCoins(option),
        onEgoOffer: async (option, context) => this.continueWithEgoOffer(option, context),
      });
    }
  }

  private buildFailContinueOfferSet(): FailContinueOfferSet {
    const iapSnapshot = iapService.snapshot();
    const egoOfferProductId = remoteConfigService.value('egoOfferProductId');
    const egoOfferStoreProduct = iapSnapshot.products.find((product) => product.productId === egoOfferProductId)?.storeProduct ?? null;

    return buildFailContinueOffers({
      coins: gameState.coinBalance,
      egoOfferPurchaseAvailable: iapSnapshot.state === 'ready' && egoOfferStoreProduct !== null && !iapSnapshot.nativeOperationInProgress,
    });
  }

  private async continueWithCoins(option: FailContinueOption): Promise<{ resumed: boolean; message?: string }> {
    if (!this.level || option.status !== 'available') return { resumed: false };
    if (!gameState.spendCoins(option.coinPrice, 'shop')) {
      return { resumed: false, message: 'Not enough coins.' };
    }
    const resumed = this.resumeFailedAttempt();
    if (resumed) {
      void analytics.resourceChanged({
        flow_type: 'sink',
        currency: 'coins',
        amount: option.coinPrice,
        item_type: 'continue',
        item_id: 'fail_continue',
        level_id: this.level.id,
      });
    }
    return resumed ? { resumed: true } : { resumed: false };
  }

  private async continueWithEgoOffer(option: FailContinueOption, context: FailContinueActionContext): Promise<{ resumed: boolean; message?: string }> {
    if (option.productId === null) return { resumed: false, message: 'Purchase unavailable.' };
    void analytics.purchaseInitiated({ product_id: option.productId, surface: 'fail_continue' });
    const purchase = await iapService.purchase(option.productId);
    if (purchase.status !== 'purchased') {
      if (purchase.status === 'cancelled') {
        void analytics.purchaseCancelled({ product_id: option.productId, surface: 'fail_continue' });
      } else {
        void analytics.purchaseFailed({
          product_id: option.productId,
          surface: 'fail_continue',
          reason: purchase.status,
          failure_kind: purchase.failureKind,
          error_message: purchase.errorMessage,
        });
      }
      return { resumed: false, message: purchase.status === 'cancelled' ? 'Purchase cancelled.' : 'Purchase unavailable.' };
    }
    const fulfillment = fulfillVerifiedPurchaseOnce(purchase, buildShopCatalog().products, gameState);
    const resolved = await reportUnfulfilledPurchase(
      fulfillment,
      analytics,
      makePurchaseRestoreRetry(purchase, {
        restore: () => iapService.restore(),
        products: () => buildShopCatalog().products,
        wallet: gameState,
      }),
    );
    if (resolved.status !== 'fulfilled' || resolved.grant?.continueLevel !== true) {
      return { resumed: false, message: 'Purchase could not continue this level.' };
    }
    void analytics.purchaseFulfilled({
      product_id: resolved.productId,
      purchase_id: resolved.purchaseId,
      no_ads: resolved.grant.noAds,
      hints: resolved.grant.hints,
      coins: resolved.grant.coins,
      continue_level: resolved.grant.continueLevel,
    });
    if (!context.shouldResume()) {
      if (this.level) updateHUD(this.level.dogs.length, this.isRestoration);
      return { resumed: false, message: 'Purchase completed. Hints and coins were added; choose another continue option or retry.' };
    }
    return this.resumeFailedAttempt()
      ? { resumed: true }
      : { resumed: false };
  }

  private resumeFailedAttempt(): boolean {
    if (!this.level) return false;
    document.getElementById('level-failed-overlay')?.remove();
    gameState.lives = GAMEPLAY.LIVES_PER_LEVEL;
    gameState.penaltyCooldownUntil = 0;
    this.levelComplete = false;
    this.pointerDownAt = null;
    updateHUD(this.level.dogs.length, this.isRestoration);
    return true;
  }

  /** Trace a closed polygon path on the given 2D context. Shared by the stamp/carve paths. */
  private tracePolygonPath(ctx: CanvasRenderingContext2D, pts: Phaser.Geom.Point[]): void {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.closePath();
  }

  /** Stamp a completed cell polygon into the persistent canvas (Classic: paint white). */
  private stampPermanentCell(screenPoints: Phaser.Geom.Point[]): void {
    const ctx = this.permanentCtx;
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'white';
    ctx.shadowBlur = CLASSIC_REVEAL_EDGE_FEATHER_PX;
    this.tracePolygonPath(ctx, screenPoints);
    ctx.fill();
    ctx.shadowBlur = 0;
    this.tracePolygonPath(ctx, screenPoints);
    ctx.fill();
    ctx.restore();
  }

  /** Carve a completed dissolve cell out of the persistent canvas (Restoration: opaque → transparent). */
  private carvePermanentDissolveCell(screenPoints: Phaser.Geom.Point[]): void {
    const ctx = this.permanentCtx;
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    this.tracePolygonPath(ctx, screenPoints);
    ctx.fill();
    ctx.restore();
  }

  /** Copy the persistent restoration mask to the live mask texture after instant carves. */
  private syncRestorationMaskTexture(): void {
    const ctx = this.maskCtx;
    if (!ctx || !this.maskCanvas || !this.permanentCanvas) return;
    ctx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    ctx.drawImage(this.permanentCanvas, 0, 0);
    this.refreshRevealMask();
  }

  private startClassicPatch(screenPoints: Phaser.Geom.Point[]): void {
    if (!this.classicUsesPatchComposite) return;

    const rect = this.getPolygonDirtyRect(screenPoints, CLASSIC_REVEAL_EDGE_FEATHER_PX + 4);
    if (!rect) return;

    const textureKey = `classic_patch_${this.level?.id ?? 'level'}_${this.classicPatchTextureCounter}`;
    this.classicPatchTextureCounter += 1;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(rect.w));
    canvas.height = Math.max(1, Math.ceil(rect.h));
    if (this.textures.exists(textureKey)) this.textures.remove(textureKey);
    this.textures.addCanvas(textureKey, canvas);
    const texture = this.textures.get(textureKey) as Phaser.Textures.CanvasTexture;
    const image = this.add.image(rect.x, rect.y, textureKey);
    image.setOrigin(0, 0);

    this.classicActivePatch = {
      textureKey,
      canvas,
      ctx: texture.context,
      image,
      rect,
    };
    this.classicPatchImages.push(image);
    this.classicPatchTextureKeys.push(textureKey);
  }

  private getRendererKind(): 'webgl' | 'canvas' | 'unknown' {
    const rendererType = (this.game.renderer as { type?: number }).type;
    if (rendererType === Phaser.WEBGL) return 'webgl';
    if (rendererType === Phaser.CANVAS) return 'canvas';
    return 'unknown';
  }

  private spriteTextureKeyForDog(dog: LevelDog): string {
    return `dog_sprite_${this.level?.id ?? 'level'}_${dog.id}`;
  }

  private restorationSpriteForDog(dog: LevelDog): NonNullable<LevelDog['sprite']> {
    const sprite = dog.sprite;
    if (sprite === undefined) {
      throw new Error(`Restoration dog ${dog.id} is missing sprite metadata`);
    }
    return sprite;
  }

  private hasLoadedRestorationSpriteTextures(): boolean {
    if (!this.level) return false;
    return this.level.dogs.every((dog) => (
      dog.sprite !== undefined && this.textures.exists(this.spriteTextureKeyForDog(dog))
    ));
  }

  private assertRestorationLevelReady(level: LevelData): void {
    if (!Array.isArray(level.bgImageUrls) || level.bgImageUrls.length === 0) {
      throw new Error(`Restoration level ${level.id} is missing clean background assets`);
    }

    const sections = level.sections;
    if (
      Array.isArray(sections)
      && sections.length > 0
      && level.bgImageUrls.length !== 1
      && level.bgImageUrls.length !== sections.length
    ) {
      throw new Error(`Restoration level ${level.id} has ${level.bgImageUrls.length} bg images for ${sections.length} sections`);
    }

    if (level.dogs.length === 0) {
      throw new Error(`Restoration level ${level.id} has no dog sprites to clean up`);
    }

    for (const dog of level.dogs) this.assertRestorationDogGeometryReady(dog, true);
  }

  private assertRestorationDogReady(dog: LevelDog): void {
    this.restorationSpriteForDog(dog);
    const textureKey = this.spriteTextureKeyForDog(dog);
    if (!this.textures.exists(textureKey)) {
      throw new Error(`Restoration dog ${dog.id} sprite texture was not loaded`);
    }
    this.assertRestorationDogGeometryReady(dog, false);
  }

  private assertRestorationDogGeometryReady(dog: LevelDog, protectFoundDogs: boolean): void {
    this.restorationSpriteForDog(dog);
    const baseBounds = this.restorationSpriteCleanupBounds(dog, false);
    if (baseBounds === null || !this.levelRectContainsPoint(baseBounds, dog.x, dog.y)) {
      throw new Error(`Restoration dog ${dog.id} hitbox is outside sprite cleanup bounds`);
    }
    const cleanupRects = this.restorationDissolveRects(dog, protectFoundDogs);
    if (!cleanupRects.some((rect) => this.levelRectContainsPoint(rect, dog.x, dog.y))) {
      throw new Error(`Restoration dog ${dog.id} cleanup area is blocked by another dog sprite`);
    }
  }

  private levelToViewportPoint(x: number, y: number): Point {
    const camera = this.cameras.main;
    return {
      x: this.imgOffsetX + x * this.imgScale - camera.scrollX,
      y: this.imgOffsetY + y * this.imgScale - camera.scrollY,
    };
  }

  private viewportToScrollFactorZeroPoint(x: number, y: number): Point {
    const camera = this.cameras.main;
    const originX = camera.width * camera.originX;
    const originY = camera.height * camera.originY;
    return {
      x: originX + (x - originX) / camera.zoom,
      y: originY + (y - originY) / camera.zoom,
    };
  }

  private counterTargetPoint(): Point {
    const fallback = {
      x: GAMEPLAY.RESTORATION_PICKUP_LANDING_SIZE_PX,
      y: GAMEPLAY.RESTORATION_PICKUP_LANDING_SIZE_PX,
    };
    const canvas = this.scale.canvas;
    const counter = document.getElementById('dog-counter');
    if (!canvas || !counter) return fallback;

    const canvasRect = canvas.getBoundingClientRect();
    const counterRect = counter.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return fallback;

    return {
      x: ((counterRect.left + counterRect.width * 0.34 - canvasRect.left) / canvasRect.width) * GAME.WIDTH,
      y: ((counterRect.top + counterRect.height * 0.5 - canvasRect.top) / canvasRect.height) * GAME.HEIGHT,
    };
  }

  private startMicroAnimationsIfEnabled(): void {
    if (remoteConfigService.value('microAnimationsEnabled')) {
      this.startMicroAnimations();
      return;
    }

    void remoteConfigService.initAndWaitForTest().then(() => {
      if (this.isShuttingDown || !this.sys.isActive()) return;
      if (remoteConfigService.value('microAnimationsEnabled')) this.startMicroAnimations();
    });
  }

  private startMicroAnimations(): void {
    if (this.microAnimationLayer === null) {
      this.microAnimationLayer = new MicroAnimationLayer(this);
    }
    this.microAnimationLayer.start();
  }

  enableMicroAnimationsForTest(): void {
    this.startMicroAnimations();
  }

  getMicroAnimationSnapshot(): MicroAnimationSnapshot {
    return this.microAnimationLayer?.snapshot() ?? { activeObjects: 0, activeTweens: 0 };
  }

  private pulseDogCounter(): void {
    const counter = document.getElementById('dog-counter');
    if (!counter) return;
    counter.classList.remove('pickup-pulse');
    void counter.offsetWidth;
    counter.classList.add('pickup-pulse');
  }

  private playRestorationPickupAnimation(dog: LevelDog): void {
    const sprite = this.restorationSpriteForDog(dog);
    const textureKey = this.spriteTextureKeyForDog(dog);

    const start = this.levelToViewportPoint(dog.x, dog.y);
    const target = this.counterTargetPoint();
    const image = this.add.image(start.x, start.y, textureKey)
      .setOrigin(sprite.anchorX ?? 0.5, sprite.anchorY ?? 0.5)
      .setScrollFactor(0)
      .setDepth(85);

    image.setDisplaySize(sprite.width * this.imgScale, sprite.height * this.imgScale);
    const startScaleX = image.scaleX;
    const startScaleY = image.scaleY;
    const startDisplaySize = Math.max(image.displayWidth, image.displayHeight, 1);
    const landFactor = Phaser.Math.Clamp(
      GAMEPLAY.RESTORATION_PICKUP_LANDING_SIZE_PX / startDisplaySize,
      0.22,
      0.72,
    );
    const targetScaleX = startScaleX * landFactor;
    const targetScaleY = startScaleY * landFactor;
    const arcHeight = Math.max(
      GAMEPLAY.RESTORATION_PICKUP_MIN_ARC_PX,
      Math.abs(start.x - target.x) * 0.22,
    );
    const control = {
      x: (start.x + target.x) / 2,
      y: Math.min(start.y, target.y) - arcHeight,
    };
    const progress = { t: 0 };
    const reducedMotion = this.prefersReducedMotion();

    this.pickupAnimationsActive += 1;
    this.tweens.add({
      targets: progress,
      t: 1,
      duration: reducedMotion ? 260 : TIMING.RESTORATION_PICKUP_FLY_MS,
      ease: 'Cubic.easeInOut',
      onUpdate: () => {
        const t = progress.t;
        const inv = 1 - t;
        image.setPosition(
          inv * inv * start.x + 2 * inv * t * control.x + t * t * target.x,
          inv * inv * start.y + 2 * inv * t * control.y + t * t * target.y,
        );
        image.setScale(
          Phaser.Math.Linear(startScaleX, targetScaleX, t),
          Phaser.Math.Linear(startScaleY, targetScaleY, t),
        );
        image.setAlpha(Phaser.Math.Linear(1, 0.86, t));
        image.setAngle(Phaser.Math.Linear(0, -8, t));
      },
      onComplete: () => {
        this.pickupAnimationsActive = Math.max(0, this.pickupAnimationsActive - 1);
        this.pickupAnimationsCompleted += 1;
        image.destroy();
        this.pulseDogCounter();
      },
    });
  }

  /**
   * Build the dog cleanup area from an expanded exported sprite cleanup
   * footprint. Currently-unfound neighboring footprints are subtracted at
   * their exact sprite-cleanup size so a pickup cannot erase another dog.
   */
  private restorationDissolvePolygons(dog: LevelDog): Point[][] {
    return this.restorationDissolveRects(dog, false).map((rect) => this.polygonForLevelRect(rect));
  }

  private restorationDissolveRects(dog: LevelDog, protectFoundDogs: boolean): LevelRect[] {
    const baseBounds = this.restorationSpriteCleanupBounds(dog, true);
    if (baseBounds === null) return [];

    let cleanupRects = [baseBounds];
    for (const candidate of this.level!.dogs) {
      if (candidate.id === dog.id) continue;
      if (!protectFoundDogs && gameState.foundDogIds.has(candidate.id)) continue;
      const protectedBounds = this.restorationSpriteCleanupBounds(candidate, false);
      if (protectedBounds === null) continue;
      cleanupRects = cleanupRects.flatMap((rect) => this.subtractLevelRect(rect, protectedBounds));
      if (cleanupRects.length === 0) break;
    }
    return cleanupRects;
  }

  private restorationSpriteCleanupBounds(dog: LevelDog, expand: boolean): LevelRect | null {
    const sprite = dog.sprite;
    if (sprite === undefined) return null;
    const cleanup = sprite.cleanup;
    if (cleanup === undefined) {
      throw new Error(`Restoration dog ${dog.id} is missing sprite cleanup metadata`);
    }
    const rawBounds = {
      left: cleanup.x,
      top: cleanup.y,
      right: cleanup.x + cleanup.width,
      bottom: cleanup.y + cleanup.height,
    };
    return this.clipLevelRect(expand ? this.scaleLevelRect(rawBounds, RESTORATION_CLEANUP_FOOTPRINT_SCALE) : rawBounds);
  }

  private scaleLevelRect(rect: LevelRect, scale: number): LevelRect {
    const centerX = (rect.left + rect.right) / 2;
    const centerY = (rect.top + rect.bottom) / 2;
    const halfWidth = ((rect.right - rect.left) * scale) / 2;
    const halfHeight = ((rect.bottom - rect.top) * scale) / 2;
    return {
      left: centerX - halfWidth,
      top: centerY - halfHeight,
      right: centerX + halfWidth,
      bottom: centerY + halfHeight,
    };
  }

  private clipLevelRect(rect: LevelRect): LevelRect | null {
    if (!this.level) return null;
    const clipped = {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(this.level.width, rect.right),
      bottom: Math.min(this.level.height, rect.bottom),
    };
    return clipped.right > clipped.left && clipped.bottom > clipped.top ? clipped : null;
  }

  private levelRectContainsPoint(rect: LevelRect, x: number, y: number): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  private subtractLevelRect(source: LevelRect, blocker: LevelRect): LevelRect[] {
    const overlap = {
      left: Math.max(source.left, blocker.left),
      top: Math.max(source.top, blocker.top),
      right: Math.min(source.right, blocker.right),
      bottom: Math.min(source.bottom, blocker.bottom),
    };
    if (overlap.right <= overlap.left || overlap.bottom <= overlap.top) return [source];

    const rects: LevelRect[] = [
      { left: source.left, top: source.top, right: source.right, bottom: overlap.top },
      { left: source.left, top: overlap.bottom, right: source.right, bottom: source.bottom },
      { left: source.left, top: overlap.top, right: overlap.left, bottom: overlap.bottom },
      { left: overlap.right, top: overlap.top, right: source.right, bottom: overlap.bottom },
    ];
    return rects.filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
  }

  private levelRectForPolygon(polygon: Point[]): LevelRect | null {
    if (polygon.length === 0 || !this.level) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of polygon) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    return {
      left: Math.max(0, Math.floor(minX)),
      top: Math.max(0, Math.floor(minY)),
      right: Math.min(this.level.width, Math.ceil(maxX)),
      bottom: Math.min(this.level.height, Math.ceil(maxY)),
    };
  }

  private polygonForLevelRect(rect: LevelRect): Point[] {
    return [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom },
    ];
  }

  private levelPolygonToScreenPoints(polygon: Point[]): Phaser.Geom.Point[] {
    return polygon.map(
      (p) => new Phaser.Geom.Point(
        this.imgOffsetX + p.x * this.imgScale,
        this.imgOffsetY + p.y * this.imgScale,
      ),
    );
  }

  private spawnRestorationDissolve(dog: LevelDog): void {
    const erasePolygons = this.restorationDissolvePolygons(dog);
    const bounds = this.levelRectForPolygon(erasePolygons.flat());
    if (bounds === null || erasePolygons.length === 0) {
      throw new Error(`Restoration dog ${dog.id} has no valid sprite cleanup area`);
    }
    this.lastRestorationDissolveBounds = bounds;
    for (const polygon of erasePolygons) {
      const screenPoints = this.levelPolygonToScreenPoints(polygon);
      this.dissolveCompletedCells.push({ polygon });
      this.carvePermanentDissolveCell(screenPoints);
    }
    this.syncRestorationMaskTexture();
    this.onRevealedCellComplete();
  }

  /**
   * Composite the mask: permanent canvas (all completed cells) + active clipped circle.
   * Only the active circle changes per frame — completed cells are pre-baked in permanentCanvas.
   *
   * Restoration mode: permanentCanvas starts opaque white with holes
   * carved out for each completed dissolve cell. Active cells carve with
   * a partial-alpha destination-out sized by (1 - cell.alpha), producing
   * the fade-out appearance. Classic mode: permanentCanvas starts
   * transparent and is painted white by completed reveals; the active
   * cell draws an expanding white circle clipped to its polygon.
   */
  private redrawComposite(dirtyRect: DirtyRect | null): void {
    const frameStartedAt = performance.now();
    const ctx = this.maskCtx;
    if (!ctx || !this.maskCanvas || !this.permanentCanvas) return;

    if (this.isRestoration) {
      // Clip the per-frame clear + permanentCanvas blit + destination-out
      // carve to the union bbox of active cells (todo 043). The mask
      // canvas can be up to ~2 MP for landscape (1920×1080); only the
      // small dog-bbox region mutates during a dissolve. Without clipping,
      // every frame re-uploads ~8 MB of texture data to the GPU for a
      // change that fits in a ~120 px square. padding covers antialiased
      // polygon edges.
      if (this.dissolveActiveCells.length === 0) {
        // No active cells → the mask already reflects all completed
        // carves (permanent canvas), nothing to redraw this frame.
        return;
      }
      const PAD = 4;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const cell of this.dissolveActiveCells) {
        for (const p of cell.screenPoints) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
      const rx = Math.max(0, Math.floor(minX - PAD));
      const ry = Math.max(0, Math.floor(minY - PAD));
      const rw = Math.min(this.maskCanvas.width - rx, Math.ceil(maxX - minX + PAD * 2));
      const rh = Math.min(this.maskCanvas.height - ry, Math.ceil(maxY - minY + PAD * 2));
      ctx.save();
      // Use a rect clip so the destination-out polygon fills are bounded
      // to the bbox — polygons that extend slightly past PAD don't erase
      // completed cells elsewhere on the mask.
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.clearRect(rx, ry, rw, rh);
      ctx.drawImage(
        this.permanentCanvas,
        rx, ry, rw, rh,  // src rect
        rx, ry, rw, rh,  // dst rect
      );
      ctx.globalCompositeOperation = 'destination-out';
      for (const cell of this.dissolveActiveCells) {
        const pts = cell.screenPoints;
        if (pts.length < 3) continue;
        ctx.globalAlpha = 1 - cell.alpha;
        ctx.fillStyle = 'rgba(0,0,0,1)';
        this.tracePolygonPath(ctx, pts);
        ctx.fill();
      }
      ctx.restore();
      const redrawMs = performance.now() - frameStartedAt;
      const timings = this.refreshRevealMask(null);
      this.recordRevealFrame(frameStartedAt, redrawMs, timings.maskRefreshMs, timings.cpuCompositeMs, rw * rh);
      return;
    }

    const rect = dirtyRect ?? { x: 0, y: 0, w: this.maskCanvas.width, h: this.maskCanvas.height };
    const { x: rx, y: ry, w: rw, h: rh } = rect;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.clip();
    ctx.clearRect(rx, ry, rw, rh);
    ctx.drawImage(
      this.permanentCanvas,
      rx, ry, rw, rh,
      rx, ry, rw, rh,
    );
    this.drawActiveClassicReveal(ctx);
    ctx.restore();

    const redrawMs = performance.now() - frameStartedAt;
    const timings = this.refreshRevealMask(rect);
    this.recordRevealFrame(frameStartedAt, redrawMs, timings.maskRefreshMs, timings.cpuCompositeMs, rw * rh);
  }

  private drawActiveClassicReveal(ctx: CanvasRenderingContext2D): void {
    if (!this.activeRevealCenter || this.activeRevealRadius <= 0 || !this.activeRevealPolygon) return;

    const cx = this.imgOffsetX + this.activeRevealCenter.x * this.imgScale;
    const cy = this.imgOffsetY + this.activeRevealCenter.y * this.imgScale;

    ctx.save();
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'white';
    ctx.shadowBlur = CLASSIC_REVEAL_EDGE_FEATHER_PX;

    // Clip to the Voronoi polygon
    ctx.beginPath();
    for (let i = 0; i < this.activeRevealPolygon.length; i++) {
      const p = this.activeRevealPolygon[i];
      const sx = this.imgOffsetX + p.x * this.imgScale;
      const sy = this.imgOffsetY + p.y * this.imgScale;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.clip();

    ctx.beginPath();
    ctx.arc(cx, cy, this.activeRevealRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(cx, cy, this.activeRevealRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private flushPendingRevealRedraw(): void {
    if (!this.activeRevealDirty) return;
    this.activeRevealDirty = false;
    const dirtyRect = this.pendingRevealDirtyRect ?? this.getActiveRevealDirtyRect();
    this.pendingRevealDirtyRect = null;
    this.redrawComposite(dirtyRect);
  }

  /** Push the reveal mask to the GPU; CPU fallback also rebuilds the visible composite. */
  private refreshRevealMask(dirtyRect: DirtyRect | null = this.getActiveRevealDirtyRect()): { maskRefreshMs: number; cpuCompositeMs: number } {
    let maskRefreshMs = 0;
    let cpuCompositeMs = 0;
    if (this.classicUsesPatchComposite) {
      const startedAt = performance.now();
      this.syncClassicPatch();
      cpuCompositeMs = performance.now() - startedAt;
    } else if (this.isRestoration || !this.classicUsesCpuComposite) {
      const startedAt = performance.now();
      this.refreshCanvasTexture('reveal_mask');
      maskRefreshMs = performance.now() - startedAt;
    }
    if (!this.isRestoration && this.classicUsesCpuComposite) {
      const startedAt = performance.now();
      this.syncClassicComposite(dirtyRect);
      cpuCompositeMs = performance.now() - startedAt;
    }
    return { maskRefreshMs, cpuCompositeMs };
  }

  private syncClassicPatch(): void {
    const patch = this.classicActivePatch;
    const level = this.level;
    if (!patch || !level || !this.textures.exists('color')) return;

    const colorSource = this.getCanvasSourceImage('color');
    if (!colorSource) return;

    const { ctx, canvas, rect } = patch;
    const ox = this.imgOffsetX;
    const oy = this.imgOffsetY;
    const dw = level.width * this.imgScale;
    const dh = level.height * this.imgScale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-rect.x, -rect.y);
    if (this.activeRevealCenter && this.activeRevealRadius > 0 && this.activeRevealPolygon) {
      this.drawActiveClassicReveal(ctx);
    } else {
      ctx.drawImage(this.maskCanvas!, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(colorSource, ox, oy, dw, dh);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    this.refreshCanvasTexture(patch.textureKey);

    if (!this.activeRevealCenter) {
      this.classicActivePatch = null;
    }
  }

  private getActiveRevealDirtyRect(): DirtyRect | null {
    if (!this.activeRevealCenter || this.activeRevealRadius <= 0) return null;
    const cx = this.imgOffsetX + this.activeRevealCenter.x * this.imgScale;
    const cy = this.imgOffsetY + this.activeRevealCenter.y * this.imgScale;
    const pad = CLASSIC_REVEAL_EDGE_FEATHER_PX + 4;
    const radius = this.activeRevealRadius + pad;
    return this.clipDirtyRect({
      x: Math.floor(cx - radius),
      y: Math.floor(cy - radius),
      w: Math.ceil(radius * 2),
      h: Math.ceil(radius * 2),
    });
  }

  private getPolygonDirtyRect(points: Phaser.Geom.Point[], pad: number): DirtyRect | null {
    if (points.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
    return this.clipDirtyRect({
      x: Math.floor(minX - pad),
      y: Math.floor(minY - pad),
      w: Math.ceil(maxX - minX + pad * 2),
      h: Math.ceil(maxY - minY + pad * 2),
    });
  }

  private clipDirtyRect(rect: DirtyRect): DirtyRect | null {
    const maskCanvas = this.maskCanvas;
    if (!maskCanvas) return null;
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const maxX = Math.min(maskCanvas.width, rect.x + rect.w);
    const maxY = Math.min(maskCanvas.height, rect.y + rect.h);
    const w = maxX - x;
    const h = maxY - y;
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }

  private resetRevealDiagnostics(): void {
    this.lastRevealDiagnostics = {
      frames: 0,
      totalMaskRedrawMs: 0,
      totalMaskRefreshMs: 0,
      totalCpuCompositeMs: 0,
      maxFrameMs: 0,
      lastDirtyArea: 0,
    };
  }

  private recordRevealFrame(
    frameStartedAt: number,
    maskRedrawMs: number,
    maskRefreshMs: number,
    cpuCompositeMs: number,
    dirtyArea: number,
  ): void {
    const frameMs = performance.now() - frameStartedAt;
    this.lastRevealDiagnostics.frames += 1;
    this.lastRevealDiagnostics.totalMaskRedrawMs += maskRedrawMs;
    this.lastRevealDiagnostics.totalMaskRefreshMs += maskRefreshMs;
    this.lastRevealDiagnostics.totalCpuCompositeMs += cpuCompositeMs;
    this.lastRevealDiagnostics.maxFrameMs = Math.max(this.lastRevealDiagnostics.maxFrameMs, frameMs);
    this.lastRevealDiagnostics.lastDirtyArea = dirtyArea;
    this.publishClassicRenderDiagnostics();
  }

  private publishClassicRenderDiagnostics(): void {
    if (!TEST_HARNESS_ENABLED || typeof window === 'undefined') return;
    const snapshot = this.getClassicRenderDiagnosticsSnapshot();
    (window as unknown as { __FTD_CLASSIC_RENDER_DIAGNOSTICS__?: ClassicRenderDiagnosticsSnapshot })
      .__FTD_CLASSIC_RENDER_DIAGNOSTICS__ = snapshot;
    try {
      window.localStorage.setItem('ftd.classicRenderDiagnostics', JSON.stringify(snapshot));
    } catch {
      // Diagnostics are best-effort and must never affect gameplay.
    }
    console.info('[ftd-classic-render-diagnostics]', JSON.stringify(snapshot));

    if (String(import.meta.env.VITE_FTD_SIM_AUTOPLAY) === 'true') {
      let overlay = document.getElementById('ftd-classic-render-diagnostics');
      if (!overlay) {
        overlay = document.createElement('pre');
        overlay.id = 'ftd-classic-render-diagnostics';
        overlay.style.position = 'fixed';
        overlay.style.left = '8px';
        overlay.style.right = '8px';
        overlay.style.bottom = '8px';
        overlay.style.zIndex = '999999';
        overlay.style.maxHeight = '38vh';
        overlay.style.overflow = 'auto';
        overlay.style.margin = '0';
        overlay.style.padding = '8px';
        overlay.style.borderRadius = '8px';
        overlay.style.background = 'rgba(0, 0, 0, 0.76)';
        overlay.style.color = '#ffffff';
        overlay.style.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
        overlay.style.whiteSpace = 'pre-wrap';
        document.body.appendChild(overlay);
      }
      overlay.textContent = JSON.stringify(snapshot, null, 2);
    }
  }

  private runClassicRenderProbes(): ClassicRenderDiagnosticsSnapshot['probes'] {
    const filterCanvas = document.createElement('canvas');
    filterCanvas.width = 1;
    filterCanvas.height = 1;
    const filterCtx = filterCanvas.getContext('2d', { willReadFrequently: true })!;
    filterCtx.fillStyle = 'rgb(255, 0, 0)';
    filterCtx.fillRect(0, 0, 1, 1);
    filterCtx.filter = 'grayscale(1)';
    filterCtx.drawImage(filterCanvas, 0, 0);
    const filterPixel = filterCtx.getImageData(0, 0, 1, 1).data;
    const canvasFilterGrayscale = Math.abs(filterPixel[0] - filterPixel[1]) <= 2
      && Math.abs(filterPixel[1] - filterPixel[2]) <= 2;

    const sourceInEmptyMaskHidesColor = this.probeCompositeOperation('source-in');
    const destinationInEmptyMaskHidesColor = this.probeCompositeOperation('destination-in');
    const bitmapMaskPipelineAvailable = this.getRendererKind() === 'webgl'
      && Boolean((this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).pipelines.get('BitmapMaskPipeline'));

    return {
      canvasFilterGrayscale,
      generatedBwTextureGrayscale: null,
      sourceInEmptyMaskHidesColor,
      destinationInEmptyMaskHidesColor,
      bitmapMaskPipelineAvailable,
    };
  }

  private isGeneratedBwTextureGrayscale(): boolean | null {
    const source = this.getCanvasSourceImage('bw_generated');
    if (!source) return null;
    const width = Number((source as { width?: number }).width);
    const height = Number((source as { height?: number }).height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(
      source,
      Math.floor(width / 2), Math.floor(height / 2), 1, 1,
      0, 0, 1, 1,
    );
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    return Math.abs(pixel[0] - pixel[1]) <= 2 && Math.abs(pixel[1] - pixel[2]) <= 2;
  }

  private probeCompositeOperation(operation: 'source-in' | 'destination-in'): boolean {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const emptyMask = document.createElement('canvas');
    emptyMask.width = 2;
    emptyMask.height = 2;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    if (operation === 'source-in') {
      ctx.drawImage(emptyMask, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = 'rgb(255, 0, 0)';
      ctx.fillRect(0, 0, 2, 2);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgb(255, 0, 0)';
      ctx.fillRect(0, 0, 2, 2);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(emptyMask, 0, 0);
      ctx.restore();
    }
    return ctx.getImageData(0, 0, 1, 1).data[3] === 0;
  }

  /** Draw the static bw layer once — reused for every partial composite on iOS. */
  private bakeClassicCompositeBase(): void {
    const baseCanvas = this.classicBaseCanvas;
    const compositeCtx = this.compositeCtx;
    const level = this.level;
    if (!baseCanvas || !compositeCtx || !level || !this.textures.exists('bw_generated')) return;

    const baseCtx = baseCanvas.getContext('2d')!;
    const ox = this.imgOffsetX;
    const oy = this.imgOffsetY;
    const dw = level.width * this.imgScale;
    const dh = level.height * this.imgScale;
    const bwSource = this.getCanvasSourceImage('bw_generated');
    if (!bwSource) return;

    baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    baseCtx.drawImage(bwSource, ox, oy, dw, dh);
    compositeCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    compositeCtx.drawImage(baseCanvas, 0, 0);
    this.classicBaseBaked = true;
  }

  /**
   * Classic mode visible layer: draw bw, then masked color on top.
   * iOS only — Android/desktop use BitmapMask on the color layer.
   */
  private syncClassicComposite(dirtyRect: { x: number; y: number; w: number; h: number } | null): void {
    const ctx = this.compositeCtx;
    const overlayCtx = this.classicOverlayCtx;
    const maskCanvas = this.maskCanvas;
    const overlayCanvas = this.classicOverlayCanvas;
    const baseCanvas = this.classicBaseCanvas;
    const level = this.level;
    if (
      !ctx
      || !overlayCtx
      || !maskCanvas
      || !overlayCanvas
      || !baseCanvas
      || !level
      || !this.classicUsesCpuComposite
      || !this.textures.exists('bw_generated')
      || !this.textures.exists('color')
    ) {
      return;
    }

    if (!this.classicBaseBaked) this.bakeClassicCompositeBase();

    const ox = this.imgOffsetX;
    const oy = this.imgOffsetY;
    const dw = level.width * this.imgScale;
    const dh = level.height * this.imgScale;
    const colorSource = this.getCanvasSourceImage('color');
    if (!colorSource) return;

    const rect = dirtyRect ?? { x: 0, y: 0, w: maskCanvas.width, h: maskCanvas.height };
    const { x: rx, y: ry, w: rw, h: rh } = rect;

    overlayCtx.save();
    overlayCtx.beginPath();
    overlayCtx.rect(rx, ry, rw, rh);
    overlayCtx.clip();
    overlayCtx.clearRect(rx, ry, rw, rh);
    overlayCtx.globalCompositeOperation = 'source-over';
    overlayCtx.drawImage(maskCanvas, 0, 0);
    overlayCtx.globalCompositeOperation = 'source-in';
    overlayCtx.drawImage(colorSource, ox, oy, dw, dh);
    overlayCtx.globalCompositeOperation = 'source-over';
    overlayCtx.restore();

    ctx.drawImage(baseCanvas, rx, ry, rw, rh, rx, ry, rw, rh);
    ctx.drawImage(overlayCanvas, rx, ry, rw, rh, rx, ry, rw, rh);
    this.refreshCanvasTexture('classic_composite');
  }

  /** Prefer the backing canvas element for CPU compositing (stable on iOS WebGL). */
  private getCanvasSourceImage(textureKey: string): CanvasImageSource | null {
    if (!this.textures.exists(textureKey)) return null;
    const texture = this.textures.get(textureKey);
    if (texture instanceof Phaser.Textures.CanvasTexture) {
      return texture.getCanvas();
    }
    return texture.getSourceImage() as CanvasImageSource;
  }

  private desaturateImageDataInPlace(imageData: ImageData): void {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) | 0;
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }
  }

  /** Upload a canvas-backed texture to the GPU (required on iOS WebGL after every CPU-side edit). */
  private refreshCanvasTexture(textureKey: string): void {
    if (!this.textures.exists(textureKey)) return;
    const tex = this.textures.get(textureKey);
    if (tex instanceof Phaser.Textures.CanvasTexture) {
      tex.refresh();
    }
  }

  private capTextureLongEdge(textureKey: string): void {
    if (!this.textures.exists(textureKey)) return;

    const texture = this.textures.get(textureKey);
    const source = texture.getSourceImage() as CanvasImageSource & { width?: number; height?: number };
    const width = Number(source.width);
    const height = Number(source.height);
    const sourceLongEdge = Math.max(width, height);
    if (!Number.isFinite(sourceLongEdge) || sourceLongEdge <= this.runtimeTextureLongEdge) return;

    const ratio = this.runtimeTextureLongEdge / sourceLongEdge;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));

    this.textures.remove(textureKey);
    this.textures.addCanvas(textureKey, canvas);
    const cappedTexture = this.textures.get(textureKey) as Phaser.Textures.CanvasTexture;
    const ctx = cappedTexture.context;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height, 0, 0, canvas.width, canvas.height);
    this.refreshCanvasTexture(textureKey);
  }

  /** Generate grayscale texture from the capped color texture at logical level size. */
  private generateGrayscaleTexture(): void {
    if (this.textures.exists('bw_generated')) return;

    const source = this.getCanvasSourceImage('color');
    if (!source) return;

    const sourceWidth = Number((source as { width?: number }).width);
    const sourceHeight = Number((source as { height?: number }).height);
    const canvas = document.createElement('canvas');
    canvas.width = this.level?.width ?? sourceWidth;
    canvas.height = this.level?.height ?? sourceHeight;

    // Desaturate at capped source resolution, then scale up — avoids a
    // multi-megapixel getImageData pass on 4K logical level dimensions.
    const scratch = document.createElement('canvas');
    scratch.width = sourceWidth;
    scratch.height = sourceHeight;
    const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })!;
    scratchCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight);
    const pixels = scratchCtx.getImageData(0, 0, sourceWidth, sourceHeight);
    this.desaturateImageDataInPlace(pixels);
    scratchCtx.putImageData(pixels, 0, 0);

    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);

    this.textures.addCanvas('bw_generated', canvas);
    this.refreshCanvasTexture('bw_generated');
  }

  private createPawTexture(): void {
    if (this.textures.exists('paw_particle')) return;
    const gfx = this.add.graphics();
    gfx.fillStyle(0x8b4513);
    gfx.fillCircle(4, 4, 4);
    gfx.generateTexture('paw_particle', 8, 8);
    gfx.destroy();
  }

  private emitPawBurst(x: number, y: number): void {
    if (!remoteConfigService.value('findMomentBurstEnabled')) return;

    const emitter = this.add.particles(0, 0, 'paw_particle', {
      speed: { min: 80, max: 200 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.5, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 600,
      gravityY: 100,
      tint: [0x8b4513, 0xa0522d, 0xd2691e],
      emitting: false,
    });
    // Pin to viewport — (x, y) are pointer.x/pointer.y (unscrolled
    // screen coords; see handleTap for the documented contract). Without
    // setScrollFactor(0), scroll offsets the burst; without the zoom
    // conversion below, camera zoom scales it away from the finger.
    emitter.setScrollFactor(0);
    const point = this.viewportToScrollFactorZeroPoint(x, y);
    this.lastViewportEffect = { kind: 'paw', requested: { x, y }, emitted: point };
    emitter.explode(GAMEPLAY.PARTICLE_COUNT, point.x, point.y);
    this.time.delayedCall(800, () => emitter.destroy());
  }

  private createDustTexture(): void {
    if (this.textures.exists('dust_particle')) return;
    // Soft neutral puff. Deliberately abstract + grey — NOT paw/footprint shaped
    // and not dog-coloured, so it can never read as a hint about where a dog is
    // (this is a hidden-object game; see docs/solutions/best-practices/
    // hidden-object-ambient-motion-evidence-cues-20260520.md).
    const gfx = this.add.graphics();
    gfx.fillStyle(0xbfb8ad);
    gfx.fillCircle(4, 4, 4);
    gfx.generateTexture('dust_particle', 8, 8);
    gfx.destroy();
  }

  /** Small abstract dust puff at the tap point on a miss — a gentle "poof, nope". */
  private emitDustPoof(x: number, y: number, reducedMotion: boolean): void {
    if (reducedMotion) return;

    const emitter = this.add.particles(0, 0, 'dust_particle', {
      speed: { min: 20, max: 70 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.1, end: 0 },
      alpha: { start: 0.7, end: 0 },
      lifespan: TIMING.DUST_POOF_LIFESPAN_MS,
      gravityY: 0,
      tint: [0xcfc8bd, 0xbfb8ad, 0xa89f93],
      emitting: false,
    });
    // Same screen-space contract as emitPawBurst: pin to the viewport and
    // compensate for camera zoom so the puff lands at the pointer.
    emitter.setScrollFactor(0);
    const point = this.viewportToScrollFactorZeroPoint(x, y);
    this.lastViewportEffect = { kind: 'dust', requested: { x, y }, emitted: point };
    emitter.explode(GAMEPLAY.DUST_PARTICLE_COUNT, point.x, point.y);
    this.time.delayedCall(TIMING.DUST_POOF_DESTROY_MS, () => emitter.destroy());
  }

  /**
   * Gentle whole-board "no" wobble on a miss. Just a short, low-intensity camera
   * shake (not a per-sprite tween) — the camera self-restores its transform and
   * the 300ms penalty cooldown outlasts the shake so back-to-back misses don't
   * stack. Deliberately motion-only: an earlier black-backdrop reveal + zoom
   * recoil read as too harsh on device, so it was removed in favour of a soft
   * shake like the original.
   */
  private shakeBoardOnMiss(reducedMotion: boolean): void {
    this.cameras.main.shake(
      reducedMotion ? TIMING.MISS_SHAKE_MS_REDUCED : TIMING.MISS_SHAKE_MS,
      reducedMotion ? GAMEPLAY.MISS_SHAKE_INTENSITY_REDUCED : GAMEPLAY.MISS_SHAKE_INTENSITY,
    );
  }

  // ---- Hint circle ----

  private hintCircleGfx: Phaser.GameObjects.Graphics | null = null;
  private hintCircleTween: Phaser.Tweens.Tween | null = null;

  private onHintRequested(): void {
    // Tutorial step 2 → 3: the hint tap advances to the zoom lesson (handled by
    // TutorialOverlay); suppress the hint itself so no circle shows / no hint is
    // spent. One-shot: later hint taps (during zoom, or normal play) fire.
    if (this.tutorialHintStep) {
      this.tutorialHintStep = false;
      return;
    }
    if (!this.level || gameState.hintCircleActive || gameState.hintsRemaining <= 0) return;

    const unfound = this.level.dogs.filter((d) => !gameState.foundDogIds.has(d.id));
    if (unfound.length === 0) return;

    const dog = unfound[Math.floor(Math.random() * unfound.length)];
    if (!gameState.spendHint('gameplayHint')) return;
    gameState.hintCircleActive = true;
    gameState.save();
    this.hintsUsedThisLevel += 1;
    this.trackHintUsedAnalytics();
    updateHUD(this.level.dogs.length, this.isRestoration);

    const sx = this.imgOffsetX + dog.x * this.imgScale;
    const sy = this.imgOffsetY + dog.y * this.imgScale;
    const sr = dog.r * this.imgScale * GAMEPLAY.TOLERANCE_MULTIPLIER;

    this.hintCircleGfx = this.add.graphics();
    this.hintCircleGfx.setDepth(50);

    const drawHintCircle = (scale: number): void => {
      if (!this.hintCircleGfx) return;
      const radius = sr * scale;
      this.hintCircleGfx.clear();
      // Tri-stroke so the ring stays readable on any art: dark halo
      // carries it on light scenes, the white inner edge on dark ones.
      this.hintCircleGfx.lineStyle(10, 0x1c2733, 0.35);
      this.hintCircleGfx.strokeCircle(sx, sy, radius + 3);
      this.hintCircleGfx.lineStyle(6, COLORS.HINT_CIRCLE, 0.95);
      this.hintCircleGfx.strokeCircle(sx, sy, radius);
      this.hintCircleGfx.lineStyle(2, 0xffffff, 0.9);
      this.hintCircleGfx.strokeCircle(sx, sy, radius - 4);
    };

    drawHintCircle(1);
    const pulseTarget = { scale: 1 };
    this.hintCircleTween = this.tweens.add({
      targets: pulseTarget,
      scale: 1.2,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => drawHintCircle(pulseTarget.scale),
    });
  }

  dismissHintCircle(): void {
    if (this.hintCircleTween) {
      this.hintCircleTween.destroy();
      this.hintCircleTween = null;
    }
    if (this.hintCircleGfx) {
      this.hintCircleGfx.destroy();
      this.hintCircleGfx = null;
    }
    gameState.hintCircleActive = false;
    if (this.level) updateHUD(this.level.dogs.length, this.isRestoration);
  }

  // ---- Debug overlay ----

  private debugGfx: Phaser.GameObjects.Graphics | null = null;
  private debugTexts: Phaser.GameObjects.Text[] = [];

  private toggleDebugOverlay(): void {
    if (this.debugGfx) {
      this.hideDebugOverlay();
    } else {
      this.showDebugOverlay();
    }
  }

  /** Public so HUD/settings can flip the overlay without going through D key. */
  showDebugOverlay(): void {
    if (this.debugGfx || !this.level) return;

    this.debugGfx = this.add.graphics();
    this.debugGfx.setDepth(100);

    for (const dog of this.level.dogs) {
      const sx = this.imgOffsetX + dog.x * this.imgScale;
      const sy = this.imgOffsetY + dog.y * this.imgScale;
      const sr = dog.r * this.imgScale;
      const warnings = this.hitboxVisibilityWarnings(dog);
      const hasWarnings = warnings.length > 0;
      const color = hasWarnings ? 0xffb020 : 0xff0000;
      const labelColor = hasWarnings ? '#ffcc66' : '#ff0000';

      this.debugGfx.lineStyle(2, color, hasWarnings ? 0.95 : 0.7);
      this.debugGfx.strokeCircle(sx, sy, sr);

      this.debugGfx.lineStyle(1, color, hasWarnings ? 0.55 : 0.3);
      this.debugGfx.strokeCircle(sx, sy, sr * GAMEPLAY.TOLERANCE_MULTIPLIER);

      this.debugGfx.fillStyle(color, 0.8);
      this.debugGfx.fillCircle(sx, sy, 3);

      const label = this.add.text(sx + 10, sy - 10, hasWarnings ? `${dog.id} ! ${warnings.join(', ')}` : dog.id, {
        fontSize: '10px',
        color: labelColor,
        backgroundColor: hasWarnings ? 'rgba(0,0,0,0.65)' : undefined,
        padding: hasWarnings ? { x: 3, y: 2 } : undefined,
      }).setDepth(101);
      this.debugTexts.push(label);
    }
  }

  private hitboxVisibilityWarnings(dog: LevelDog): HitboxVisibilityWarning[] {
    if (!this.level) return [];
    const warnings: HitboxVisibilityWarning[] = [];
    const scale = this.imgScale;
    const screenR = dog.r * scale;
    let screenX: number;
    let screenY: number;

    if (this.level.sections && this.level.sections.length > 0) {
      const section = this.level.sections.find((s) => dog.x >= s.xStart && dog.x < s.xEnd)
        ?? this.level.sections[this.level.sections.length - 1];
      screenX = dog.x * scale - section.xStart * scale;
      screenY = this.imgOffsetY + dog.y * scale;
    } else {
      screenX = this.imgOffsetX + dog.x * scale;
      screenY = this.imgOffsetY + dog.y * scale;
    }

    const left = screenX - screenR;
    const right = screenX + screenR;
    const top = screenY - screenR;
    const bottom = screenY + screenR;
    if (left < 0 || right > GAME.WIDTH || top < 0 || bottom > GAME.HEIGHT) {
      warnings.push('clipped');
    }

    const blockedAreas: Array<[HitboxVisibilityWarning, number, number, number, number]> = [
      ['HUD', 0, 0, GAME.WIDTH, GAME.HEIGHT * 0.139],
      ['AD', 0, GAME.HEIGHT - GAME.HEIGHT * 0.071, GAME.WIDTH, GAME.HEIGHT * 0.071],
    ];
    if (this.level.sections && this.level.sections.length > 0) {
      const safeX = GAME.WIDTH * (60 / 640);
      blockedAreas.push(
        ['SAFE_L', 0, 0, safeX, GAME.HEIGHT],
        ['SAFE_R', GAME.WIDTH - safeX, 0, safeX, GAME.HEIGHT],
      );
    }
    for (const [label, x, y, width, height] of blockedAreas) {
      if (right > x && left < x + width && bottom > y && top < y + height) {
        warnings.push(label);
      }
    }

    return warnings;
  }

  hideDebugOverlay(): void {
    if (!this.debugGfx) return;
    this.debugGfx.destroy();
    this.debugGfx = null;
    for (const t of this.debugTexts) t.destroy();
    this.debugTexts = [];
  }

  // ---- Public accessors for test harness ----

  getLevel(): LevelData | null {
    return this.level;
  }

  isLevelComplete(): boolean {
    return this.levelComplete;
  }

  getRevealedCellCount(): number {
    return this.revealedCells.length;
  }

  /** Restoration mode: total dissolve cells in flight or completed for this level. */
  getDissolveCellCount(): { active: number; completed: number } {
    return {
      active: this.dissolveActiveCells.length,
      completed: this.dissolveCompletedCells.length,
    };
  }

  getLastRestorationDissolveBounds(): LevelRect | null {
    return this.lastRestorationDissolveBounds;
  }

  getRestorationMaskAlphaAtLevelPoint(levelX: number, levelY: number): number | null {
    if (!this.isRestoration || !this.maskCtx || !this.maskCanvas) return null;
    const screenX = Math.round(this.imgOffsetX + levelX * this.imgScale);
    const screenY = Math.round(this.imgOffsetY + levelY * this.imgScale);
    if (
      screenX < 0
      || screenY < 0
      || screenX >= this.maskCanvas.width
      || screenY >= this.maskCanvas.height
    ) {
      return null;
    }
    return this.maskCtx.getImageData(screenX, screenY, 1, 1).data[3] ?? null;
  }

  getPickupAnimationCount(): { active: number; completed: number } {
    return {
      active: this.pickupAnimationsActive,
      completed: this.pickupAnimationsCompleted,
    };
  }

  /** True when setupLevel has resolved the scene in Restoration mode. */
  getIsRestoration(): boolean {
    return this.isRestoration;
  }

  getCameraZoom(): number {
    return this.cameras.main.zoom;
  }

  getLastViewportEffectSnapshot(): ViewportEffectSnapshot | null {
    return this.lastViewportEffect;
  }

  getRuntimeTexturesSnapshot(): RuntimeTexturesSnapshot {
    return {
      maxLongEdge: this.runtimeTextureLongEdge,
      color: this.getRuntimeTextureSnapshot('color', this.colorImage),
      bw: this.getRuntimeTextureSnapshot('bw_generated', this.bwImage),
      bg: this.bgLayers
        .map((layer, index) => this.getRuntimeTextureSnapshot(`bg_${index}`, layer))
        .filter((snapshot): snapshot is RuntimeTextureSnapshot => snapshot !== null),
    };
  }

  getClassicRenderDiagnosticsSnapshot(): ClassicRenderDiagnosticsSnapshot {
    return {
      platform: Capacitor.getPlatform(),
      renderer: this.getRendererKind(),
      classicRenderPath: this.classicRenderPath,
      maskCanvas: this.maskCanvas
        ? { width: this.maskCanvas.width, height: this.maskCanvas.height }
        : null,
      compositeCanvas: this.compositeCanvas
        ? { width: this.compositeCanvas.width, height: this.compositeCanvas.height }
        : null,
      probes: { ...this.classicRenderProbes },
      lastReveal: { ...this.lastRevealDiagnostics },
    };
  }

  private resolveRuntimeTextureLongEdge(): number {
    if (this.getRendererKind() !== 'webgl') return resolveRuntimeTextureLongEdge(null);
    const gl = (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl;
    return resolveRuntimeTextureLongEdge(Number(gl?.getParameter(gl.MAX_TEXTURE_SIZE)));
  }

  private getRuntimeTextureSnapshot(
    textureKey: string,
    image: Phaser.GameObjects.Image | null,
  ): RuntimeTextureSnapshot | null {
    if (!this.textures.exists(textureKey)) return null;
    const source = this.textures.get(textureKey).getSourceImage() as { width?: number; height?: number };
    const sourceWidth = Number(source.width);
    const sourceHeight = Number(source.height);
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) return null;
    return {
      sourceWidth,
      sourceHeight,
      displayWidth: image?.displayWidth ?? null,
      displayHeight: image?.displayHeight ?? null,
    };
  }

  getSectionSnapshot(): {
    currentIndex: number;
    targetIndex: number | null;
    isPanning: boolean;
    isAfterMidpan: boolean;
    tappableXStart: number;
    tappableXEnd: number;
    cameraScrollX: number;
    cameraScrollY: number;
    totalSections: number;
  } | null {
    if (!this.sectionController) return null;
    const targetIndex =
      this.sectionController.isPanning &&
        this.sectionController.isAfterMidpan &&
        this.sectionController.targetSectionIndex !== null
        ? this.sectionController.targetSectionIndex
        : this.sectionController.currentSectionIndex;
    const tappableSection = this.level?.sections?.[targetIndex];
    return {
      currentIndex: this.sectionController.currentSectionIndex,
      targetIndex: this.sectionController.targetSectionIndex,
      isPanning: this.sectionController.isPanning,
      isAfterMidpan: this.sectionController.isAfterMidpan,
      tappableXStart: tappableSection?.xStart ?? 0,
      tappableXEnd: tappableSection?.xEnd ?? this.level?.width ?? 0,
      cameraScrollX: this.cameras.main.scrollX,
      cameraScrollY: this.cameras.main.scrollY,
      totalSections: this.sectionController.totalSections,
    };
  }

  isLevelDataReady(): boolean {
    return this.levelDataReady;
  }
}
