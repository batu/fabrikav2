/**
 * The Sanctuary: one tree, one nest box, three tiers, and the birds that live
 * in it.
 *
 * The scene is a stack of absolutely positioned layers over a cover-fitted
 * background, all placed from `layoutSanctuary` in manifest pixel space. Only
 * this file knows about the DOM; the geometry, the accrual arithmetic and the
 * costume ladder all live in pure modules beside it.
 *
 * Every animation is a Web Animation held in `animations` and cancelled with
 * `effect = null` on teardown — an uncancelled WAAPI animation holding a
 * detached element is what killed the app on level 3 in September, and this
 * page runs several of them forever.
 */

import { prefersReducedMotion } from '@fabrikav2/ui';
import { gameState, type SanctuaryHouseTier } from '../core/GameState';
import { analytics } from '../analytics/AnalyticsService';
import { accrualConfig, collectionThresholds, housePrice, MAX_HOUSE_TIER } from '../collection/config';
import { cardState } from '../collection/thresholds';
import { collectableCoins, settle } from '../sanctuary/accrual';
import { layoutSanctuary, type Rect, type SanctuaryManifest } from '../sanctuary/layout';
import { animateCoinsToBalance } from './EconomyTransfer';
import { refreshHomeWalletBalances } from './WalletBalances';
import { openPage } from './HUD';
import { playFind, playUITap } from '../audio/AudioManager';
import { hapticFound } from '../haptics/HapticsManager';
import manifestJson from '../../public/ui/sanctuary/manifest.json';

const MANIFEST = (manifestJson as unknown as { sanctuary: SanctuaryManifest }).sanctuary;

/** Harness-only clock override so the device pass can fast-forward accrual. */
declare global {
  interface Window { __ftbNow?: number }
}

function now(): number {
  const override = typeof window !== 'undefined' ? window.__ftbNow : undefined;
  return typeof override === 'number' && Number.isFinite(override) ? override : Date.now();
}

const animations: Animation[] = [];

/**
 * Start a tracked animation. Returns null (and animates nothing) where the Web
 * Animations API is missing, so a host without it renders a still, correct
 * scene instead of throwing halfway through the layout.
 */
function track(
  element: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (typeof element.animate !== 'function') return null;
  const animation = element.animate(keyframes, options);
  animations.push(animation);
  return animation;
}

/** Cancel and detach every animation this page started. */
export function teardownSanctuaryPage(): void {
  for (const animation of animations.splice(0)) {
    try {
      animation.cancel();
      animation.effect = null;
    } catch {
      // A finished animation may already be detached; nothing to release.
    }
  }
}

function applyRect(element: HTMLElement, rect: Rect): void {
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

export function renderSanctuaryPageBody(): string {
  return `
    <div class="sanctuary-scene" id="sanctuary-scene">
      <img class="sanctuary-bg" id="sanctuary-bg" src="${MANIFEST.background.src}" alt="" aria-hidden="true">
      <div class="sanctuary-layer" id="sanctuary-layer"></div>
      <div class="sanctuary-sheet-root" id="sanctuary-sheet-root"></div>
    </div>
  `;
}

interface SheetAction {
  label: string;
  kind: 'primary' | 'secondary';
  disabled?: boolean;
  onTap: () => void;
}

function showSheet(
  root: HTMLElement,
  options: { title: string; note?: string; facts?: string[]; actions: SheetAction[] },
): void {
  root.innerHTML = '';
  const sheet = document.createElement('div');
  sheet.className = 'sanctuary-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', options.title);

  const title = document.createElement('h3');
  title.className = 'sanctuary-sheet-title';
  title.textContent = options.title;
  sheet.appendChild(title);

  if (options.facts && options.facts.length > 0) {
    const facts = document.createElement('ul');
    facts.className = 'sanctuary-sheet-facts';
    for (const fact of options.facts) {
      const item = document.createElement('li');
      item.textContent = fact;
      facts.appendChild(item);
    }
    sheet.appendChild(facts);
  }

  if (options.note !== undefined) {
    const note = document.createElement('p');
    note.className = 'sanctuary-sheet-note';
    note.textContent = options.note;
    sheet.appendChild(note);
  }

  const actions = document.createElement('div');
  actions.className = 'sanctuary-sheet-actions';
  for (const action of options.actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `sanctuary-pill sanctuary-pill--${action.kind}`;
    button.textContent = action.label;
    button.disabled = action.disabled === true;
    button.addEventListener('click', () => { playUITap(); action.onTap(); });
    actions.appendChild(button);
  }
  sheet.appendChild(actions);
  root.appendChild(sheet);
  if (!prefersReducedMotion()) {
    track(sheet,
    [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }],
      { duration: 260, easing: 'cubic-bezier(.34,1.3,.64,1)' },
    );
  }
}

