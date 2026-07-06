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
  type ModalAction,
  type SettingKey,
} from '@fabrikav2/ui';
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
import type { Cell } from '../engine/types';

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

  constructor(mounts: AppMounts, sdk: GameSdk) {
    this.uiRoot = mounts.uiRoot;
    this.sdk = sdk;

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
  }

  /** Boot into the menu. */
  start(): void {
    this.toMenu();
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
    const gearIcon = document.createElement('span');
    gearIcon.className = 'mr-gear-glyph';
    gearIcon.textContent = '⚙';
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
    const actions: ModalAction[] = [
      { label: copy['result.win.next'], onClick: () => this.next(info.levelId), variant: 'primary' },
      { label: copy['result.win.retry'], onClick: () => this.retry(), variant: 'secondary' },
    ];
    const reward = this.buildRewardDisplay(info.reward);
    this.screenHandle = mountResultCard({
      mountInto: this.uiRoot,
      variant: 'win',
      title: copy['result.win.title'],
      rewardDisplay: reward.el,
      actions,
    });
    void this.flyCoins(info.reward, reward.source);
  }

  private mountFinale(): void {
    const actions: ModalAction[] = [
      { label: copy['result.finale.action'], onClick: () => this.toMenu(), variant: 'primary' },
    ];
    this.screenHandle = mountResultCard({
      mountInto: this.uiRoot,
      variant: 'win',
      title: copy['result.finale.title'],
      messages: copy['result.finale.message'],
      actions,
    });
  }

  private mountLose(): void {
    const actions: ModalAction[] = [
      { label: copy['result.lose.watchAd'], onClick: () => void this.requestFailSave(), variant: 'primary' },
      { label: copy['result.lose.retry'], onClick: () => this.retry(), variant: 'secondary' },
      { label: copy['result.lose.quit'], onClick: () => this.toMenu(), variant: 'secondary' },
    ];
    this.screenHandle = mountResultCard({
      mountInto: this.uiRoot,
      variant: 'lose',
      title: copy['result.lose.title'],
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
   * Settings surface. The Android reference (refs/.../settings.png) is a MODAL
   * over the dimmed menu — blue card, title, green toggles, CLOSE button, RESET
   * PROGRESS link — NOT the slide-up full page v2 originally shipped (conductor
   * comment #3). Composed from ModalShell + the wave-A ToggleRows (compose, not
   * rebuild). Out of game only offers RESET PROGRESS.
   */
  private openSettings(inGame: boolean): void {
    const togglesSection = document.createElement('div');
    togglesSection.className = 'mr-settings-toggles';

    const actions: ModalAction[] = [
      { label: copy['settings.close'], onClick: () => this.pageStack.pop(), variant: 'primary', className: 'mr-level-cta' },
    ];
    if (!inGame && saveState.hasProgress) {
      actions.push({
        label: copy['settings.reset'],
        onClick: () => this.resetProgress(),
        variant: 'secondary',
      });
    }

    let toggles: UiHandle | null = null;
    this.pageStack.push(() => {
      const modal = mountModalShell({
        mountInto: this.uiRoot,
        title: copy['settings.title'],
        body: togglesSection,
        actions,
        backdropDismiss: true,
        cardClassName: 'mr-settings-card',
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

  private resetProgress(): void {
    saveState.resetProgress();
    music.stop();
    this.pageStack.pop();
    this.toaster.show(copy['settings.reset']);
    // Re-render the menu so the coin pill + saga reflect the wiped progress.
    if (this.machine.state === 'menu') this.renderMenu();
  }

  // ── Transitions (guarded) ───────────────────────────────────────

  private toMenu(): void {
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

  private buildRewardDisplay(amount: number): { el: HTMLElement; source: HTMLElement } {
    const el = document.createElement('div');
    el.className = 'mr-reward';
    el.setAttribute('data-fab-economy-target', 'coin');
    const icon = document.createElement('img');
    icon.className = 'mr-reward-icon';
    icon.src = assetUrls.coin;
    icon.alt = copy['result.win.reward'];
    icon.setAttribute('data-fab-economy-anchor', 'coin');
    const value = document.createElement('span');
    value.className = 'mr-reward-value';
    value.textContent = String(amount);
    el.appendChild(icon);
    el.appendChild(value);
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

  harness(): Record<string, unknown> {
    return {
      gotoMenu: () => this.toMenu(),
      startLevel: (id: number) => this.startLevelId(id),
      tapCell: (x: number, y: number) => this.controller.tapCell({ x, y } as Cell),
      showHint: () => this.controller.showHint(),
      cellClientPoint: (x: number, y: number) => this.controller.cellClientPoint({ x, y } as Cell),
      setAnimationSpeed: (m: number) => this.controller.setAnimationSpeed(m),
      snapshot: () => this.snapshot(),
      sagaNodes: () => buildSagaNodes(saveState.unlocked, MENU_SAGA_WINDOW).map((n) => n.id),
      solveStep: () => {
        const engine = this.controller.engineRef();
        if (!engine) return null;
        const movable = engine.movableMarbles();
        if (movable.length === 0) return null;
        const cell = movable[0].cell;
        this.controller.tapCell(cell);
        return cell;
      },
      unlockAll: () => {
        for (let i = 1; i <= LEVEL_COUNT; i += 1) saveState.recordWin(i, 0);
      },
      grantCoins: (coins: number) => saveState.addCoins(coins),
    };
  }

  snapshot(): Record<string, unknown> {
    return {
      ...this.controller.snapshot(),
      scene: this.machine.state,
      reward: LEVEL_COIN_REWARD,
      sagaNodeIds:
        this.machine.state === 'menu' || this.machine.state === 'levelSelect'
          ? buildSagaNodes(saveState.unlocked, MENU_SAGA_WINDOW).map((n) => n.id)
          : [],
    };
  }
}

export const isHarnessEnabled = TEST_HARNESS_ENABLED;
