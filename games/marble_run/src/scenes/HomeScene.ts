import Phaser from 'phaser';
import { gameState } from '../core/GameState';
import { getLevelIndex, loadLevel, loadLevelForProgression, type LevelData, type LevelIndexEntry } from '../data/levels';
import { initHUD, setHomeCallback } from '../ui/HUD';
import { hideHomeMenuLayer, showHomeMenuLayer } from '../ui/OverlayVisibility';
import { hideSceneTransitionCoverAfterPaint, showPlayEntryTransitionCover } from '../ui/SceneTransitionCover';
import { adService } from '../ads/Service';
import { hapticWrong } from '../haptics/HapticsManager';
import { configuredMenuVignetteFactory, type MenuVignette } from '../menu/MenuVignette';
import { crossfadeTo as crossfadeAmbient, presetForLevel } from '../audio/AmbientManager';
import type { UiHandle } from '@fabrikav2/ui';
import { mountHomeShell } from '../menu/homeMenu';
import { HomeBoardPreview } from '../menu/HomeBoardPreview';
import { mountSettings } from '../menu/settings';
import { buildSagaNodes } from '../menu/saga';
import {
  type CancelScheduledIdleWork,
  hasLowDataConnection,
  runWhenVisibleAndIdle,
} from '../platform/browserScheduling';
import { isGameSuspended, registerLifecycleHooks } from '../platform/gameLifecycle';
import type { GameSceneData } from './GameScene';
import { GameScene } from './GameScene';

const BANNER_VIDEO_REPLAY_DELAY_MS = 10_000;
const BANNER_VIDEO_INITIAL_DELAY_MS = 8_000;
const BANNER_VIDEO_MAX_RETRY_ATTEMPTS = 2;
// Start home BGM promptly (was 8s + 5s idle, which left the menu silent for
// ~8–13s). Kept at a moderate 1.5s rather than near-zero: the 8s value was a
// deliberate load/battery optimization (see docs/retros/2026-06-04-ftd-load-
// battery-optimization.md) to keep the boot network window clear of the 4.7MB
// ambient track. The heavy fetch stays gesture-gated in AmbientManager, so on a
// cold boot it still can't front-load; 1.5s just makes the post-tap crossfade
// feel prompt without re-opening the 0–1s boot contention.
const HOME_AMBIENT_DELAY_MS = 1_500;
// Forces the crossfade registration by ~3s total (delay + idle) even if the
// browser stays busy. Cheap to run here — only the (gesture-gated) crossfade is
// registered; the 4.7MB fetch doesn't land until after user activation.
const HOME_AMBIENT_IDLE_TIMEOUT_MS = 1_500;
const HOME_PREWARM_DELAY_MS = 2_500;
const HOME_PREWARM_IDLE_TIMEOUT_MS = 2_500;