function closeSheet(root: HTMLElement): void {
  root.innerHTML = '';
}

/** Drop-and-squash used by build, upgrade and place. */
function dropIn(element: HTMLElement): void {
  if (prefersReducedMotion()) return;
  track(element,
    [
      { transform: 'translateY(-26%) scaleY(1.08)', opacity: 0 },
      { transform: 'translateY(0) scaleY(0.8)', opacity: 1, offset: 0.55 },
      { transform: 'translateY(0) scaleY(1.05)', offset: 0.78 },
      { transform: 'translateY(0) scaleY(1)' },
    ],
    { duration: 320, easing: 'ease-out' },
  );
}

/** Idle life for a housed bird: breathe, blink, and the occasional hop. */
function startIdle(element: HTMLElement): void {
  if (prefersReducedMotion()) return;
  track(element,
    [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }],
    { duration: 2400, iterations: Infinity, easing: 'ease-in-out' },
  );
  // Blink and hop are separate infinite timelines with long quiet stretches, so
  // the bird never looks metronomic.
  track(element,
    [
      { transform: 'scaleY(1)', offset: 0 },
      { transform: 'scaleY(1)', offset: 0.95 },
      { transform: 'scaleY(0.92)', offset: 0.975 },
      { transform: 'scaleY(1)', offset: 1 },
    ],
    { duration: 5200, iterations: Infinity, composite: 'add' },
  );
  track(element,
    [
      { transform: 'translateY(0)', offset: 0 },
      { transform: 'translateY(0)', offset: 0.9 },
      { transform: 'translateY(-6%)', offset: 0.95 },
      { transform: 'translateY(0)', offset: 1 },
    ],
    { duration: 11000, iterations: Infinity, composite: 'add', easing: 'ease-out' },
  );
}

function hop(element: HTMLElement): void {
  if (prefersReducedMotion()) return;
  track(element,
    [
      { transform: 'translateY(0) scaleY(1)' },
      { transform: 'translateY(-14%) scaleY(1.06)', offset: 0.45 },
      { transform: 'translateY(0) scaleY(0.94)', offset: 0.78 },
      { transform: 'translateY(0) scaleY(1)' },
    ],
    { duration: 380, easing: 'ease-out', composite: 'add' },
  );
}

function currentCostume(): string {
  const state = cardState(gameState.birdCount('sparrow'), collectionThresholds());
  return state === 'silhouette' ? 'plain' : state;
}

function birdSprite(costume: string): string {
  const sparrow = MANIFEST.birds.sparrow;
  return sparrow[costume] ?? sparrow.plain;
}

