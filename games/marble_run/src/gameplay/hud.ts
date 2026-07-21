/**
 * In-level DOM HUD — ported verbatim from the game-HUD slice of Sugar3D v1
 * `src/ui/dom.ts` (hearts in the vida Goals frame, coin counter in the vida
 * Currency frame, hint button with cost badge + disabled state, settings
 * button). Menu / win / fail / settings modals are NOT ported here: those are
 * owned by the fabrikav2 shell (MRV2-5). The controller drives this HUD and
 * routes outcomes to shell callbacks instead of showing its own modals.
 *
 * vida art is served from `public/v1/ui/vida/GameScreen/` (ported by MRV2-3),
 * referenced by absolute URL rather than a bundler import — matching how the
 * rest of the v2 game references its `public/` assets.
 */
import { HINT_COIN_COST } from '../three/constants';

const VIDA = '/v1/ui/vida/GameScreen';
const GOALS_FRAME = `${VIDA}/Frame_Goals.png`;
const CURRENCY_FRAME = `${VIDA}/Frame_Currency.png`;
const BOOSTER_BUTTON = `${VIDA}/Button_Booster.png`;
const SETTINGS_BUTTON = `${VIDA}/Button_Settins.png`;
const SETTINGS_ICON = `${VIDA}/Icon_Settings.png`;
const GAME_COIN_ICON = `${VIDA}/Icon_Coin.png`;

const ROUTE_BLOCKED_PROMPT_VISIBLE_MS = 3000;
const ROUTE_BLOCKED_PROMPT_FADE_MS = 260;

export interface HudCallbacks {
  onHint(): void;
  onSettings(): void;
}

function settingsButtonHtml(extraClass = ''): string {
  return `
    <button class="vida-settings-button ${extraClass}" data-a="settings" type="button" aria-label="Settings">
      <img class="vida-settings-button-art" src="${SETTINGS_BUTTON}" alt="" draggable="false">
      <img class="vida-settings-icon" src="${SETTINGS_ICON}" alt="" draggable="false">
    </button>
  `;
}

function currencyCounterHtml(value: number, extraClass = ''): string {
  return `
    <div class="vida-currency-counter ${extraClass}" data-economy-anchor="coin">
      <img class="vida-counter-frame" src="${CURRENCY_FRAME}" alt="" draggable="false">
      <span class="vida-counter-content">
        <img class="vida-counter-coin" src="${GAME_COIN_ICON}" alt="" draggable="false">
        <span class="vida-counter-value">${value}</span>
      </span>
    </div>
  `;
}

function comboPhrase(streak: number): string {
  if (streak >= 60) return 'Unstoppable!';
  if (streak >= 40) return 'Spectacular!';
  if (streak >= 20) return 'Unstoppable!';
  if (streak >= 10) return 'Amazing!';
  if (streak >= 7) return 'Smooth!';
  if (streak >= 5) return 'Great!';
  return 'Nice!';
}

/** The in-level HUD layer. One instance per level run; owns a `.screen` node
 *  under the provided root and tears it down on `dispose()`. */
export class GameHud {
  private readonly root: HTMLElement;
  private readonly cb: HudCallbacks;
  private screenEl: HTMLElement | null = null;
  private heartsEl: HTMLElement | null = null;
  private gameCoinValueEl: HTMLElement | null = null;
  private hintButtonEl: HTMLButtonElement | null = null;
  private routeBlockedPromptEl: HTMLElement | null = null;
  private routeBlockedPromptFadeTimer: number | null = null;
  private routeBlockedPromptRemoveTimer: number | null = null;

  constructor(root: HTMLElement, cb: HudCallbacks) {
    this.root = root;
    this.cb = cb;
  }

