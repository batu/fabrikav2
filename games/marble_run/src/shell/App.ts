/**
 * Shell orchestrator (AUDITED — literal-free: copy from design/copy, asset urls
 * from design/theme, colours from the global --fab-* tokens). Replaces v1's
 * bespoke App+dom screen layer: it drives the game's Menu / LevelSelect /
 * Playing / Paused / Complete / Failed lifecycle through the kernel flow machine
 * and composes the @fabrikav2/ui screens from those states. The Three.js
 * gameplay + in-game HUD live in ../game/GameController (free canvas); this
 * shell never reaches into the renderer, only starts/stops levels and reacts to
 * win/fail/pause hooks.
 *
 * Flow-machine adoption (conductor decision, integration review finding 6):
 * marble_run is the first production consumer of @fabrikav2/kernel/flow. The
 * two optional states (levelSelect, paused) are opted in; menu/play/complete/
 * fail screen changes are driven off the machine's typed events, and pause/
 * resume off the guarded transitions. See SURPRISES for the impedance points.
 */
import {
  createFlowMachine,
  type FlowMachine,
} from '@fabrikav2/kernel';
import {
  mountHomeMenu,
  mountResultCard,
  mountPauseOverlay,
  mountModalShell,
  mountToggleRows,
  buildSettingsModel,
  mountToaster,
  mountConnectivityIndicator,
  mountShopPage,
  createPageStack,
  animateEconomyTransfer,
  prefersReducedMotion,
  type UiHandle,
  type ToasterHandle,
  type PageStack,
  type SettingKey,
} from '@fabrikav2/ui';
import {
  captureCanvasPng,
  createPerfRecorder,
  type PerfRecorder,
  type GameHarness,
  type GameVerbHandler,
  type ClientPoint,
  type CaptureResult,
  type PerfSample,
  type AnalyticsEventLike,
  type HarnessSaveProfile,
} from '@fabrikav2/testkit/harness';
import type { RingBufferSink } from '@fabrikav2/sdk/analytics';
import type { GameSdk } from '../sdk/SdkContext';
import type { MarbleGrant } from '../sdk/catalog';
import { copy } from '../../design/copy';
import { assetUrls } from '../../design/theme';
import { buildSagaNodes, MENU_SAGA_WINDOW } from './saga';
import { GameController, type GameHooks } from '../game/GameController';
import { saveState } from '../core/SaveState';
import { LEVEL_COUNT, LEVEL_COIN_REWARD, TEST_HARNESS_ENABLED } from '../core/Constants';
import { music } from '../audio/Music';
import { toggleClick } from '../audio/Sfx';
import { pickByRoll, blockedMarbles } from './marbleVerbs';
import { driveAutoWin, driveAutoFail } from '../testing/autoPlay';
import { driveTo as driveToState } from '../testing/driveTo';
import type { Cell } from '../engine/types';

/** The marble_run extra-verb union — the `GameHarness` extension point. */
export type MarbleVerb = 'tapCell' | 'tapUnlockedMarble' | 'tapBlockedMarble';

/**
 * marble_run's concrete harness: the portfolio {@link GameHarness} contract plus
 * the organic legacy verbs the existing specs (`play.spec.ts`,
 * `menu-clicks.spec.ts`) still read, kept additively so adopting the contract
 * regresses nothing.
 */
export interface MarbleHarness extends GameHarness<MarbleVerb> {
  /** @deprecated legacy no-arg menu jump — prefer `gotoState('HomeMenu')`. */
  gotoMenu(): void;
  showHint(): void;
  cellClientPoint(x: number, y: number): ClientPoint | null;
  setAnimationSpeed(multiplier: number): void;
  solveStep(): Cell | null;
  /** Deterministic solver-bound win: replays solveLevel().order. Resolves true if won. */
  autoWin(stepMs?: number): Promise<boolean>;
  /** Deterministic loss: taps genuinely-blocked marbles until hearts deplete. Resolves true if failed. */
  autoFail(stepMs?: number): Promise<boolean>;
  /** Deterministically navigate to a canonical capture state, confirming arrival
   *  via snapshot() before resolving (fidelity-diff ledger C5). */
  driveTo(state: string): Promise<boolean>;
}

export interface AppMounts {
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  uiRoot: HTMLElement;
}

interface PendingWin {
  levelId: number;
  reward: number;
  isFinalLevel: boolean;
}

