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
import { accrualConfig, housePrice, MAX_HOUSE_TIER } from '../collection/config';
import { CARD_STATE_ORDER, clampRung } from '../collection/thresholds';
import { displayedRung } from '../collection/cardModel';
import { collectableCoins, settle } from '../sanctuary/accrual';
import { layoutSanctuary, type Rect, type SanctuaryManifest } from '../sanctuary/layout';
import { animateCoinsToBalance } from './EconomyTransfer';
import { refreshHomeWalletBalances } from './WalletBalances';
import { openPage, refreshMetaNav } from './HUD';
import { playBirdPlace, playFind, playHouseBuild, playUITap, preloadMetaSounds } from '../audio/AudioManager';
import { burst, cancelJuice, centerOf, nudge } from './juice';
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
  cancelJuice();
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
      <div class="sanctuary-actions" id="sanctuary-actions"></div>
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
  options: { title: string; note?: string; facts?: string[]; portrait?: string; actions: SheetAction[] },
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

  if (options.portrait !== undefined) {
    const face = document.createElement('span');
    face.className = 'sanctuary-sheet-portrait';
    const img = document.createElement('img');
    img.src = options.portrait;
    img.alt = '';
    face.appendChild(img);
    sheet.appendChild(face);
  }

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

/** Drop-and-squash used by build, upgrade and place: falls in from above,
 *  lands hard, and settles through two shrinking bounces. Additive, so a
 *  pedestal's inline foot offset stays under it. */
function dropIn(element: HTMLElement): void {
  if (prefersReducedMotion()) return;
  track(element,
    [
      { transform: 'translateY(-55%) scale(.92, 1.14)', opacity: 0 },
      { transform: 'translateY(-30%) scale(.94, 1.1)', opacity: 1, offset: 0.25 },
      { transform: 'translateY(0) scale(1.14, .78)', offset: 0.5 },
      { transform: 'translateY(-4%) scale(.96, 1.07)', offset: 0.7 },
      { transform: 'translateY(0) scale(1.03, .97)', offset: 0.86 },
      { transform: 'translateY(0) scale(1, 1)' },
    ],
    { duration: 460, easing: 'ease-out', composite: 'add' },
  );
}

/** The contact shadow under a landing bird: squashes wide as the feet hit. */
function shadowLand(shadow: HTMLElement): void {
  if (prefersReducedMotion()) return;
  track(shadow,
    [
      { transform: 'scale(.5, .6)', opacity: 0 },
      { transform: 'scale(.7, .7)', opacity: .6, offset: 0.4 },
      { transform: 'scale(1.3, 1.2)', opacity: 1, offset: 0.55 },
      { transform: 'scale(1, 1)', opacity: 1 },
    ],
    { duration: 460, easing: 'ease-out' },
  );
}

/** Idle life for a housed bird: breathe, blink, and the occasional hop. */
/** `seat` offsets every timeline so two tenants never breathe, blink or hop
 *  in step; WAAPI negative delays start each loop part-way through. */
