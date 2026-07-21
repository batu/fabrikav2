import Phaser from 'phaser';
import { gameState } from '../core/GameState';
import { getLevelIndex, loadLevel, loadLevelForProgression, type LevelData, type LevelIndexEntry } from '../data/levels';
import { initHUD, openPage, setHomeCallback } from '../ui/HUD';
import { hideHomeMenuLayer, showHomeMenuLayer } from '../ui/OverlayVisibility';
import { hideSceneTransitionCoverAfterPaint, showPlayEntryTransitionCover } from '../ui/SceneTransitionCover';
import { adService } from '../ads/Service';
import { hapticWrong } from '../haptics/HapticsManager';
import { crossfadeTo as crossfadeAmbient, presetForLevel } from '../audio/AmbientManager';
import { mountLevelMap, type LevelMapNode, type LevelNodeState, type ThemeTokens } from '../v1core/ui';
import {
  type CancelScheduledIdleWork,
  hasLowDataConnection,
  runWhenVisibleAndIdle,
} from '../platform/browserScheduling';
import { isGameSuspended, registerLifecycleHooks } from '../platform/gameLifecycle';
import type { GameSceneData } from './GameScene';
import { GameScene } from './GameScene';
import { FTD_UI_THEME } from '../ui/ftdTheme';
import { HOME_NO_ADS_BADGE_SRC } from '../ui/iconPreload';

function triggerNavBounce(btn: HTMLButtonElement): void {
  btn.classList.remove('home-nav-btn--tapped');
  // Force reflow so the animation restarts if tapped again quickly
  void btn.offsetWidth;
  btn.classList.add('home-nav-btn--tapped');
  // Remove any prior listener before adding a new one — rapid taps cancel the in-flight
  // animation (no animationend fires) so { once: true } never auto-cleans up the old listener.
  const prev = (btn as HTMLButtonElement & { __bounceEnd?: () => void }).__bounceEnd;
  if (prev !== undefined) btn.removeEventListener('animationend', prev);
  const onEnd = (): void => { btn.classList.remove('home-nav-btn--tapped'); };
  (btn as HTMLButtonElement & { __bounceEnd?: () => void }).__bounceEnd = onEnd;
  btn.addEventListener('animationend', onEnd, { once: true });
}

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

/** FTD's level-map look as ../v1core/ui --fab-levelmap-* tokens. Only the
 *  per-game node art differs from the core defaults; sizes/offsets/colors match. */
const FTD_LEVELMAP_THEME: ThemeTokens = {
  '--fab-levelmap-art-default': "url('/ui/home/level-node-locked-runtime.png')",
  '--fab-levelmap-art-locked': "url('/ui/home/level-node-locked-bones-runtime.png')",
  '--fab-levelmap-art-completed': "url('/ui/home/level-node-complete-runtime.png')",
  '--fab-levelmap-art-current': "url('/ui/home/node-current-candy.png')",
  // Layout overrides MUST go through the theme (applied on `.fab-ui`): the core
  // declares these tokens on `.fab-ui`, so a CSS override on a wrapping element
  // is shadowed. `--fab-levelmap-node-gap` is the tile-spacing knob — raise it to
  // push the upper tiles up toward the banner (current tile stays anchored by the
  // stage's padding-bottom). Opacity forced to 1 → no depth fade, solid tiles.
  '--fab-levelmap-node-gap': '46px',
  '--fab-levelmap-far-opacity': '1',
  '--fab-levelmap-distant-opacity': '1',
  '--fab-levelmap-dot-color': '#5b5652',
  '--fab-levelmap-locked-dot-color': '#5b5652',
};