export class App {
  private readonly machine: FlowMachine;
  private readonly controller: GameController;
  private readonly sdk: GameSdk;
  private readonly uiRoot: HTMLElement;
  private readonly pageStack: PageStack;
  private readonly toaster: ToasterHandle;
  /** The single mounted lifecycle screen (menu / saga / result / pause). */
  private screenHandle: UiHandle | null = null;
  private pendingWin: PendingWin | null = null;
  /** The level currently in play — used to tag fail analytics. */
  private currentLevelId = 0;
  /** Canvas root — the `capture()` witness rasterises this (browser path). */
  private readonly canvas: HTMLCanvasElement;
  /** Test-only analytics buffer behind `drainEvents()`; null outside harness. */
  private readonly harnessSink: RingBufferSink | null;
  /** Test-only frame-time recorder behind `perf()`; self-driven via rAF. */
  private readonly perfRecorder: PerfRecorder = createPerfRecorder();

  constructor(mounts: AppMounts, sdk: GameSdk, harnessSink: RingBufferSink | null = null) {
    this.uiRoot = mounts.uiRoot;
    this.sdk = sdk;
    this.canvas = mounts.canvas;
    this.harnessSink = harnessSink;

    const hooks: GameHooks = {
      onWin: (info) => this.handleWin(info),
      onFail: (info) => this.handleFail(info),
      onPauseRequested: () => this.pauseGame(),
      requestFailSave: () => this.requestFailSave(),
      requestRewardedHint: () => this.sdk.tryRewardedHint(),
      onCoinsSpent: (amount, reason) => this.sdk.recordSpend(amount, reason, saveState.coins),
    };
    this.controller = new GameController(mounts.canvas, mounts.hudRoot, hooks);

    this.machine = createFlowMachine({ optionalStates: ['levelSelect', 'paused'] });
    this.pageStack = createPageStack();
    this.toaster = mountToaster({ mountInto: this.uiRoot });

    mountConnectivityIndicator({
      mountInto: this.uiRoot,
      onlineCopy: copy['connectivity.online'],
      offlineCopy: copy['connectivity.offline'],
      onToast: (message) => this.toaster.show(message),
    });

    // Screen changes ride the machine's typed events (not a generic subscribe —
    // the machine exposes none; pause/resume have no event and are handled in
    // the transition methods below).
    this.machine.events.on('menu:enter', () => this.renderMenu());
    this.machine.events.on('level:start', (payload) =>
      this.enterLevel(Number(payload.levelId)),
    );
    this.machine.events.on('level:complete', () => this.renderComplete());
    this.machine.events.on('level:fail', () => this.renderFailed());

    // Feed the perf witness real frame times — a test-only rAF loop, so it never
    // runs in a production build (no gameplay-loop edit, no shipped cost).
    if (TEST_HARNESS_ENABLED) this.startPerfLoop();
  }

  /** Boot into the menu. */
  start(): void {
    this.toMenu();
  }

