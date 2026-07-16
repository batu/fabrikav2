import Phaser from 'phaser';
import { GAME, GAMEPLAY, TIMING } from '../core/Constants';
import { gameState } from '../core/GameState';
import { disposeLevelUrls, getLevelIndex, loadLevel, loadLevelForProgression, withDirectSelectServingAttempt } from '../data/levels';
import type { LevelData } from '../data/levels';
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
import { preloadLevelCompleteAssets, showLevelCompleteOverlay, dismissLevelCompleteOverlay } from '../ui/LevelCompleteOverlay';
import type { RatePromptHandle } from '../ui/RatePrompt';
import { showLevelFailedOverlay, type FailContinueActionContext } from '../ui/LevelFailedOverlay';
import { hidePlayEntryTransitionCoverAfterSceneRender, hideSceneTransitionCoverAfterPaint, showSceneTransitionCover } from '../ui/SceneTransitionCover';
import { remoteConfigService } from '../config/RemoteConfigService';
import { buildFailContinueOffers, type FailContinueOfferSet, type FailContinueOption } from '../shop/FailContinueOffers';
import { iapService } from '../shop/IapService';
import { buildShopCatalog } from '../shop/ProductCatalog';
import { fulfillVerifiedPurchaseOnce, makePurchaseRestoreRetry, reportUnfulfilledPurchase } from '../shop/PurchaseFulfillment';
import { hasUserActivated, runWhenVisibleAndIdle, type CancelScheduledIdleWork } from '../platform/browserScheduling';
import { registerLifecycleHooks } from '../platform/gameLifecycle';
import { advance, createGame, isThreadClear, releaseThread, type WoolCrushState } from '../game/WoolCrushEngine';
import { WOOL_CRUSH_LEVELS } from '../game/levels';

export interface GameSceneData {
  levelId?: string;
  levelData?: LevelData;
}

const FAST_E2E_UI = String(import.meta.env.VITE_FTD_FAST_E2E_UI) === 'true';
const NONCRITICAL_PRELOAD_DELAY_MS = 1_500;
const NONCRITICAL_PRELOAD_IDLE_TIMEOUT_MS = 5_000;

/**
 * SHELL-TEMPLATE STUB GAME SCENE.
 *
 * This scene is the inner-game slot of the shell template. It deliberately
 * contains NO gameplay: two buttons, WIN and LOSE, stand in for the game's
 * outcome, and everything downstream of an outcome — completion transaction,
 * coin economy, hearts, fail-continue offers, ads, analytics, overlays,
 * saga progression, next-level flow — is the real shell code, exercised
 * exactly as find_the_dog exercises it.
 *
 * The de facto Game↔Shell contract this scene implements is documented in
 * docs/seam-map.md. A real game replaces this file (and only this file's
 * gameplay parts): consume `this.level`, report outcomes through
 * `winLevel()` / `loseLife()`.
 */