export class HomeScene extends Phaser.Scene {
  private overlay: HTMLElement | null = null;
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
      this.cancelScheduledHomeAmbient();
      this.cancelScheduledPrewarm();
      // Abort any in-flight warm so it can't mutate shared textures after the
      // next scene's loader takes over.
      if (this.prewarm !== null) this.prewarm.token.stale = true;
      this.clearBannerVideoReplay();
      this.unregisterLifecycleHooks?.();
      this.unregisterLifecycleHooks = null;
      setHomeCallback(null);
      hideHomeMenuLayer(overlay);
      if (overlay.querySelector('#home-shell')) overlay.innerHTML = '';
      this.overlay = null;
    });
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
    overlay.innerHTML = this.renderHome();
    showHomeMenuLayer(overlay);
    this.startBannerVideoReplay();

    overlay.querySelector<HTMLButtonElement>('#home-nav-settings')?.addEventListener('click', (e) => {
      if (document.getElementById('home-page-overlay')) return;
      triggerNavBounce(e.currentTarget as HTMLButtonElement);
      openPage('settings');
    });

    overlay.querySelector<HTMLButtonElement>('#home-nav-shop')?.addEventListener('click', (e) => {
      if (document.getElementById('home-page-overlay')) return;
      triggerNavBounce(e.currentTarget as HTMLButtonElement);
      openPage('shop');
    });

    overlay.querySelector<HTMLButtonElement>('#home-achievements')?.addEventListener('click', (e) => {
      if (document.getElementById('home-page-overlay')) return;
      triggerNavBounce(e.currentTarget as HTMLButtonElement);
      openPage('achievements');
    });

    // Currency "+" pills and the No-Ads button route into the shop — each deep-
    // links to its own section (coins / hints / entitlements).
    const shopShortcuts: Array<[string, 'coins' | 'hints' | 'entitlements']> = [
      ['#home-coin-plus', 'coins'],
      ['#home-hint-plus', 'hints'],
      ['#home-no-ads', 'entitlements'],
    ];
    for (const [id, scrollTo] of shopShortcuts) {
      overlay.querySelector<HTMLButtonElement>(id)?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (document.getElementById('home-page-overlay')) return;
        triggerNavBounce(e.currentTarget as HTMLButtonElement);
        openPage('shop', { scrollTo });
      });
    }

    const startCurrentLevel = (button: HTMLButtonElement): void => {
      if (document.getElementById('home-page-overlay')) return;
      triggerNavBounce(button);
      void this.startLevelFromMap(gameState.currentLevelIndex);
    };

    overlay.querySelector<HTMLButtonElement>('#home-play-now')?.addEventListener('click', (e) => {
      startCurrentLevel(e.currentTarget as HTMLButtonElement);
    });

    overlay.querySelector<HTMLButtonElement>('#home-nav-play')?.addEventListener('click', (e) => {
      startCurrentLevel(e.currentTarget as HTMLButtonElement);
    });

    this.mountHomeLevelMap();
  }

  /** (Re)mount just the level-map rail. Split out so the post-level-load update
   *  refreshes only the map instead of re-rendering the whole home (which would
   *  recreate the banner/pills/nav and make them visibly pop in). */
  private mountHomeLevelMap(): void {
    const mapMount = this.overlay?.querySelector<HTMLElement>('#home-map-mount');
    if (!mapMount) return;
    mapMount.replaceChildren();
    mountLevelMap({
      mountInto: mapMount,
      state: { nodes: this.buildLevelMapNodes() },
      theme: { ...FTD_UI_THEME, ...FTD_LEVELMAP_THEME },
      suppressDefaultNodeDisc: true,
      actions: {
        // Forward-only rail: only the current node is playable (preserves the
        // prior dataset.state !== 'current' gate).
        onSelectLevel: (id) => {
          const index = Number(id);
          // Compare against the SAME clamp buildLevelMapNodes uses for the
          // current node's id, so a corrupted negative currentLevelIndex still
          // lets the current node start (parity with the old state-based gate).
          if (Number.isInteger(index) && index === Math.max(0, gameState.currentLevelIndex)) {
            void this.startLevelFromMap(index);
          } else {
            // Locked level: refuse to navigate, give a shake + "wrong" haptic.
            this.rejectLockedNode(id);
          }
        },
      },
    });
  }

  private startGameScene(levelData?: LevelData): void {
    const overlay = this.overlay;
    showPlayEntryTransitionCover();
    this.cancelScheduledHomeAmbient();
    this.clearBannerVideoReplay();
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
    node.classList.remove('home-node--rejected');
    void node.offsetWidth; // restart the animation if tapped again mid-shake
    node.classList.add('home-node--rejected');
    // Remove any prior listener first — rapid re-taps cancel the in-flight
    // animation (no animationend fires) so { once: true } never auto-cleans the
    // stale listener (same accumulation guard as triggerNavBounce).
    const prev = (node as HTMLElement & { __rejectEnd?: () => void }).__rejectEnd;
    if (prev !== undefined) node.removeEventListener('animationend', prev);
    const onEnd = (): void => { node.classList.remove('home-node--rejected'); };
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

  // Use the transparent PNG everywhere. The WebM alpha path can paint an opaque
  // base layer in WebView capture paths, which breaks the banner-over-paws
  // composition the shipped home screen relies on.
  private renderBannerMedia(): string {
    return '<img class="home-brand-art" src="/ui/home/home-banner-mascot-runtime.png" alt="Find the Dog">';
  }

  private renderHome(): string {
    const wallet = gameState.walletSnapshot();
    const currentLevel = gameState.currentLevelIndex + 1;
    const bannerMedia = this.renderBannerMedia();

    return `
      <div id="home-shell" class="home-shell home-progression-shell">
        <section class="home-title-panel" aria-label="Find the Dog">
          <div class="home-brand-banner">${bannerMedia}</div>
        </section>

        <div class="home-map-region">
          <aside class="home-rail home-rail-left" aria-label="Quick actions">
            <button id="home-no-ads" class="home-side-btn home-no-ads-btn" type="button" aria-label="Remove ads">
              <img class="home-no-ads-art" src="${HOME_NO_ADS_BADGE_SRC}" alt="" aria-hidden="true">
            </button>
            <button id="home-achievements" class="home-side-btn home-achievements-btn" type="button" aria-label="Open achievements">
              <span class="home-achievements-medal" aria-hidden="true">★</span>
              <span>Achievements</span>
            </button>
          </aside>
          <section id="home-map-mount" class="home-map-stage" aria-label="Level progression"></section>
          <aside class="home-rail home-rail-right" aria-label="Currency balance">
            <div class="home-balance-pill home-coin-pill" data-economy-target="coins" aria-label="Coin balance">
              <span>${wallet.coins}</span>
              <img src="/ui/menu-icons/icon_coin.png" alt="" aria-hidden="true" data-economy-anchor="coin">
              <button id="home-coin-plus" class="home-pill-plus" type="button" aria-label="Buy more coins">+</button>
            </div>
            <div class="home-balance-pill home-hint-pill" data-economy-target="hints" aria-label="Hint balance">
              <span>${wallet.hints}</span>
              <img src="/ui/menu-icons/icon_hint_magnifier.png" alt="" aria-hidden="true" data-economy-anchor="hint">
              <button id="home-hint-plus" class="home-pill-plus" type="button" aria-label="Buy more hints">+</button>
            </div>
          </aside>
        </div>

        <div class="home-play-dock">
          <button id="home-play-now" class="home-play-btn home-play-now-btn" type="button" aria-label="Play Level ${currentLevel} Now">
            <span class="home-play-now-label">Play Now</span>
          </button>
        </div>

        <nav class="home-nav-bar" aria-label="Main navigation">
          <button id="home-nav-shop" class="home-nav-btn" type="button" aria-label="Open shop">
            <img src="/ui/menu-icons/shop-icon-runtime.png" alt="" aria-hidden="true">
            <span>Shop</span>
          </button>
          <button id="home-nav-play" class="home-nav-play-btn" type="button" aria-label="Play Level ${currentLevel}">
            <span class="home-nav-play-emblem">
              <img src="/ui/menu-icons/magnifier-runtime.png" alt="" aria-hidden="true">
            </span>
            <span>Play</span>
          </button>
          <button id="home-nav-settings" class="home-nav-btn" type="button" aria-label="Settings">
            <img src="/ui/menu-icons/settings-icon-runtime.png" alt="" aria-hidden="true">
            <span>Settings</span>
          </button>
        </nav>
      </div>
    `;
  }

  /**
   * FTD's windowing policy → the node list the core rail draws. Empty list ⇒
   * core renders its loading placeholder. The depth-fade/zig-zag/current scale
   * are the core's job now; this only decides WHICH levels and their states.
   */
  private buildLevelMapNodes(): LevelMapNode[] {
    const currentIndex = Math.max(0, gameState.currentLevelIndex);

    // First paint, before getLevelIndex() resolves: render numbered nodes
    // synchronously from the current index so the saga never flashes the core
    // rail's numberless loading placeholder ("broken saga"). Names and exact
    // end-of-sequence windowing are refined when the real index resolves and the
    // map re-mounts; mid-sequence (the common case) these seed nodes are
    // identical to the real ones (same numbers + states), so there's no pop.
    if (this.levelIndex.length === 0) {
      const offsets = Array.from({ length: 4 }, (_, index) => 4 - 1 - index);
      return offsets.map((offset): LevelMapNode => {
        const logicalIndex = currentIndex + offset;
        const state: LevelNodeState = offset === 0 ? 'current' : 'locked';
        return {
          id: logicalIndex,
          label: String(logicalIndex + 1),
          name: `Level ${logicalIndex + 1} ${state}`,
          state,
        };
      });
    }

    gameState.reconcileLevelOrder(this.levelIndex.map((entry) => entry.id));
    const visibleCount = Math.min(4, this.levelIndex.length);
    const offsets = Array.from({ length: visibleCount }, (_, index) => visibleCount - 1 - index);

    return offsets.map((offset): LevelMapNode => {
      const logicalIndex = currentIndex + offset;
      const contentIndex = this.contentLevelIndex(logicalIndex);
      const entry = this.levelIndex[contentIndex];
      const state: LevelNodeState = offset === 0 ? 'current' : 'locked';
      const levelName = entry.name || `Level ${logicalIndex + 1}`;
      return {
        id: logicalIndex,
        label: String(logicalIndex + 1),
        name: `Level ${logicalIndex + 1}: ${levelName} ${state}`,
        state,
      };
    });
  }
}