function startIdle(element: HTMLElement, seat = 0): void {
  if (prefersReducedMotion()) return;
  const phase = (seat * 0.37) % 1;
  track(element,
    [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }],
    { duration: 2400, iterations: Infinity, easing: 'ease-in-out', delay: -phase * 2400 },
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
    { duration: 5200, iterations: Infinity, composite: 'add', delay: -phase * 5200 },
  );
  track(element,
    [
      { transform: 'translateY(0)', offset: 0 },
      { transform: 'translateY(0)', offset: 0.9 },
      { transform: 'translateY(-6%)', offset: 0.95 },
      { transform: 'translateY(0)', offset: 1 },
    ],
    { duration: 11000, iterations: Infinity, composite: 'add', easing: 'ease-out', delay: -((phase + 0.5) % 1) * 11000 },
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
  const meta = gameState.collectionMeta;
  const state = CARD_STATE_ORDER[displayedRung(clampRung(meta.claimedRung), meta.selectedRung)];
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
  preloadMetaSounds();

  // Accrual is settled on open (and again on resume) rather than ticked: the
  // page may have been closed for hours, and a tick cannot recover that.
  const settleNow = (): void => {
    const result = settle(gameState.sanctuary, now(), accrualConfig());
    if (result.state !== gameState.sanctuary) gameState.commitSanctuaryState(result.state);
  };

  // Sheets have no dismiss button; a tap anywhere else on the scene closes
  // them. Capture phase, so a tap on a perch closes the old sheet BEFORE the
  // perch's own handler opens the next one.
  scene.addEventListener('click', (event) => {
    if (sheetRoot.childElementCount === 0) return;
    if (event.target instanceof Node && sheetRoot.contains(event.target)) return;
    closeSheet(sheetRoot);
  }, { capture: true });

  const render = (): void => {
    settleNow();
    const sanctuary = gameState.sanctuary;
    const viewport = { width: scene.clientWidth, height: scene.clientHeight };
    if (viewport.width === 0 || viewport.height === 0) return;
    const layout = layoutSanctuary(MANIFEST, sanctuary.houseTier, viewport);

    applyRect(background, layout.background);
    layer.innerHTML = '';

    renderActions();
    if (layout.house === null) return;

    const house = document.createElement('button');
    house.type = 'button';
    house.className = 'sanctuary-house';
    house.setAttribute('aria-label', `Nest box, tier ${sanctuary.houseTier}. Tap to upgrade`);
    const houseArt = document.createElement('img');
    houseArt.src = MANIFEST.houseTiers[sanctuary.houseTier - 1].src;
    houseArt.alt = '';
    house.appendChild(houseArt);
    applyRect(house, layout.house);
    house.addEventListener('click', () => { playUITap(); hop(house); });
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
        // No ghost bird on an empty perch: a small plus is the whole invitation.
        slot.classList.add('sanctuary-pedestal--empty');
        slot.setAttribute('aria-label', 'Empty perch. Tap to choose a bird');
        sprite.remove();
        const plus = document.createElement('span');
        plus.className = 'sanctuary-perch-plus';
        plus.textContent = '+';
        slot.appendChild(plus);
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

      if (tenant !== undefined) slot.appendChild(sprite);
      // Anchor the FEET, not the sprite's geometric centre: a sparrow's tail
      // sits well left of its legs, so centring stood the bird off the perch.
      const footFraction = tenant === undefined
        ? (MANIFEST.markerFootCenterX ?? 0.5)
        : (MANIFEST.birdFootCenterX?.[currentCostume()] ?? 0.5);
      slot.style.left = `${pedestal.anchor.x}px`;
      slot.style.top = `${pedestal.anchor.y - pedestal.birdHeight}px`;
      slot.style.height = `${pedestal.birdHeight}px`;
      slot.style.transform = `translateX(${(-footFraction * 100).toFixed(2)}%)`;
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
        startIdle(slot, pedestal.index);
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
    // Fly to the PAGE header's coin pill: the home pill is hidden under the
    // page, so the number the player can see must be the one that counts up.
    const headerPill = page.querySelector<HTMLElement>('.shop-header-coin-pill');
    void animateCoinsToBalance({
      amount: coins,
      source: pile,
      target: headerPill ?? overlay?.querySelector<HTMLElement>('.home-coin-pill') ?? null,
      owner: overlay ?? document.body,
      countElement: page.querySelector<HTMLElement>('.shop-header-coin-count') ?? overlay?.querySelector<HTMLElement>('.home-coin-pill > span') ?? null,
      fromValue: before,
      toValue: before + coins,
    });
    if (overlay !== null) refreshHomeWalletBalances(overlay);
    render();
    // The pile is gone, so the tile's claim dot must go with it.
    refreshMetaNav();
  };

  /**
   * Build or upgrade: the coins leave the wallet pill and fly INTO the house,
   * and only when they arrive does the new box drop onto the branch (dust at
   * its base, a few sparkles, the scene leaning in). During the flight the
   * previous tier stays on the branch; a first build shows nothing until the
   * coins land.
   */
  const buy = (tier: SanctuaryHouseTier): void => {
    const price = housePrice(tier);
    const before = gameState.coinBalance;
    const previousTier = gameState.sanctuary.houseTier;
    if (!gameState.purchaseHouseTier(tier, price)) return;
    void analytics.sanctuaryHouse({ tier, price });
    closeSheet(sheetRoot);
    render();
    const house = layer.querySelector<HTMLElement>('.sanctuary-house');
    const houseArt = house?.querySelector<HTMLImageElement>('img') ?? null;
    const overlay = document.getElementById('hud-overlay');
    const reveal = (): void => {
      if (overlay !== null) refreshHomeWalletBalances(overlay);
      if (house === null || !house.isConnected) return;
      if (houseArt !== null) houseArt.src = MANIFEST.houseTiers[tier - 1].src;
      house.style.opacity = '';
      dropIn(house);
      playHouseBuild();
      hapticFound();
      const centre = centerOf(house, 0.55);
      const base = centerOf(house, 0.92);
      if (centre !== null) nudge(scene, centre, 0.03);
      if (base !== null) burst(base, 'puff', { delay: 200, radius: 70, count: 10 });
      if (centre !== null) burst(centre, 'sparkle', { delay: 260, radius: 120, count: 12 });
      if (centre !== null) burst(centre, 'confetti', { delay: 240, radius: 130, count: 16 });
    };
    if (house === null || prefersReducedMotion()) { reveal(); return; }
    // Hold the old look (or nothing) while the coins travel.
    if (previousTier > 0 && houseArt !== null) houseArt.src = MANIFEST.houseTiers[previousTier - 1].src;
    else house.style.opacity = '0';
    // The page's own header pill is the visible wallet here (the home shell's
    // pill sits behind the page), so the coins leave from it and it counts down.
    const pill = page.querySelector<HTMLElement>('.shop-header-coin-pill');
    animateCoinsToBalance({
      amount: price,
      source: pill,
      target: house,
      owner: scene,
      countElement: pill?.querySelector<HTMLElement>('.shop-header-coin-count') ?? null,
      fromValue: before,
      toValue: before - price,
    }).then(reveal, reveal);
  };

  /**
   * The one persistent action: build when there is no house, upgrade until
   * the top tier, nothing at the top. Always visible, never behind a sheet.
   */
  const renderActions = (): void => {
    const bar = page.querySelector<HTMLElement>('#sanctuary-actions');
    if (bar === null) return;
    const tier = gameState.sanctuary.houseTier;
    if (tier >= MAX_HOUSE_TIER) { bar.innerHTML = ''; return; }
    const next = (tier + 1) as SanctuaryHouseTier;
    const price = housePrice(next);
    const affordable = gameState.coinBalance >= price;
    const verb = tier === 0 ? 'Build nest box' : 'Upgrade nest box';
    bar.innerHTML = `
      <button class="sanctuary-pill sanctuary-pill--primary sanctuary-action${affordable ? '' : ' sanctuary-action--short'}" type="button">
        <span class="sanctuary-action-verb">${verb}</span>
        <span class="sanctuary-action-price"><img src="/ui/menu-icons/icon_coin.png" alt="" aria-hidden="true">${price}</span>
      </button>`;
    bar.querySelector<HTMLButtonElement>('.sanctuary-action')?.addEventListener('click', () => {
      playUITap();
      if (affordable) { buy(next); return; }
      // Not enough coins is a shop trip, not a dead end.
      openPage('shop', { scrollTo: 'coins' });
    });
  };

  const offerPlacement = (pedestalIndex: number): void => {
    const unlocked = clampRung(gameState.collectionMeta.claimedRung) >= 1;
    const elsewhere = Object.values(gameState.sanctuary.placed).includes('sparrow');
    showSheet(sheetRoot, {
      title: unlocked ? (elsewhere ? 'Move Chirpy here?' : 'Who moves in?') : 'No bird yet',
      portrait: unlocked ? '/ui/collection/portrait-sparrow-plain.webp' : '/ui/collection/portrait-sparrow-silhouette.webp',
      facts: unlocked ? ['Chirpy', 'House Sparrow'] : ['Unlock Chirpy in the Collection'],
      actions: [
        {
          label: unlocked ? (elsewhere ? 'Move Chirpy' : 'Place Chirpy') : 'Go to Collection',
          kind: 'primary',
          onTap: () => {
            if (!unlocked) { openPage('collection'); return; }
            if (!gameState.placeBird(pedestalIndex, 'sparrow', new Date(now()))) return;
            closeSheet(sheetRoot);
            render();
            const placed = layer.querySelector<HTMLElement>(`.sanctuary-pedestal[data-pedestal="${pedestalIndex}"]`);
            if (placed === null) return;
            dropIn(placed);
            const shadow = placed.previousElementSibling;
            if (shadow instanceof HTMLElement && shadow.classList.contains('sanctuary-shadow')) shadowLand(shadow);
            playBirdPlace();
            hapticFound();
            // Feathers and dust at the FEET (the inline offset puts them at
            // footFraction across the slot), timed to the landing at 50%.
            const rect = placed.getBoundingClientRect();
            const foot = MANIFEST.birdFootCenterX?.[currentCostume()] ?? 0.5;
            const feet = { x: rect.left + rect.width * foot, y: rect.bottom - 2 };
            nudge(scene, centerOf(placed), 0.025);
            burst(feet, 'puff', { delay: 230, radius: 46, count: 7 });
            burst({ x: feet.x, y: rect.top + rect.height * 0.45 }, 'feather', { delay: 200, radius: 60, count: 7 });
            burst({ x: feet.x, y: rect.top + rect.height * 0.4 }, 'sparkle', { delay: 300, radius: 70, count: 8 });
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