export class GameScene extends Phaser.Scene {
  private level: LevelData | null = null;
  private levelComplete: boolean = false;
  private levelDataReady: boolean = false;
  private levelStartedAt: number = 0;
  private hintsUsedThisLevel: number = 0;
  private wrongTapsCount: number = 0;
  private analyticsLevelAttribution: AnalyticsLevelAttribution | null = null;
  private ratePromptHandle: RatePromptHandle | null = null;
  private preserveLevelUrlsOnShutdown: boolean = false;
  private isShuttingDown: boolean = false;
  private cancelNonCriticalPreloadSchedule: CancelScheduledIdleWork | null = null;
  private unregisterLifecycleHooks: (() => void) | null = null;
  private wasClockPausedBeforeLifecycleSuspend: boolean = false;
  private wasTweenManagerPausedBeforeLifecycleSuspend: boolean = false;
  private woolState: WoolCrushState | null = null;
  private woolRoot: Phaser.GameObjects.Container | null = null;
  private woolTick: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super('GameScene');
  }

  init(data: GameSceneData): void {
    this.level = data.levelData ?? null;
    this.levelComplete = false;
    this.levelDataReady = false;
    this.hintsUsedThisLevel = 0;
    this.wrongTapsCount = 0;
    this.analyticsLevelAttribution = null;
    this.ratePromptHandle = null;
    this.preserveLevelUrlsOnShutdown = false;
    this.isShuttingDown = false;
    this.cancelNonCriticalPreloadSchedule?.();
    this.cancelNonCriticalPreloadSchedule = null;
    this.unregisterLifecycleHooks?.();
    this.unregisterLifecycleHooks = null;
    this.wasClockPausedBeforeLifecycleSuspend = false;
    this.wasTweenManagerPausedBeforeLifecycleSuspend = false;
    gameState.reset();
  }

  /**
   * Shell seam kept for HomeScene's Play-tap warm path. The stub renders no
   * level textures, so there is nothing to warm; a real game restores the
   * decode-ahead behavior here (see find_the_dog's implementation).
   */
  static async prewarmLevel(
    _textures: Phaser.Textures.TextureManager,
    _level: LevelData,
    _isStale: () => boolean,
  ): Promise<void> {
    // Intentionally empty in the stub.
  }

  create(): void {
    if (!this.level) {
      showSceneTransitionCover();
      void this.loadLevelAndRestart();
      return;
    }
    this.setupWoolGame();
    this.scheduleNonCriticalPreloads();
  }

  // ── level loading (shell seam, verbatim from find_the_dog) ──────────────

  private static loadGen: number = 0;

  private async loadLevelAndRestart(): Promise<void> {
    GameScene.loadGen += 1;
    const myGen = GameScene.loadGen;
    try {
      const index = await getLevelIndex();
      if (myGen !== GameScene.loadGen) return;
      if (index.length === 0) {
        console.error('No levels available');
        hideSceneTransitionCoverAfterPaint();
        return;
      }
      gameState.reconcileLevelOrder(index.map((entry) => entry.id));
      const levelData = await loadLevelForProgression(gameState.currentLevelIndex);
      if (myGen !== GameScene.loadGen) {
        disposeLevelUrls(levelData.id);
        return;
      }
      this.scene.restart({ levelData } as GameSceneData);
    } catch (error) {
      console.error('Failed to load level', error);
      hideSceneTransitionCoverAfterPaint();
    }
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

  // ── Wool Crush game scene ────────────────────────────────────────────────

  private setupWoolGame(): void {
    if (!this.level) return;
    const level = this.level;

    if (gameState.settings.adsEnabled) {
      void adService.showBanner().then((shown: boolean): void => {
        if (shown && this.level) {
          void analytics.adShown({ ad_type: 'banner', placement: 'gameplay' });
        }
      });
    }

    this.cameras.main.setBounds(0, 0, GAME.WIDTH, GAME.HEIGHT);
    this.startWoolAttempt();

    setHintCallback(() => this.onHintRequested());
    setDebugOverlayCallback(() => { /* stub has no debug overlay */ });
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

    this.levelStartedAt = Date.now();
    void this.trackLevelStart();
    updateHUD(level.dogs.length, false);
    this.levelDataReady = true;

    hidePlayEntryTransitionCoverAfterSceneRender(this);
    this.registerLifecycleSuspendHooks();

    this.events.once('shutdown', () => {
      this.isShuttingDown = true;
      this.cancelNonCriticalPreloadSchedule?.();
      this.cancelNonCriticalPreloadSchedule = null;
      this.unregisterLifecycleHooks?.();
      this.unregisterLifecycleHooks = null;
      if (this.level !== null && !this.preserveLevelUrlsOnShutdown) disposeLevelUrls(this.level.id);
      setGameModeChangeCallback(null);
      this.ratePromptHandle?.dismiss();
      this.ratePromptHandle = null;
      this.tweens.killAll();
      this.woolTick?.destroy();
      this.woolTick = null;
      this.woolRoot?.destroy(true);
      this.woolRoot = null;
      dismissLevelCompleteOverlay();
      document.getElementById('rate-prompt-overlay')?.remove();
      document.getElementById('hud-overlay')?.classList.remove('completion-mode');
      document.getElementById('level-complete-overlay')?.remove();
      document.getElementById('level-failed-overlay')?.remove();
    });
  }

  private startWoolAttempt(): void {
    const level = WOOL_CRUSH_LEVELS[gameState.currentLevelIndex % WOOL_CRUSH_LEVELS.length];
    this.woolState = createGame(level);
    this.woolTick?.destroy();
    this.woolTick = this.time.addEvent({ delay: 560, loop: true, callback: () => this.advanceWool() });
    this.renderWool();
  }

  private advanceWool(): void {
    if (!this.woolState || this.levelComplete || this.isShuttingDown) return;
    this.woolState = advance(this.woolState);
    this.renderWool();
    if (this.woolState.status === 'won') this.winLevel();
    if (this.woolState.status === 'failed') this.loseLife();
  }

  private releaseWoolThread(threadId: string): void {
    if (!this.woolState || this.levelComplete) return;
    const result = releaseThread(this.woolState, threadId);
    if (!result.ok) {
      this.wrongTapsCount += 1;
      hapticWrong();
      this.cameras.main.shake(100, 0.0025);
      return;
    }
    this.woolState = result.state;
    hapticFound();
    this.renderWool();
  }

  private renderWool(): void {
    const state = this.woolState;
    if (!state) return;
    this.woolRoot?.destroy(true);
    const root = this.add.container(0, 0).setDepth(2);
    this.woolRoot = root;
    const sx = GAME.WIDTH / 1170;
    const sy = GAME.HEIGHT / 2532;
    const font = 'Fredoka One, sans-serif';
    const colorHex: Record<string, number> = {
      red: 0xef665f, coral: 0xf47d66, blue: 0x51a8e5, sky: 0x69c9ee,
      green: 0x75b95d, mint: 0x55c8a4, gold: 0xf2b93c, purple: 0x8d68b6, lilac: 0xa987cc,
    };
    const yarnColor = (color: string): number => colorHex[color] ?? 0xd29e38;

    const bg = this.add.graphics().fillStyle(0xf4e6c8, 1).fillRoundedRect(0, 0, GAME.WIDTH, GAME.HEIGHT, 36 * sx);
    root.add(bg);
    root.add(this.add.text(585 * sx, 118 * sy, `LEVEL ${gameState.currentLevelIndex + 1}`, {
      fontFamily: font, fontSize: `${54 * sx}px`, color: '#40364a', stroke: '#fff7dc', strokeThickness: 8 * sx,
    }).setOrigin(0.5));
    root.add(this.add.text(585 * sx, 190 * sy, 'Save the kitten — free the right yarn!', {
      fontFamily: font, fontSize: `${31 * sx}px`, color: '#735b79',
    }).setOrigin(0.5));

    const track = this.add.graphics().lineStyle(46 * sx, 0x9d7a67, 1).beginPath();
    const trackPoints = [
      [95, 330], [965, 330], [1040, 470], [180, 580], [120, 730], [930, 830], [1015, 985], [250, 1100],
    ] as const;
    track.moveTo(trackPoints[0][0] * sx, trackPoints[0][1] * sy);
    for (let i = 1; i < trackPoints.length; i += 1) track.lineTo(trackPoints[i][0] * sx, trackPoints[i][1] * sy);
    track.strokePath();
    root.add(track);
    root.add(this.add.text(164 * sx, 1092 * sy, '🐱', { fontSize: `${98 * sx}px` }).setOrigin(0.5));

    const dragonStartX = 260 + (1 - state.headDistance / state.level.catDistance) * 640;
    state.dragon.slice(0, 11).forEach((color, index) => {
      const x = (dragonStartX - index * 58) * sx;
      const y = (985 - Math.sin(index * 0.72) * 30) * sy;
      const section = this.add.circle(x, y, 34 * sx, yarnColor(color)).setStrokeStyle(8 * sx, 0xffffff, 0.42);
      root.add(section);
    });
    if (state.dragon.length > 0) root.add(this.add.text(dragonStartX * sx, 920 * sy, '🐉', { fontSize: `${82 * sx}px` }).setOrigin(0.5));

    root.add(this.add.text(585 * sx, 1205 * sy, 'YOUR SPOOLS', { fontFamily: font, fontSize: `${34 * sx}px`, color: '#40364a' }).setOrigin(0.5));
    state.spools.forEach((spool, slot) => {
      const x = (245 + slot * 225) * sx;
      const slotBg = this.add.circle(x, 1320 * sy, 74 * sx, spool ? yarnColor(spool.color) : 0xd8c9ad, spool ? 1 : 0.55)
        .setStrokeStyle(10 * sx, 0xffffff, 0.72);
      root.add(slotBg);
      root.add(this.add.text(x, 1320 * sy, spool ? `${spool.remaining}` : '+', {
        fontFamily: font, fontSize: `${48 * sx}px`, color: spool ? '#ffffff' : '#9a876d',
      }).setOrigin(0.5));
    });

    const cellSize = Math.min(142 * sx, 130 * sy);
    const boardTop = 1510 * sy;
    const boardLeft = (GAME.WIDTH - state.level.width * cellSize) / 2;
    const board = this.add.graphics().fillStyle(0xead8b4, 0.8)
      .fillRoundedRect(boardLeft - 30 * sx, boardTop - 35 * sy, state.level.width * cellSize + 60 * sx, state.level.height * cellSize + 70 * sy, 38 * sx);
    root.add(board);
    state.threads.forEach((thread) => {
      const clear = isThreadClear(state, thread.id) && state.spools.some((spool) => spool === null);
      const minX = Math.min(...thread.cells.map((cell) => cell.x));
      const maxX = Math.max(...thread.cells.map((cell) => cell.x));
      const minY = Math.min(...thread.cells.map((cell) => cell.y));
      const maxY = Math.max(...thread.cells.map((cell) => cell.y));
      const x = boardLeft + minX * cellSize + cellSize * 0.12;
      const y = boardTop + minY * cellSize + cellSize * 0.24;
      const width = (maxX - minX + 1) * cellSize - cellSize * 0.24;
      const height = (maxY - minY + 1) * cellSize - cellSize * 0.48;
      const strand = this.add.rectangle(x + width / 2, y + height / 2, width, Math.max(height, 46 * sx), yarnColor(thread.color))
        .setStrokeStyle(8 * sx, 0xffffff, clear ? 0.72 : 0.28)
        .setInteractive({ useHandCursor: true });
      strand.on('pointerdown', () => this.releaseWoolThread(thread.id));
      root.add(strand);
      const arrow = thread.exit.x > 0 ? '›' : thread.exit.x < 0 ? '‹' : thread.exit.y > 0 ? '⌄' : '⌃';
      root.add(this.add.text(x + width / 2, y + height / 2, arrow, {
        fontFamily: font, fontSize: `${50 * sx}px`, color: '#ffffff',
      }).setOrigin(0.5));
    });
  }

  // ── outcome seam: WIN ─────────────────────────────────────────────────────

  /** Report the level as won. Runs find_the_dog's full completion sequence. */
  winLevel(): void {
    if (!this.level || this.levelComplete || this.isShuttingDown) return;
    this.levelComplete = true;
    hapticFound();
    const timeSeconds = Math.round((Date.now() - this.levelStartedAt) / 1000);
    void this.trackLevelComplete(timeSeconds);

    const servingAttempt = this.level.servingAttempt;
    const completion = gameState.beginLevelCompletionTransaction({
      levelId: this.level.id,
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
        level_id: this.level.id,
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
          level_id: this.level.id,
          transaction_id: completion.transaction.id,
        });
      }
    }
    updateHUD(this.level.dogs.length, false);

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
            updateHUD(this.level!.dogs.length, false);
            void analytics.settingsChanged({ setting_name: 'claimX2', new_value: 'granted' });
          }
          return { granted: claim.granted, coinBalance: gameState.coinBalance };
        },
        onRatePromptHandle: (handle) => {
          this.ratePromptHandle = handle;
        },
      });

      void overlayPromise.then((overlayResult) => {
        if (this.isShuttingDown || !this.sys.isActive()) return;

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
          void adService
            .maybeShowInterstitial({ minIntervalMs: remoteConfigService.value('interstitialMinIntervalS') * 1000 })
            .then((shown: boolean): void => {
              if (shown) {
                void analytics.adShown({ ad_type: 'interstitial', placement: 'between_levels' });
              }
            })
            .finally(restartToNextLevel);
        } else {
          restartToNextLevel();
        }
      });
    });
  }

  // ── outcome seam: LOSE ────────────────────────────────────────────────────

  /**
   * Report a failed attempt: lose one life (heart pip animates); when the
   * last life goes, the fail overlay + fail-continue offers take over.
   * Mirrors find_the_dog's wrong-tap consequence path.
   */
  loseLife(): void {
    if (!this.level || this.levelComplete || this.isShuttingDown) return;
    const now = Date.now();
    if (now < gameState.penaltyCooldownUntil) return;

    gameState.lives--;
    gameState.penaltyCooldownUntil = now + TIMING.PENALTY_COOLDOWN_MS;
    this.wrongTapsCount += 1;
    hapticWrong();
    updateHUD(this.level.dogs.length, false);
    // Must follow updateHUD(): animateLifeLost() indexes into the heart pips
    // updateHUD just rebuilt.
    animateLifeLost();

    if (gameState.lives > 0) return;

    void this.trackLevelFailed(gameState.foundDogIds.size);
    this.levelComplete = true;
    showLevelFailedOverlay(this.level.id, {
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
    const purchase = await iapService.purchase(option.productId);
    if (purchase.status !== 'purchased') {
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
      if (this.level) updateHUD(this.level.dogs.length, false);
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
    this.startWoolAttempt();
    updateHUD(this.level.dogs.length, false);
    return true;
  }

  // ── hints (shell system; game-side consume is a stub) ────────────────────

  private onHintRequested(): void {
    if (!this.level || gameState.hintsRemaining <= 0) return;
    if (!gameState.spendHint('gameplayHint')) return;
    this.hintsUsedThisLevel += 1;
    hapticFound();
    updateHUD(this.level.dogs.length, false);
    void analytics.hintUsed({ level_id: this.level.id, dogs_found: gameState.foundDogIds.size });
  }

  // ── analytics ─────────────────────────────────────────────────────────────

  private async trackLevelStart(): Promise<void> {
    if (!this.level) return;
    const levelAttribution = this.resolveCurrentLevelAnalyticsAttribution(this.level);
    await analytics.levelStart({
      level_id: this.level.id,
      level_name: this.level.name,
      ...(levelAttribution ?? {}),
    });
  }

  private async trackLevelComplete(timeSeconds: number): Promise<void> {
    if (!this.level) return;
    const levelAttribution = this.resolveCurrentLevelAnalyticsAttribution(this.level);
    await analytics.levelComplete({
      level_id: this.level.id,
      time_seconds: timeSeconds,
      hints_used: this.hintsUsedThisLevel,
      wrong_taps: this.wrongTapsCount,
      ...(levelAttribution ?? {}),
    });
  }

  private async trackLevelFailed(dogsFound: number): Promise<void> {
    if (!this.level) return;
    const levelAttribution = this.resolveCurrentLevelAnalyticsAttribution(this.level);
    await analytics.levelFailed({
      level_id: this.level.id,
      dogs_found: dogsFound,
      ...(levelAttribution ?? {}),
    });
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

  // ── lifecycle plumbing (shell seam, verbatim from find_the_dog) ──────────

  private scheduleNonCriticalPreloads(): void {
    const run = (): void => {
      if (this.isShuttingDown || !this.sys.isActive()) return;
      void preloadLevelCompleteAssets();
      void hasUserActivated();
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

  private registerLifecycleSuspendHooks(): void {
    this.unregisterLifecycleHooks?.();
    this.unregisterLifecycleHooks = registerLifecycleHooks('game-scene', {
      onSuspend: (): void => {
        if (this.isShuttingDown || !this.sys.isActive()) return;
        this.cancelNonCriticalPreloadSchedule?.();
        this.cancelNonCriticalPreloadSchedule = null;
        this.wasClockPausedBeforeLifecycleSuspend = this.time.paused;
        this.wasTweenManagerPausedBeforeLifecycleSuspend = this.tweens.paused;
        this.time.paused = true;
        this.tweens.pauseAll();
      },
      onResume: (): void => {
        if (this.isShuttingDown || !this.sys.isActive()) return;
        if (!this.wasClockPausedBeforeLifecycleSuspend) this.time.paused = false;
        if (!this.wasTweenManagerPausedBeforeLifecycleSuspend) this.tweens.resumeAll();
        this.wasClockPausedBeforeLifecycleSuspend = false;
        this.wasTweenManagerPausedBeforeLifecycleSuspend = false;
      },
    });
  }

  // ── harness probes ────────────────────────────────────────────────────────

  getLevel(): LevelData | null {
    return this.level;
  }

  isLevelComplete(): boolean {
    return this.levelComplete;
  }

  isLevelDataReady(): boolean {
    return this.levelDataReady;
  }
}