  /** Sample frame deltas into {@link perfRecorder} for the `perf()` witness.
   *  rAF-driven and self-perpetuating; only started when the harness is enabled. */
  private startPerfLoop(): void {
    if (typeof requestAnimationFrame !== 'function') return;
    let last = performance.now();
    const tick = (): void => {
      const now = performance.now();
      this.perfRecorder.record(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ── State entry (event-driven) ──────────────────────────────────

  private renderMenu(): void {
    this.clearScreen();
    this.controller.stopLevel();
    this.controller.showMenuScene();
    music.start();
    this.mountMenu();
  }

  private enterLevel(levelId: number): void {
    this.clearScreen();
    music.stop();
    this.currentLevelId = levelId;
    this.sdk.levelStart(levelId);
    this.controller.setInputBlocked(false);
    this.controller.startLevel(levelId);
  }

  private renderComplete(): void {
    const info = this.pendingWin;
    if (!info) return;
    this.pendingWin = null;
    saveState.recordWin(info.levelId, info.reward);
    this.sdk.levelComplete(info.levelId, info.reward, saveState.coins);
    this.controller.refreshHudCoins();
    this.controller.setInputBlocked(true);
    this.controller.setResultHudMode('win');
    this.clearScreen();
    if (info.isFinalLevel) {
      this.mountFinale();
    } else {
      this.mountWin(info);
    }
    // Interstitial cadence (remote-config driven, suppressed by no-ads).
    void this.sdk.maybeShowInterstitialAfterLevel(info.levelId);
  }

  private renderFailed(): void {
    this.sdk.levelFail(this.currentLevelId);
    this.controller.setInputBlocked(true);
    this.controller.setResultHudMode('lose');
    this.clearScreen();
    this.mountLose();
  }

  // ── Screen builders ─────────────────────────────────────────────

  private mountMenu(): void {
    const nodes = buildSagaNodes(saveState.unlocked, MENU_SAGA_WINDOW);
    const level = saveState.currentLevel();
    this.screenHandle = mountHomeMenu({
      mountInto: this.uiRoot,
      header: this.buildMenuHeader(),
      saga: {
        state: { nodes },
        actions: { onSelectLevel: (id) => this.onSagaSelect(Number(id)) },
        loadingLabel: copy['saga.loading'],
      },
      // Reference menu is a SINGLE chunky green "Level N" CTA (no Play/Levels/
      // Shop/Settings stack — those live in the top-bar chrome). Matches v1
      // dom.ts showMenu (`Level ${currentLevel()}`).
      actions: [
        {
          label: `${copy['menu.levelButton']} ${level}`,
          onClick: () => this.startCurrentLevel(),
          variant: 'primary',
          className: 'mr-level-cta',
          dataAction: 'play',
        },
      ],
    });
  }

  /** Menu top-bar chrome: coin pill (left) + gear (right), teal candy panels.
   *  Built as shell DOM with `--fab-*` tokens (game-local `.mr-topbar-*` layout
   *  in index.html), mirroring how the banner is composed. */
  private buildTopBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'mr-topbar';

    const coin = document.createElement('button');
    coin.type = 'button';
    coin.className = 'mr-coin-pill';
    coin.dataset.fabAction = 'shop';
    coin.setAttribute('aria-label', copy['menu.shop']);
    const coinIcon = document.createElement('img');
    coinIcon.className = 'mr-coin-pill-icon';
    coinIcon.src = assetUrls.coin;
    coinIcon.alt = '';
    coinIcon.setAttribute('aria-hidden', 'true');
    const coinValue = document.createElement('span');
    coinValue.className = 'mr-coin-pill-value';
    coinValue.setAttribute('data-fab-economy-target', 'coin');
    coinValue.textContent = String(saveState.coins);
    coin.append(coinIcon, coinValue);
    coin.addEventListener('click', () => {
      toggleClick(true);
      this.openShop();
    });

    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'mr-gear';
    gear.dataset.fabAction = 'settings';
    gear.setAttribute('aria-label', copy['menu.settings']);
    const gearIcon = document.createElement('img');
    gearIcon.className = 'mr-gear-icon';
    gearIcon.src = assetUrls.gear;
    gearIcon.alt = '';
    gearIcon.setAttribute('aria-hidden', 'true');
    gear.appendChild(gearIcon);
    gear.addEventListener('click', () => {
      toggleClick(true);
      this.openSettings(false);
    });

    bar.append(coin, gear);
    return bar;
  }

  private buildMenuHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'mr-menu-header';
    // Ambient confetti is a fixed-position child, so it covers the viewport yet
    // is torn down with the menu (menu-only per the card). Positions/timing are
    // index-derived (deterministic); colors come from the confetti tokens.
    header.append(this.buildConfetti(), this.buildTopBar(), this.buildBanner());
    return header;
  }

  private buildConfetti(): HTMLElement {
    const layer = document.createElement('div');
    layer.className = 'mr-confetti';
    layer.setAttribute('aria-hidden', 'true');
    const palette = [
      'var(--fab-color-confetti-a)',
      'var(--fab-color-confetti-b)',
      'var(--fab-color-confetti-c)',
      'var(--fab-color-confetti-d)',
    ];
    const count = prefersReducedMotion() ? 0 : 16;
    for (let i = 0; i < count; i += 1) {
      const fleck = document.createElement('span');
      fleck.className = 'mr-confetti-fleck';
      fleck.style.left = `${(i * 61) % 100}%`;
      fleck.style.background = palette[i % palette.length]!;
      fleck.style.animationDuration = `${5 + (i % 5)}s`;
      fleck.style.animationDelay = `${-(i * 0.7).toFixed(2)}s`;
      layer.appendChild(fleck);
    }
    return layer;
  }

  private openShop(): void {
    this.pageStack.push(() =>
      mountShopPage<MarbleGrant>({
        mountInto: this.uiRoot,
        iap: this.sdk.iap,
        sections: [
          { group: 'entitlements', layout: 'featured' },
          { group: 'coins', layout: 'grid', title: copy['shop.coins'] },
        ],
        copy: {
          purchase: {
            pending: copy['shop.purchase.pending'],
            busy: copy['shop.purchase.busy'],
            unavailable: copy['shop.purchase.unavailable'],
          },
          restore: {
            title: copy['shop.restore.title'],
            status: {
              idle: copy['shop.restore.status.idle'],
              initializing: copy['shop.restore.status.initializing'],
              busy: copy['shop.restore.status.busy'],
              unavailable: copy['shop.restore.status.unavailable'],
              pending: copy['shop.restore.status.pending'],
              restored: copy['shop.restore.status.restored'],
              empty: copy['shop.restore.status.empty'],
              failed: copy['shop.restore.status.failed'],
            },
            button: {
              rest: copy['shop.restore.button.rest'],
              pending: copy['shop.restore.button.pending'],
              restored: copy['shop.restore.button.restored'],
            },
          },
        },
        badges: { popular: copy['shop.badge.popular'] },
        onPurchase: (result) => {
          this.sdk.applyPurchaseResult(result);
          if (result.status === 'purchased') this.controller.refreshHudCoins();
        },
        onRestore: (result) => this.sdk.applyRestoreResult(result),
      }),
    );
  }

  private mountWin(info: PendingWin): void {
    const actions = this.buildResultActions([
      {
        label: copy['result.win.next'],
        image: assetUrls.buttonPrimary,
        className: 'mr-result-cta mr-result-cta--green',
        dataAction: 'result-next',
        onClick: () => this.next(info.levelId),
      },
    ]);
    const reward = this.buildRewardDisplay(info.reward);
    this.screenHandle = mountResultCard({
      mountInto: this.uiRoot,
      variant: 'win',
      title: copy['result.win.title'],
      eyebrow: this.resultLevelEyebrow(info.levelId),
      ribbonImage: assetUrls.ribbonCompleted,
      cardImage: assetUrls.popup,
      backplateImage: assetUrls.modalBackplate,
      backplateClassName: 'mr-modal-board mr-modal-board--result',
      art: this.buildWinCrown(),
      rewardDisplay: reward.el,
      actions,
    });
    void this.flyCoins(info.reward, reward.source);
  }

  private mountFinale(): void {
    const actions = this.buildResultActions([
      {
        label: copy['result.finale.action'],
        image: assetUrls.buttonPrimary,
        className: 'mr-result-cta mr-result-cta--green',
        dataAction: 'result-menu',
        onClick: () => this.toMenu(),
      },
    ]);
    this.screenHandle = mountResultCard({
      mountInto: this.uiRoot,
      variant: 'win',
      title: copy['result.finale.title'],
      ribbonImage: assetUrls.ribbonCompleted,
      cardImage: assetUrls.popup,
      backplateImage: assetUrls.modalBackplate,
      backplateClassName: 'mr-modal-board mr-modal-board--result',
      art: this.buildWinCrown(),
      messages: copy['result.finale.message'],
      actions,
    });
  }

  private mountLose(): void {
    const actions = this.buildResultActions([
      {
        label: copy['result.lose.watchAd'],
        image: assetUrls.buttonPrimary,
        className: 'mr-result-cta mr-result-cta--green',
        dataAction: 'result-next',
        onClick: () => void this.requestFailSave(),
      },
      {
        label: copy['result.lose.retry'],
        image: assetUrls.buttonSecondary,
        className: 'mr-result-cta mr-result-cta--orange',
        dataAction: 'result-retry',
        onClick: () => this.retry(),
      },
    ]);
    this.screenHandle = mountResultCard({
      mountInto: this.uiRoot,
      variant: 'lose',
      title: copy['result.lose.title'],
      eyebrow: this.resultLevelEyebrow(this.currentLevelId),
      ribbonImage: assetUrls.ribbonFailed,
      cardImage: assetUrls.popup,
      backplateImage: assetUrls.modalBackplate,
      backplateClassName: 'mr-modal-board mr-modal-board--result',
      art: this.buildFailEmoji(),
      messages: copy['result.lose.message'],
      actions,
    });
  }

  private mountPause(): void {
    this.screenHandle = mountPauseOverlay({
      mountInto: this.uiRoot,
      actions: {
        onResume: () => this.resumeGame(),
        onSettings: () => this.openSettings(true),
        onQuit: () => this.toMenu(),
      },
      labels: {
        title: copy['pause.title'],
        resume: copy['pause.resume'],
        settings: copy['pause.settings'],
        quit: copy['pause.quit'],
      },
    });
  }

  /**
   * Settings surface. The Android references are two variants over the same
   * card chrome: menu settings closes/resets progress, while paused in-level
   * settings restarts/goes home. Both compose ModalShell + ToggleRows.
   */
  private openSettings(inGame: boolean): void {
    const togglesSection = document.createElement('div');
    togglesSection.className = 'mr-settings-toggles';
    const actions = this.buildSettingsActions(inGame);

    let toggles: UiHandle | null = null;
    this.pageStack.push(() => {
      const modal = mountModalShell({
        mountInto: this.uiRoot,
        ribbon: {
          title: copy['settings.title'],
          tone: 'neutral',
          image: assetUrls.ribbonTutorial,
          imageTitleVisibility: 'visible',
        },
        closeButton: {
          label: copy['settings.closeGlyph'],
          ariaLabel: copy['settings.close'],
          className: 'mr-settings-close',
          dataAction: 'settings-close',
        },
        body: togglesSection,
        actions,
        backdropDismiss: true,
        cardClassName: 'mr-settings-card',
        cardImage: assetUrls.popup,
        backplateImage: assetUrls.modalBackplate,
        backplateClassName: 'mr-modal-board mr-modal-board--settings',
        onDismiss: () => toggles?.dismiss(),
      });
      toggles = mountToggleRows({
        mountInto: togglesSection,
        rows: buildSettingsModel({
          music: saveState.musicEnabled,
          sfx: saveState.sfxEnabled,
          haptics: saveState.hapticsEnabled,
          labels: {
            music: copy['settings.music'],
            sfx: copy['settings.sfx'],
            haptics: copy['settings.haptics'],
          },
        }).toggles,
        onToggle: (key, next) => this.onSettingToggle(key as SettingKey, next, inGame),
      });
      return modal;
    });
  }

  private buildSettingsActions(inGame: boolean): HTMLElement {
    const actions = document.createElement('div');
    actions.className = `fab-modal-actions mr-settings-actions ${
      inGame ? 'mr-settings-actions--inlevel' : 'mr-settings-actions--menu'
    }`;
    if (!inGame) {
      actions.append(
        this.buildSpriteAction({
          label: copy['settings.close'],
          image: assetUrls.buttonPrimary,
          className: 'mr-settings-action mr-settings-action--close',
          dataAction: 'settings-close-cta',
          onClick: () => this.pageStack.pop(),
        }),
        this.buildSettingsResetAction(),
      );
      return actions;
    }

    actions.append(
      this.buildSpriteAction({
        label: copy['settings.restart'],
        image: assetUrls.buttonSecondary,
        className: 'mr-settings-action mr-settings-action--restart',
        dataAction: 'settings-restart',
        onClick: () => this.restartFromSettings(inGame),
      }),
      this.buildSpriteAction({
        label: copy['settings.home'],
        image: assetUrls.buttonPrimary,
        className: 'mr-settings-action mr-settings-action--home',
        dataAction: 'settings-home',
        onClick: () => this.homeFromSettings(),
      }),
    );
    return actions;
  }

  private buildSettingsResetAction(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mr-settings-reset';
    button.dataset.fabAction = 'settings-reset';
    button.textContent = copy['settings.reset'];
    button.addEventListener('click', () => this.resetProgressFromSettings());
    return button;
  }

  private buildResultActions(opts: Array<{
    label: string;
    image: string;
    className: string;
    dataAction: string;
    onClick: () => void;
  }>): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'fab-modal-actions mr-result-actions';
    actions.append(...opts.map((action) => this.buildSpriteAction(action)));
    return actions;
  }