  showGameHud(_levelId: number, hearts: number, _remaining: number, coins: number): void {
    const heartSpans = Array.from({ length: hearts }, () => '<span>❤</span>').join('');
    const canAffordHint = coins >= HINT_COIN_COST;
    const el = this.swap(`
      <div class="hud">
        ${currencyCounterHtml(coins, 'game-coin-counter')}
        <div class="hearts" data-r="hearts">
          <img class="vida-hearts-frame" src="${GOALS_FRAME}" alt="" draggable="false">
          <span class="hearts-content">${heartSpans}</span>
        </div>
        ${settingsButtonHtml('game-settings')}
      </div>
      <div class="hud-bottom">
        <button class="hint-btn" data-a="hint" type="button" aria-label="Hint costs ${HINT_COIN_COST} coins"${canAffordHint ? '' : ' disabled'}>
          <img class="hint-btn-art" src="${BOOSTER_BUTTON}" alt="" draggable="false">
          <span class="hint-label">HINT</span>
          <span class="hint-cost"><img src="${GAME_COIN_ICON}" alt="" draggable="false">${HINT_COIN_COST}</span>
        </button>
      </div>
    `);
    this.heartsEl = el.querySelector('[data-r=hearts] .hearts-content');
    this.gameCoinValueEl = el.querySelector('.game-coin-counter .vida-counter-value');
    this.hintButtonEl = el.querySelector('[data-a=hint]');
    el.querySelector('[data-a=settings]')!.addEventListener('click', () => {
      this.cb.onSettings();
    });
    el.querySelector('[data-a=hint]')!.addEventListener('click', () => {
      this.cb.onHint();
    });
  }

  setHearts(left: number): void {
    if (!this.heartsEl) return;
    Array.from(this.heartsEl.children).forEach((c, i) => {
      c.classList.toggle('dead', i >= left);
    });
  }

  setCoins(coins: number): void {
    if (this.gameCoinValueEl) this.gameCoinValueEl.textContent = String(coins);
    if (this.hintButtonEl) this.hintButtonEl.disabled = coins < HINT_COIN_COST;
  }

  popStreak(streak: number): void {
    if (streak < 3 || !this.screenEl) return;
    const phrase = comboPhrase(streak);
    const el = document.createElement('div');
    el.className = 'streak';
    el.textContent = `${phrase} x${streak}`;
    this.screenEl.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  showRouteBlockedPrompt(): void {
    if (!this.screenEl) return;
    this.hideRouteBlockedPrompt();
    const el = document.createElement('div');
    el.className = 'route-blocked-prompt';
    el.textContent = 'route blocked';
    this.screenEl.appendChild(el);
    this.routeBlockedPromptEl = el;
    this.routeBlockedPromptFadeTimer = window.setTimeout(() => {
      if (this.routeBlockedPromptEl !== el) return;
      this.routeBlockedPromptFadeTimer = null;
      el.classList.add('is-fading');
      this.routeBlockedPromptRemoveTimer = window.setTimeout(() => {
        if (this.routeBlockedPromptEl === el) this.hideRouteBlockedPrompt();
      }, ROUTE_BLOCKED_PROMPT_FADE_MS);
    }, ROUTE_BLOCKED_PROMPT_VISIBLE_MS);
  }

  hideRouteBlockedPrompt(): void {
    this.clearRouteBlockedPromptTimers();
    this.routeBlockedPromptEl?.remove();
    this.routeBlockedPromptEl = null;
  }

  showTutorialHand(point: { x: number; y: number }): HTMLElement | null {
    if (!this.screenEl) return null;
    const el = document.createElement('div');
    el.className = 'tutorial-hand-layer';
    el.style.setProperty('--tx', `${point.x}px`);
    el.style.setProperty('--ty', `${point.y}px`);
    el.innerHTML = `
      <div class="tutorial-spotlight"></div>
      <div class="tutorial-ring"></div>
      <div class="tutorial-hand" aria-hidden="true">👆</div>
    `;
    this.screenEl.appendChild(el);
    return el;
  }

  dispose(): void {
    this.clearRouteBlockedPromptTimers();
    this.screenEl?.remove();
    this.screenEl = null;
    this.heartsEl = null;
    this.gameCoinValueEl = null;
    this.hintButtonEl = null;
    this.routeBlockedPromptEl = null;
  }

  private swap(html: string): HTMLElement {
    this.hideRouteBlockedPrompt();
    this.screenEl?.remove();
    const el = document.createElement('div');
    el.className = 'screen mr-gameplay-screen';
    el.innerHTML = html;
    this.root.appendChild(el);
    this.screenEl = el;
    return el;
  }

  private clearRouteBlockedPromptTimers(): void {
    if (this.routeBlockedPromptFadeTimer !== null) {
      window.clearTimeout(this.routeBlockedPromptFadeTimer);
      this.routeBlockedPromptFadeTimer = null;
    }
    if (this.routeBlockedPromptRemoveTimer !== null) {
      window.clearTimeout(this.routeBlockedPromptRemoveTimer);
      this.routeBlockedPromptRemoveTimer = null;
    }
  }
}