function shouldRunHomeBannerVideo(): boolean {
  return !hasLowDataConnection() && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class HomeScene extends Phaser.Scene {
  private overlay: HTMLElement | null = null;
  private homeHandle: UiHandle | null = null;
  private settingsHandle: UiHandle | null = null;
  private levelIndex: LevelIndexEntry[] = [];
  private bannerVideoReplayTimer: number | null = null;
  private bannerVideoElement: HTMLVideoElement | null = null;
  private bannerVideoEndedHandler: ((event: Event) => void) | null = null;
  private bannerVideoRetryCount: number = 0;
  private navigationGeneration: number = 0;
  private isShuttingDown: boolean = false;
  private cancelHomeAmbientSchedule: CancelScheduledIdleWork | null = null;
  private cancelPrewarmSchedule: CancelScheduledIdleWork | null = null;
  private unregisterLifecycleHooks: (() => void) | null = null;
  /** In-flight/completed background texture warm for the current level.
   *  `token.stale` flips to abort a warm the launch path has superseded. */
  private prewarm: { levelId: string; token: { stale: boolean }; promise: Promise<void> } | null = null;
  private boardPreview: HomeBoardPreview | null = null;
  private menuVignette: MenuVignette | null = null;
  private menuVignettePoll: Phaser.Time.TimerEvent | null = null;
  private menuVignettePaused = false;

  constructor() {
    super('HomeScene');
  }

  create(): void {
    this.isShuttingDown = false;
    const overlay = document.getElementById('hud-overlay');
    if (!overlay) {
      this.scene.start('GameScene');
      return;
    }

    this.overlay = overlay;
    void adService.hideBanner();
    setHomeCallback(() => this.renderHomeScreen());
    this.renderHomeScreen();
    this.scheduleHomeAmbient();
    this.registerLifecycleSuspendHooks();
    this.startMenuVignette();
    // The level map paints real numbered nodes synchronously (buildLevelMapNodes
    // seeds from gameState.currentLevelIndex before the async index resolves),
    // so the home can reveal immediately without flashing a numberless
    // placeholder. getLevelIndex() then refines names/end-of-sequence windowing.
    hideSceneTransitionCoverAfterPaint();
    void getLevelIndex().then((index) => {
      this.levelIndex = index;
      gameState.reconcileLevelOrder(index.map((entry) => entry.id));
      if (!this.isShuttingDown && this.overlay?.querySelector('#home-shell')) {
        // Only refresh the level map — the banner/pills/nav are unchanged, so
        // re-rendering the whole home here would make them pop in.
        this.mountHomeLevelMap();
      }
      this.schedulePrewarmCurrentLevel();
    });

    this.events.once('shutdown', () => {
      this.isShuttingDown = true;
      this.navigationGeneration += 1;
      this.stopMenuVignette();
      this.cancelScheduledHomeAmbient();
      this.cancelScheduledPrewarm();
      // Abort any in-flight warm so it can't mutate shared textures after the
      // next scene's loader takes over.
      if (this.prewarm !== null) this.prewarm.token.stale = true;
      this.clearBannerVideoReplay();
      this.disposeBoardPreview();
      this.unregisterLifecycleHooks?.();
      this.unregisterLifecycleHooks = null;
      hideHomeMenuLayer(overlay);
      this.dismissSettings();
      this.homeHandle?.dismiss();
      this.homeHandle = null;
      if (overlay.querySelector('#home-shell')) overlay.innerHTML = '';
      this.overlay = null;
    });
  }

  /**
   * Optional ambient game vignette on the canvas behind the DOM shell (see
   * src/menu/MenuVignette.ts). The shell owns the loop: paused on lifecycle
   * suspend and while a page overlay (shop/settings) covers the home, torn
   * down on scene shutdown. A 400ms poll decides overlay pause — cheap, and
   * keeps openPage/closePage free of vignette coupling.
   */
  private startMenuVignette(): void {
    const factory = configuredMenuVignetteFactory();
    if (factory === null) return;
    this.stopMenuVignette();
    this.menuVignette = factory(this);
    this.overlay?.classList.add('hud-vignette-active');
    this.menuVignettePoll = this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        if (this.menuVignette === null) return;
        const covered = document.getElementById('home-page-overlay') !== null || isGameSuspended();
        if (covered && !this.menuVignettePaused) {
          this.menuVignette.pause();
          this.menuVignettePaused = true;
        } else if (!covered && this.menuVignettePaused) {
          this.menuVignette.resume();
          this.menuVignettePaused = false;
        }
      },
    });
  }

  private stopMenuVignette(): void {
    this.overlay?.classList.remove('hud-vignette-active');
    this.menuVignettePoll?.remove();
    this.menuVignettePoll = null;
    this.menuVignette?.stop();
    this.menuVignette = null;
    this.menuVignettePaused = false;
  }

  private registerLifecycleSuspendHooks(): void {
    this.unregisterLifecycleHooks?.();
    this.unregisterLifecycleHooks = registerLifecycleHooks('home-scene', {
      onSuspend: (): void => {
        if (this.isShuttingDown || !this.sys.isActive()) return;
        this.navigationGeneration += 1;
        this.cancelScheduledHomeAmbient();
        this.cancelScheduledPrewarm();
        this.staleActivePrewarm();
        if (this.bannerVideoReplayTimer !== null) {
          window.clearTimeout(this.bannerVideoReplayTimer);
          this.bannerVideoReplayTimer = null;
        }
        if (this.bannerVideoElement !== null) {
          this.bannerVideoElement.pause();
          this.bannerVideoElement.dataset.replayState = 'suspended';
        }
      },
      onResume: (): void => {
        if (this.isShuttingDown || !this.sys.isActive() || this.overlay?.querySelector('#home-shell') == null) return;
        this.setMapButtonsDisabled(false);
        this.startBannerVideoReplay();
        this.scheduleHomeAmbient();
        this.schedulePrewarmCurrentLevel();
      },
    });
  }

  private renderHomeScreen(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    this.navigationGeneration += 1;
    this.clearBannerVideoReplay();
    this.dismissSettings();
    this.disposeBoardPreview();
    if (this.homeHandle) {
      this.homeHandle.dismiss();
      this.homeHandle = null;
    }
    showHomeMenuLayer(overlay);

    const currentIndex = Math.max(0, gameState.currentLevelIndex);
    const nodes = buildSagaNodes({
      currentIndex,
      levelCount: this.levelIndex.length,
      nameFor: (logical) =>
        this.levelIndex.length === 0
          ? undefined
          : this.levelIndex[this.contentLevelIndex(logical)]?.name,
    });

    this.homeHandle = mountHomeShell({
      mountInto: overlay,
      coins: gameState.walletSnapshot().coins,
      nodes,
      currentLevelNumber: currentIndex + 1,
      onStart: () => this.startCurrentLevel(),
      onSelectLevel: (id) => {
        const index = Number(id);
        // Compare against the SAME clamp the saga uses for the current node's id,
        // so a corrupted negative currentLevelIndex still lets the current node
        // start (parity with the old state-based gate).
        if (Number.isInteger(index) && index === Math.max(0, gameState.currentLevelIndex)) {
          this.startCurrentLevelAt(index);
        } else {
          this.rejectLockedNode(id);
        }
      },
      onOpenSettings: () => this.openHomeSettings(),
    });

    this.mountBoardPreview();
  }

  /**
   * v1 `App.showMenuDecor` parity: the tilted decor board between banner and
   * saga chain. Owns its own three.js canvas + loop (HomeBoardPreview), disposed
   * on every re-render / gameplay entry / shutdown so no WebGL context leaks. The
   * canvas is CSS-positioned via `.marble-home-board-preview`.
   */
  private mountBoardPreview(): void {
    this.disposeBoardPreview();
    const shell = this.overlay?.querySelector<HTMLElement>('#home-shell');
    if (!shell) return;
    // Place the decor tile in DOM flow between the header and the saga chain
    // (v1 renders it in that region). A dedicated slot keeps the canvas sizing
    // independent of the kit saga layout.
    const header = shell.querySelector<HTMLElement>('.marble-home-header');
    const slot = document.createElement('div');
    slot.className = 'marble-home-board-preview-slot';
    if (header) header.insertAdjacentElement('afterend', slot);
    else shell.prepend(slot);
    this.boardPreview = new HomeBoardPreview(slot, 'marble-home-board-preview');
  }

  private disposeBoardPreview(): void {
    if (this.boardPreview !== null) {
      this.boardPreview.dispose();
      this.boardPreview = null;
    }
  }

  private openHomeSettings(): void {
    if (this.settingsHandle || !this.overlay) return;
    this.settingsHandle = mountSettings({
      mountInto: this.overlay,
      inGame: false,
      onDismiss: () => { this.settingsHandle = null; },
    });
  }

  private dismissSettings(): void {
    if (this.settingsHandle) {
      const handle = this.settingsHandle;
      this.settingsHandle = null;
      handle.dismiss();
    }
  }

  private startCurrentLevel(): void {
    this.startCurrentLevelAt(gameState.currentLevelIndex);
  }

  private startCurrentLevelAt(index: number): void {
    if (this.settingsHandle) return;
    void this.startLevelFromMap(index);
  }

  /** (Re)mount the home shell so the saga rail reflects the resolved level index. */
  private mountHomeLevelMap(): void {
    if (!this.overlay?.querySelector('#home-shell')) return;
    this.renderHomeScreen();
  }

  private startGameScene(levelData?: LevelData): void {
    const overlay = this.overlay;
    // Clone the live home into the cover BEFORE the overlay is torn down —
    // the play-entry transition flies the cloned pieces off-screen.
    showPlayEntryTransitionCover();
    this.cancelScheduledHomeAmbient();
    this.clearBannerVideoReplay();
    this.dismissSettings();
    this.disposeBoardPreview();
    this.homeHandle?.dismiss();
    this.homeHandle = null;
    if (overlay) {
      hideHomeMenuLayer(overlay);
      overlay.innerHTML = '';
    }
    initHUD();
    const sceneData: GameSceneData = levelData === undefined ? {} : { levelData };
    this.scene.start('GameScene', sceneData);
  }

  private async startLevelFromMap(index: number): Promise<void> {
    const generation = this.navigationGeneration + 1;
    this.navigationGeneration = generation;
    this.cancelScheduledHomeAmbient();
    this.cancelScheduledPrewarm();
    this.setMapButtonsDisabled(true);
    try {
      if (this.levelIndex.length === 0) {
        this.levelIndex = await getLevelIndex();
        gameState.reconcileLevelOrder(this.levelIndex.map((entry) => entry.id));
        if (this.isNavigationCancelled(generation)) return;
      }

      const logicalIndex = Math.max(0, index);
      const contentIndex = this.contentLevelIndex(logicalIndex);
      const entry = this.levelIndex[contentIndex];
      if (!entry) {
        this.setMapButtonsDisabled(false);
        return;
      }
      const levelData = await loadLevelForProgression(logicalIndex);
      if (this.isNavigationCancelled(generation)) return;
      // If we already warmed this exact level's textures on the home map, let
      // the in-flight decode finish before starting the scene. This both
      // delivers the speedup (GameScene.preload becomes a no-op) and prevents
      // a partial warm from racing Phaser's loader on the same texture key.
      if (this.prewarm !== null) {
        if (this.prewarm.levelId === levelData.id) {
          await this.prewarm.promise.catch(() => undefined);
          if (this.isNavigationCancelled(generation)) return;
        } else {
          // CDN fallback served a different level than we warmed. Mark the
          // in-flight warm stale so it stops touching the shared color/bg
          // texture keys before this scene's loader claims them.
          this.prewarm.token.stale = true;
        }
      }
      gameState.currentLevelIndex = logicalIndex;
      gameState.save();
      this.startGameScene(levelData);
    } catch (error) {
      console.warn('Failed to load level from home map', error);
      if (this.isNavigationCancelled(generation)) return;
      this.setMapButtonsDisabled(false);
    }
  }

  private isNavigationCancelled(generation: number): boolean {
    return this.navigationGeneration !== generation || this.isShuttingDown || !this.sys.isActive() || isGameSuspended();
  }

  /**
   * Kick off a best-effort texture warm for the level the Play button will
   * launch. Fire-and-forget: any failure falls back to GameScene.preload
   * loading the textures normally, so it must never surface to the player.
   */
  private schedulePrewarmCurrentLevel(): void {
    // Defer warming to browser idle so it never competes with the boot →
    // GameScene transition (or an immediate Play tap). Warming eagerly on
    // HomeScene create floods the asset/IndexedDB layer during the window where
    // boot is still resolving the runtime sequence / Remote Config, which both
    // slows that path and races it. If the player (or a test harness) leaves
    // home before idle fires, the isShuttingDown guard skips the work entirely;
    // a player who dwells on the map still gets the first-play speedup.
    const generation = this.navigationGeneration;
    const run = (): void => {
      if (this.isShuttingDown || !this.sys.isActive() || this.navigationGeneration !== generation) return;
      void this.prewarmCurrentLevel(generation).catch((error) => {
        console.warn('Home level prewarm failed', error);
      });
    };
    this.cancelScheduledPrewarm();
    this.cancelPrewarmSchedule = runWhenVisibleAndIdle(run, {
      delayMs: HOME_PREWARM_DELAY_MS,
      idleTimeoutMs: HOME_PREWARM_IDLE_TIMEOUT_MS,
      shouldRun: () => !this.isShuttingDown && this.sys.isActive() && this.navigationGeneration === generation,
    });
  }

  private scheduleHomeAmbient(): void {
    this.cancelScheduledHomeAmbient();
    this.cancelHomeAmbientSchedule = runWhenVisibleAndIdle((): void => {
      if (this.isShuttingDown || !this.sys.isActive()) return;
      crossfadeAmbient(presetForLevel('home'));
    }, {
      delayMs: HOME_AMBIENT_DELAY_MS,
      idleTimeoutMs: HOME_AMBIENT_IDLE_TIMEOUT_MS,
      shouldRun: () => !this.isShuttingDown && this.sys.isActive(),
    });
  }

  private cancelScheduledHomeAmbient(): void {
    this.cancelHomeAmbientSchedule?.();
    this.cancelHomeAmbientSchedule = null;
  }

  private cancelScheduledPrewarm(): void {
    this.cancelPrewarmSchedule?.();
    this.cancelPrewarmSchedule = null;
  }

  private staleActivePrewarm(): void {
    if (this.prewarm !== null) {
      this.prewarm.token.stale = true;
      this.prewarm = null;
    }
  }

  private async prewarmCurrentLevel(generation: number): Promise<void> {
    if (this.levelIndex.length === 0) return;
    const contentIndex = this.contentLevelIndex(Math.max(0, gameState.currentLevelIndex));
    const entry = this.levelIndex[contentIndex];
    if (entry === undefined) return;
    if (this.prewarm !== null && this.prewarm.levelId === entry.id) return;
    if (this.isShuttingDown || !this.sys.isActive() || this.navigationGeneration !== generation) return;

    // loadLevel caches in levelCache and has no serving-attempt side effects,
    // so the eventual loadLevelForProgression on Play reuses this exact
    // LevelData (same asset URLs) — the warmed texture keys stay valid.
    const levelData = await loadLevel(entry.id);
    if (this.isShuttingDown || !this.sys.isActive() || this.navigationGeneration !== generation) return;
    if (this.prewarm !== null && this.prewarm.levelId === entry.id) return;
    const token = { stale: false };
    const promise = GameScene.prewarmLevel(this.textures, levelData, () => token.stale);
    this.prewarm = { levelId: entry.id, token, promise };
    await promise;
  }

  /** Locked node tapped: replay a quick shake on that node and fire the "wrong"
   *  haptic. No navigation — locked levels stay locked. */
  private rejectLockedNode(id: string | number): void {
    const node = this.overlay?.querySelector<HTMLElement>(`.fab-levelmap-node[data-fab-node-id="${id}"]`);
    // Only LOCKED nodes get the negative feedback. The caller gates on id !==
    // current, but gate on state too so a completed/back node (if the window
    // ever renders one) doesn't get a "wrong" buzz for a finished level.
    if (!node || !node.classList.contains('locked')) return;
    hapticWrong();
    node.classList.remove('marble-node-rejected');
    void node.offsetWidth; // restart the animation if tapped again mid-shake
    node.classList.add('marble-node-rejected');
    // Remove any prior listener first — rapid re-taps cancel the in-flight
    // animation (no animationend fires) so { once: true } never auto-cleans the
    // stale listener (same accumulation guard as triggerNavBounce).
    const prev = (node as HTMLElement & { __rejectEnd?: () => void }).__rejectEnd;
    if (prev !== undefined) node.removeEventListener('animationend', prev);
    const onEnd = (): void => { node.classList.remove('marble-node-rejected'); };
    (node as HTMLElement & { __rejectEnd?: () => void }).__rejectEnd = onEnd;
    node.addEventListener('animationend', onEnd, { once: true });
  }

  private setMapButtonsDisabled(disabled: boolean): void {
    const overlay = this.overlay;
    if (!overlay) return;
    for (const button of Array.from(overlay.querySelectorAll<HTMLButtonElement>('.fab-levelmap-node'))) {
      button.disabled = disabled;
    }
  }

  private startBannerVideoReplay(): void {
    const video = this.overlay?.querySelector<HTMLVideoElement>('.home-brand-video');
    if (!video) return;
    if (this.bannerVideoElement !== null && this.bannerVideoEndedHandler !== null) {
      this.bannerVideoElement.removeEventListener('ended', this.bannerVideoEndedHandler);
    }
    if (this.bannerVideoReplayTimer !== null) {
      window.clearTimeout(this.bannerVideoReplayTimer);
      this.bannerVideoReplayTimer = null;
    }
    this.bannerVideoElement = video;
    this.bannerVideoRetryCount = 0;

    const isCurrentVideo = (): boolean => {
      return !this.isShuttingDown && this.bannerVideoElement === video && (this.overlay?.contains(video) ?? false);
    };

    if (!shouldRunHomeBannerVideo()) {
      video.dataset.replayState = 'skipped';
      return;
    }

    const scheduleReplay = (callback: () => void, delayMs: number = BANNER_VIDEO_REPLAY_DELAY_MS): void => {
      if (!isCurrentVideo()) return;
      if (this.bannerVideoReplayTimer !== null) window.clearTimeout(this.bannerVideoReplayTimer);
      video.dataset.replayState = 'scheduled';
      this.bannerVideoReplayTimer = window.setTimeout((): void => {
        this.bannerVideoReplayTimer = null;
        if (!isCurrentVideo()) return;
        callback();
      }, delayMs);
    };

    const playOnce = (retryAttempt = false): void => {
      if (!isCurrentVideo()) return;
      if (retryAttempt) this.bannerVideoRetryCount += 1;
      video.currentTime = 0;
      video.dataset.replayState = 'playing';
      void video
        .play()
        .then((): void => {
          if (!isCurrentVideo()) return;
          this.bannerVideoRetryCount = 0;
        })
        .catch((): void => {
          if (!isCurrentVideo() || this.bannerVideoRetryCount >= BANNER_VIDEO_MAX_RETRY_ATTEMPTS) {
            video.dataset.replayState = 'blocked';
            return;
          }
          scheduleReplay(() => playOnce(true));
        });
    };

    video.loop = false;
    this.bannerVideoEndedHandler = (): void => {
      if (!isCurrentVideo()) return;
      video.pause();
      video.currentTime = 0;
      this.bannerVideoRetryCount = 0;
      scheduleReplay(() => playOnce(false));
    };
    video.addEventListener('ended', this.bannerVideoEndedHandler);

    scheduleReplay(() => playOnce(false), BANNER_VIDEO_INITIAL_DELAY_MS);
  }

  private clearBannerVideoReplay(): void {
    if (this.bannerVideoReplayTimer !== null) {
      window.clearTimeout(this.bannerVideoReplayTimer);
      this.bannerVideoReplayTimer = null;
    }

    if (this.bannerVideoElement !== null) {
      if (this.bannerVideoEndedHandler !== null) {
        this.bannerVideoElement.removeEventListener('ended', this.bannerVideoEndedHandler);
      }
      this.bannerVideoElement.pause();
      this.bannerVideoElement.dataset.replayState = 'stopped';
      for (const source of Array.from(this.bannerVideoElement.querySelectorAll<HTMLSourceElement>('source'))) {
        source.removeAttribute('src');
      }
      this.bannerVideoElement.removeAttribute('src');
      this.bannerVideoElement.load();
    }

    this.bannerVideoElement = null;
    this.bannerVideoEndedHandler = null;
    this.bannerVideoRetryCount = 0;
  }

  private contentLevelIndex(index: number): number {
    if (this.levelIndex.length === 0) return Math.max(0, index);
    return ((index % this.levelIndex.length) + this.levelIndex.length) % this.levelIndex.length;
  }

}