  private buildSpriteAction(opts: {
    label: string;
    image: string;
    className: string;
    dataAction: string;
    onClick: () => void;
  }): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `fab-btn fab-btn-primary ${opts.className}`;
    button.dataset.fabAction = opts.dataAction;
    button.textContent = opts.label;
    button.style.setProperty('--mr-button-sprite-image', `url(${opts.image})`);
    button.addEventListener('click', () => opts.onClick());
    return button;
  }

  private restartFromSettings(inGame: boolean): void {
    const levelId = inGame && this.currentLevelId > 0 ? this.currentLevelId : saveState.currentLevel();
    this.pageStack.pop();
    this.startLevelId(levelId);
  }

  private homeFromSettings(): void {
    this.pageStack.pop();
    this.toMenu();
  }

  private resetProgressFromSettings(): void {
    saveState.resetProgress();
    this.pageStack.pop();
    this.renderMenu();
  }

  // ── Transitions (guarded) ───────────────────────────────────────

  private toMenu(): void {
    this.pageStack.dispose();
    if (this.machine.can('toMenu') || this.machine.state === 'boot') {
      this.machine.toMenu();
    }
  }

  private startCurrentLevel(): void {
    this.startLevelId(saveState.currentLevel());
  }

  private onSagaSelect(levelId: number): void {
    // mountSagaMap fires onSelectLevel for every node incl. locked; gate here
    // (matches v1: only the current/unlocked level is playable).
    if (levelId !== saveState.currentLevel()) return;
    this.startLevelId(levelId);
  }

  private startLevelId(levelId: number): void {
    this.pageStack.dispose();
    if (this.machine.state === 'playing' || this.machine.state === 'paused') {
      if (this.machine.can('toMenu')) this.machine.toMenu();
    }
    if (this.machine.can('start')) this.machine.start(String(levelId));
  }

  private next(levelId: number): void {
    const nextId = levelId + 1;
    if (nextId > LEVEL_COUNT) {
      this.toMenu();
      return;
    }
    if (this.machine.can('next')) this.machine.next(String(nextId));
  }

  private retry(): void {
    if (this.machine.can('retry')) this.machine.retry();
  }

  private pauseGame(): void {
    if (!this.machine.can('pause')) return;
    this.machine.pause();
    this.controller.pause();
    this.controller.setInputBlocked(true);
    this.clearScreen();
    this.mountPause();
  }

  private resumeGame(): void {
    if (!this.machine.can('resume')) return;
    this.machine.resume();
    this.clearScreen();
    this.controller.setInputBlocked(false);
    this.controller.resume();
  }

  // ── Game hooks (called by the GameController) ───────────────────

  private handleWin(info: PendingWin): void {
    this.pendingWin = info;
    if (this.machine.can('complete')) this.machine.complete();
  }

  private handleFail(info: { levelId: number }): void {
    void info;
    if (this.machine.can('fail')) this.machine.fail();
  }

  private async requestFailSave(): Promise<boolean> {
    // Rewarded fail-save via the ads SDK. On web/CI the provider is disabled →
    // granted:false → surface the v1 "unavailable" toast (no ad fill).
    const granted = await this.sdk.tryRewardedFailSave();
    if (!granted) this.toaster.show(copy['toast.saveUnavailable']);
    return granted;
  }

  private onSettingToggle(key: SettingKey, next: boolean, inGame: boolean): void {
    saveState.setSetting(key, next);
    toggleClick(next);
    if (key === 'music') {
      if (next && !inGame) music.refresh();
      else music.stop();
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private clearScreen(): void {
    if (this.screenHandle) {
      this.screenHandle.dismiss();
      this.screenHandle = null;
    }
  }

  private buildBanner(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'mr-menu-banner';
    const img = document.createElement('img');
    img.className = 'mr-menu-banner-art';
    img.src = assetUrls.banner;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = 'mr-menu-title';
    title.textContent = copy['app.title'];
    header.appendChild(img);
    header.appendChild(title);
    return header;
  }

  /** Win-overlay crown sprite shown at the top of the ResultCard body. */
  private buildWinCrown(): HTMLElement {
    const img = document.createElement('img');
    img.src = assetUrls.crown;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    return img;
  }

  private buildFailEmoji(): HTMLElement {
    const emoji = document.createElement('span');
    emoji.className = 'mr-result-emoji';
    emoji.textContent = copy['result.lose.emoji'];
    emoji.setAttribute('aria-hidden', 'true');
    return emoji;
  }

  private resultLevelEyebrow(levelId: number): string {
    return `${copy['menu.levelButton']} ${levelId}`;
  }

  private buildRewardDisplay(amount: number): { el: HTMLElement; source: HTMLElement } {
    const el = document.createElement('div');
    el.className = 'mr-reward';
    el.setAttribute('data-fab-economy-target', 'coin');
    const label = document.createElement('div');
    label.className = 'mr-reward-label';
    label.textContent = copy['result.win.reward'];
    const amountRow = document.createElement('div');
    amountRow.className = 'mr-reward-amount';
    const icon = document.createElement('img');
    icon.className = 'mr-reward-icon';
    icon.src = assetUrls.coin;
    icon.alt = copy['result.win.reward'];
    icon.setAttribute('data-fab-economy-anchor', 'coin');
    const value = document.createElement('span');
    value.className = 'mr-reward-value';
    value.textContent = `+${amount}`;
    amountRow.append(icon, value);
    el.append(label, amountRow);
    return { el, source: icon };
  }

  private async flyCoins(amount: number, source: HTMLElement): Promise<void> {
    const target = this.controller.coinAnchor();
    if (!target) return;
    target.setAttribute('data-fab-economy-target', 'coin');
    await animateEconomyTransfer({
      kind: 'coin',
      amount,
      tokenImage: assetUrls.coin,
      source,
      targets: ['[data-fab-economy-target="coin"]'],
      countElement: target,
      reducedMotion: prefersReducedMotion(),
    });
  }

  // ── Test harness surface ────────────────────────────────────────

  harness(): MarbleHarness {
    return {
      // ── standard GameHarness core ─────────────────────────────────
      gotoState: (state: string) => this.gotoState(state),
      startLevel: (id: number) => this.startLevelId(id),
      snapshot: () => this.snapshot(),
      sagaNodes: () => buildSagaNodes(saveState.unlocked, MENU_SAGA_WINDOW).map((n) => n.id),
      unlockAll: () => {
        for (let i = 1; i <= LEVEL_COUNT; i += 1) saveState.recordWin(i, 0);
      },
      grantCoins: (coins: number) => saveState.addCoins(coins),
      resetSave: () => {
        saveState.resetSave();
        this.renderMenu();
      },
      seedSave: (profile: HarnessSaveProfile) => {
        saveState.seedSave(profile);
        this.renderMenu();
      },

      // ── typed game verbs (both flavours: state-drive + input-drive) ─
      verbs: this.buildVerbs(),

      // ── observation witnesses (browser paths) ─────────────────────
      capture: (): CaptureResult => captureCanvasPng(this.canvas),
      perf: (): PerfSample => this.perfRecorder.sample(),
      drainEvents: (): readonly AnalyticsEventLike[] => this.harnessSink?.drain() ?? [],

      // ── legacy organic verbs (kept additively; no spec regresses) ──
      gotoMenu: () => this.toMenu(),
      showHint: () => this.controller.showHint(),
      cellClientPoint: (x: number, y: number) => this.controller.cellClientPoint({ x, y } as Cell),
      setAnimationSpeed: (m: number) => this.controller.setAnimationSpeed(m),
      solveStep: () => {
        const engine = this.controller.engineRef();
        if (!engine) return null;
        const movable = engine.movableMarbles();
        if (movable.length === 0) return null;
        const cell = movable[0].cell;
        this.controller.tapCell(cell);
        return cell;
      },

      // ── DETERMINISTIC solver-bound auto-play (A-star search, never random) ─
      // Gameplay-to-terminal-state is bound to the in-game solver, not to any
      // LLM/random policy: autoWin replays solveLevel().order; autoFail taps
      // genuinely-blocked marbles. Both drive via the real tapCell input path
      // and gate each step on gameStatus() (see ../testing/autoPlay).
      autoWin: (stepMs = 260): Promise<boolean> => this.runAutoWin(stepMs),
      autoFail: (stepMs = 260): Promise<boolean> => this.runAutoFail(stepMs),

      // ── DETERMINISTIC per-state navigation (ledger C5) ────────────────────
      // Normalises to menu, drives to the named state, and CONFIRMS arrival via
      // snapshot() before resolving. Composes the App transitions + the solver-
      // bound autoWin/autoFail above (see ../testing/driveTo).
      driveTo: (state: string): Promise<boolean> => this.driveTo(state),
    };
  }

  private runAutoWin(stepMs = 260): Promise<boolean> {
    const level = this.controller.currentLevelDef();
    const engine = this.controller.engineRef();
    if (!level || !engine) return Promise.resolve(false);
    return driveAutoWin(engine, level, (cell) => this.controller.tapCell(cell), stepMs);
  }

  private runAutoFail(stepMs = 260): Promise<boolean> {
    const engine = this.controller.engineRef();
    if (!engine) return Promise.resolve(false);
    return driveAutoFail(engine, (cell) => this.controller.tapCell(cell), stepMs);
  }

  /**
   * Deterministically navigate to a canonical capture state ({@link driveToState}).
   * Wires the pure driver to the real App transitions; win/fail delegate to the
   * solver-bound {@link runAutoWin}/{@link runAutoFail}. Confirms every arrival
   * via {@link snapshot} before resolving.
   */
  private driveTo(state: string): Promise<boolean> {
    return driveToState(
      {
        gotoMenu: () => this.toMenu(),
        startLevel: (id) => this.startLevelId(id),
        openSettings: () => this.openSettings(false),
        pause: () => this.pauseGame(),
        autoWin: () => this.runAutoWin(),
        autoFail: () => this.runAutoFail(),
        snapshot: () => this.snapshot(),
      },
      state,
    );
  }

  /**
   * Jump the flow to a named `gameConfig.screens` state (the contract
   * `gotoState`). Terminal/in-level screens (ResultCard/PauseOverlay) are SEEDED
   * here from existing transitions — a caller drives `solveStep()` to actually
   * reach a result — so this composes App transitions only, never engine logic.
   */
  private gotoState(state: string): void {
    switch (state) {
      case 'Settings':
        this.toMenu();
        this.openSettings(false);
        return;
      case 'PauseOverlay':
        this.startLevelId(1);
        this.pauseGame();
        return;
      case 'ResultCard':
        this.startLevelId(1);
        return;
      case 'HomeMenu':
      case 'SagaMap':
      case 'Toast':
      case 'ConnectivityIndicator':
      default:
        this.toMenu();
    }
  }

  /**
   * The typed verb map. Each verb carries `run` (state-drive engine call) and
   * `clientPoint` (input-drive coordinate accessor). Marble selection is a PURE
   * function of the roll ({@link pickByRoll}) so the two flavours target the
   * IDENTICAL marble and a seeded chaos run replays exactly. A `clientPoint`
   * with no legal target returns an off-screen point `{x:-1,y:-1}` — `driveInputAt`
   * then hit-tests `null`, an honest "nothing to tap" signal rather than a lie.
   */
  private buildVerbs(): Record<MarbleVerb, GameVerbHandler> {
    const offscreen: ClientPoint = { x: -1, y: -1 };
    return {
      tapCell: {
        run: (x: number, y: number) => this.controller.tapCell({ x, y } as Cell),
        clientPoint: (x: number, y: number) =>
          this.controller.cellClientPoint({ x, y } as Cell) ?? offscreen,
      },
      tapUnlockedMarble: {
        run: (roll?: number) => {
          const engine = this.controller.engineRef();
          if (!engine) return null;
          const marble = pickByRoll(engine.movableMarbles(), roll ?? Math.random());
          if (!marble) return null;
          this.controller.tapCell(marble.cell);
          return marble.cell;
        },
        clientPoint: (roll?: number) => {
          const engine = this.controller.engineRef();
          const marble = engine ? pickByRoll(engine.movableMarbles(), roll ?? 0) : null;
          return (marble && this.controller.cellClientPoint(marble.cell)) || offscreen;
        },
      },
      tapBlockedMarble: {
        run: (roll?: number) => {
          const engine = this.controller.engineRef();
          if (!engine) return null;
          const blocked = blockedMarbles(engine.allMarbles(), engine.movableMarbles());
          const marble = pickByRoll(blocked, roll ?? Math.random());
          if (!marble) return null;
          this.controller.tapCell(marble.cell);
          return marble.cell;
        },
        clientPoint: (roll?: number) => {
          const engine = this.controller.engineRef();
          const blocked = engine
            ? blockedMarbles(engine.allMarbles(), engine.movableMarbles())
            : [];
          const marble = pickByRoll(blocked, roll ?? 0);
          return (marble && this.controller.cellClientPoint(marble.cell)) || offscreen;
        },
      },
    };
  }

  snapshot(): Record<string, unknown> {
    return {
      ...this.controller.snapshot(),
      scene: this.machine.state,
      // Settings is a MODAL over the menu (no distinct flow-machine scene), so
      // driveTo('settings') confirms arrival on this DOM-derived flag rather
      // than on `scene`. `scene`/`status`/`inputReady`/`hearts`/`coins` (the
      // fields driveTo + the capture tool read) all flow up from the controller
      // snapshot above.
      settingsOpen: !!this.uiRoot.querySelector('.mr-settings-card'),
      reward: LEVEL_COIN_REWARD,
      sagaNodeIds:
        this.machine.state === 'menu' || this.machine.state === 'levelSelect'
          ? buildSagaNodes(saveState.unlocked, MENU_SAGA_WINDOW).map((n) => n.id)
          : [],
    };
  }
}

export const isHarnessEnabled = TEST_HARNESS_ENABLED;