export function wireSanctuaryPage(page: ParentNode): void {
  const scene = page.querySelector<HTMLElement>('#sanctuary-scene');
  const layer = page.querySelector<HTMLElement>('#sanctuary-layer');
  const background = page.querySelector<HTMLImageElement>('#sanctuary-bg');
  const sheetRoot = page.querySelector<HTMLElement>('#sanctuary-sheet-root');
  if (scene === null || layer === null || background === null || sheetRoot === null) return;

  // Accrual is settled on open (and again on resume) rather than ticked: the
  // page may have been closed for hours, and a tick cannot recover that.
  const settleNow = (): void => {
    const result = settle(gameState.sanctuary, now(), accrualConfig());
    if (result.state !== gameState.sanctuary) gameState.commitSanctuaryState(result.state);
  };

  const render = (): void => {
    settleNow();
    const sanctuary = gameState.sanctuary;
    const viewport = { width: scene.clientWidth, height: scene.clientHeight };
    if (viewport.width === 0 || viewport.height === 0) return;
    const layout = layoutSanctuary(MANIFEST, sanctuary.houseTier, viewport);

    applyRect(background, layout.background);
    layer.innerHTML = '';

    if (layout.house === null) {
      // Nothing built: the plot marker is the whole invitation.
      const marker = document.createElement('img');
      marker.className = 'sanctuary-plot';
      marker.src = MANIFEST.markers.plot;
      marker.alt = '';
      applyRect(marker, layout.plotMarker);
      layer.appendChild(marker);
      offerBuild();
      return;
    }

    const house = document.createElement('button');
    house.type = 'button';
    house.className = 'sanctuary-house';
    house.setAttribute('aria-label', `Nest box, tier ${sanctuary.houseTier}. Tap to upgrade`);
    const houseArt = document.createElement('img');
    houseArt.src = MANIFEST.houseTiers[sanctuary.houseTier - 1].src;
    houseArt.alt = '';
    house.appendChild(houseArt);
    applyRect(house, layout.house);
    house.addEventListener('click', () => { playUITap(); offerUpgrade(); });
    layer.appendChild(house);

    for (const pedestal of layout.pedestals) {
      const tenant = sanctuary.placed[pedestal.index];
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'sanctuary-pedestal';
      slot.dataset.pedestal = String(pedestal.index);
      const sprite = document.createElement('img');
      sprite.alt = '';

      if (tenant === undefined) {
        slot.classList.add('sanctuary-pedestal--empty');
        slot.setAttribute('aria-label', 'Empty perch. Tap to choose a bird');
        sprite.src = MANIFEST.markers.pedestalEmpty;
        slot.addEventListener('click', () => { playUITap(); offerPlacement(pedestal.index); });
      } else {
        slot.setAttribute('aria-label', 'Sparrow. Tap to say hello');
        sprite.src = birdSprite(currentCostume());
        const shadow = document.createElement('span');
        shadow.className = 'sanctuary-shadow';
        applyRect(shadow, pedestal.shadow);
        layer.appendChild(shadow);
        slot.addEventListener('click', () => { playFind(); hapticFound(); hop(slot); });
      }

      slot.appendChild(sprite);
      slot.style.left = `${pedestal.anchor.x}px`;
      slot.style.top = `${pedestal.anchor.y - pedestal.birdHeight}px`;
      slot.style.height = `${pedestal.birdHeight}px`;
      slot.style.transform = 'translateX(-50%)';
      layer.appendChild(slot);

      if (tenant === undefined) {
        if (!prefersReducedMotion()) {
          // Shallow pulse: a deep fade made an already-pale marker vanish
          // against the sky in a capture taken at the low point.
          track(
            slot,
            [{ opacity: 0.82 }, { opacity: 1 }, { opacity: 0.82 }],
            { duration: 1800, iterations: Infinity, easing: 'ease-in-out' },
          );
        }
      } else {
        startIdle(slot);
      }
    }

    const pending = collectableCoins(sanctuary);
    if (pending > 0) {
      const pile = document.createElement('button');
      pile.type = 'button';
      pile.className = 'sanctuary-coins';
      pile.setAttribute('aria-label', `Collect ${pending} coins`);
      const art = document.createElement('img');
      art.src = MANIFEST.markers.coinPile;
      art.alt = '';
      const badge = document.createElement('span');
      badge.className = 'sanctuary-coins-badge';
      badge.textContent = `+${pending}`;
      pile.append(art, badge);
      applyRect(pile, layout.coinPile);
      pile.addEventListener('click', () => { collect(pile); });
      layer.appendChild(pile);
      if (!prefersReducedMotion()) {
        track(pile,
    [{ transform: 'translateY(0)' }, { transform: 'translateY(-6%)' }, { transform: 'translateY(0)' }],
          { duration: 1600, iterations: Infinity, easing: 'ease-in-out' },
        );
      }
    }
  };

  const collect = (pile: HTMLElement): void => {
    const tier = gameState.sanctuary.houseTier;
    const before = gameState.coinBalance;
    const coins = gameState.collectSanctuaryCoins();
    if (coins <= 0) return;
    playUITap();
    void analytics.sanctuaryCollect({ coins, tier });
    const overlay = document.getElementById('hud-overlay');
    void animateCoinsToBalance({
      amount: coins,
      source: pile,
      target: overlay?.querySelector<HTMLElement>('.home-coin-pill') ?? null,
      owner: overlay ?? document.body,
      countElement: overlay?.querySelector<HTMLElement>('.home-coin-pill > span') ?? null,
      fromValue: before,
      toValue: before + coins,
    });
    if (overlay !== null) refreshHomeWalletBalances(overlay);
    render();
  };

  const buy = (tier: SanctuaryHouseTier): void => {
    const price = housePrice(tier);
    if (!gameState.purchaseHouseTier(tier, price)) return;
    void analytics.sanctuaryHouse({ tier, price });
    closeSheet(sheetRoot);
    render();
    const house = layer.querySelector<HTMLElement>('.sanctuary-house');
    if (house !== null) dropIn(house);
    const overlay = document.getElementById('hud-overlay');
    if (overlay !== null) refreshHomeWalletBalances(overlay);
  };

  const priceActions = (tier: SanctuaryHouseTier, label: string): SheetAction[] => {
    const price = housePrice(tier);
    const affordable = gameState.coinBalance >= price;
    return [
      { label: 'Later', kind: 'secondary', onTap: () => { closeSheet(sheetRoot); } },
      {
        label: affordable ? `${label}  ${price}` : `Need ${price - gameState.coinBalance} more`,
        kind: 'primary',
        onTap: () => {
          if (affordable) { buy(tier); return; }
          // Not enough coins is a shop trip, not a dead end.
          openPage('shop', { scrollTo: 'coins' });
        },
      },
    ];
  };

  const offerBuild = (): void => {
    showSheet(sheetRoot, {
      title: 'Build a nest box',
      facts: ['1 perch', `${accrualConfig().coinsPerHourByTier[0]} coins per hour`],
      actions: priceActions(1, 'Build'),
    });
  };

  const offerUpgrade = (): void => {
    const tier = gameState.sanctuary.houseTier;
    if (tier >= MAX_HOUSE_TIER) {
      showSheet(sheetRoot, {
        title: `Nest box · Tier ${tier}`,
        note: 'Max tier',
        actions: [{ label: 'Close', kind: 'secondary', onTap: () => { closeSheet(sheetRoot); } }],
      });
      return;
    }
    const next = (tier + 1) as SanctuaryHouseTier;
    showSheet(sheetRoot, {
      title: `Nest box · Tier ${tier}`,
      facts: ['+1 perch', `+${accrualConfig().coinsPerHourByTier[next - 1] - accrualConfig().coinsPerHourByTier[tier - 1]} coins per hour`],
      actions: priceActions(next, 'Upgrade'),
    });
    showGhost(next);
  };

  /** Ghost of the next tier, so the upgrade is visible before it is bought. */
  const showGhost = (tier: SanctuaryHouseTier): void => {
    const viewport = { width: scene.clientWidth, height: scene.clientHeight };
    const layout = layoutSanctuary(MANIFEST, tier, viewport);
    if (layout.house === null) return;
    const ghost = document.createElement('img');
    ghost.className = 'sanctuary-ghost';
    ghost.src = MANIFEST.houseTiers[tier - 1].src;
    ghost.alt = '';
    applyRect(ghost, layout.house);
    layer.appendChild(ghost);
  };

  const offerPlacement = (pedestalIndex: number): void => {
    const unlocked = cardState(gameState.birdCount('sparrow'), collectionThresholds()) !== 'silhouette';
    showSheet(sheetRoot, {
      title: 'Who moves in?',
      facts: unlocked ? ['Sparrow — ready to move in'] : ['No bird unlocked yet'],
      note: unlocked ? undefined : 'Find sparrows in levels to unlock one.',
      actions: [
        { label: 'Later', kind: 'secondary', onTap: () => { closeSheet(sheetRoot); } },
        {
          label: unlocked ? 'Place sparrow' : 'Collection',
          kind: 'primary',
          onTap: () => {
            if (!unlocked) { openPage('collection'); return; }
            if (!gameState.placeBird(pedestalIndex, 'sparrow', new Date(now()))) return;
            closeSheet(sheetRoot);
            render();
            const placed = layer.querySelector<HTMLElement>(`.sanctuary-pedestal[data-pedestal="${pedestalIndex}"]`);
            if (placed !== null) dropIn(placed);
          },
        },
      ],
    });
  };

  const onResize = (): void => { render(); };
  const onVisible = (): void => { if (document.visibilityState === 'visible') render(); };
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisible);

  // The page element is removed by closePage; release the listeners and every
  // infinite animation with it.
  const observer = new MutationObserver(() => {
    if (scene.isConnected) return;
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisible);
    teardownSanctuaryPage();
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  render();
}
