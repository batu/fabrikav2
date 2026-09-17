/**
 * The Collection deck: one near-full-screen card per species, swiped
 * horizontally.
 *
 * Layout is scroll-snap rather than a custom gesture handler — the platform
 * already knows how to make a swipe feel right, and a hand-rolled drag would
 * fight the page's own vertical scroll and the back-swipe edge gesture.
 *
 * All geometry (the porthole the portrait is clipped to, where the plaque,
 * ribbon and bubble sit) is expressed as percentages of the card art, taken
 * from the asset manifest, so the card scales to any phone without the text
 * drifting off its woodwork.
 */

import manifestJson from '../../public/ui/sanctuary/manifest.json';
import { fitBackground, type Rect, type SanctuaryManifest } from '../sanctuary/layout';
import { refreshMetaNav, updateSparrowCounter } from './HUD';
import { shakeLockedNavButton } from './homeNavigation';
import { playCollectionClaim, playFind, playUITap, preloadMetaSounds } from '../audio/AudioManager';
import { centerOf, nudge } from './juice';
import { hapticFound } from '../haptics/HapticsManager';
import { analytics } from '../analytics/AnalyticsService';
import { gameState } from '../core/GameState';
import { allCardInputs, focusBird } from '../collection/ladders';
import { BIRD_DEFS } from '../collection/birds';
import { collectionDeck, HIDDEN_LINE, type CardFrame, type CardViewModel } from '../collection/cardModel';
import { CARD_STATE_ORDER, type CardState } from '../collection/thresholds';

/**
 * Card frame geometry, measured from the art on a 900x1500 canvas (both frames
 * are normalised onto it, see docs/evidence). Two frames: the sparrow's own,
 * and the plain locked one shared by the silhouette state and the ? card.
 * Every slot is a band or box in canvas pixels; the renderer turns them into
 * percentages so the card scales without the text leaving its woodwork.
 */
interface FrameGeometry {
  src: string;
  width: number;
  height: number;
  /** The arch window: a square with a semicircular top, inner edges. */
  arch: { x: number; y: number; w: number; h: number };
  plaqueY: readonly [number, number];
  subtitleY: readonly [number, number];
  /** Text-safe box inside the sentence panel (keeps clear of corner ornament). */
  panel: { x: readonly [number, number]; y: readonly [number, number] };
  /** Portrait sizing inside the arch. */
  portraitStyle: string;
  /** A part of the frame that must draw OVER the portrait (the locked frame's
   *  padlock bump), as a clip box in canvas pixels. */
  overlay?: { x: readonly [number, number]; y: readonly [number, number] };
}

const FRAMES: Record<CardFrame, FrameGeometry> = {
  sparrow: {
    src: '/ui/collection/frame-sparrow.webp',
    width: 900,
    height: 1500,
    arch: { x: 108, y: 105, w: 688, h: 643 },
    plaqueY: [828, 955],
    subtitleY: [1008, 1105],
    // Copy is centred in the panel; the snail only touches the far right of
    // the last line's row, which centred text never reaches.
    panel: { x: [125, 775], y: [1165, 1385] },
    portraitStyle: 'height:97%;width:auto;bottom:-4%',
  },
  robin: {
    src: '/ui/collection/frame-robin.webp',
    width: 900,
    height: 1500,
    arch: { x: 110, y: 200, w: 680, h: 600 },
    plaqueY: [865, 975],
    subtitleY: [1010, 1085],
    panel: { x: [150, 750], y: [1140, 1360] },
    portraitStyle: 'height:92%;width:auto;bottom:-2%',
  },
  bluebird: {
    src: '/ui/collection/frame-bluebird.webp',
    width: 900,
    height: 1500,
    arch: { x: 110, y: 210, w: 680, h: 635 },
    plaqueY: [915, 1010],
    subtitleY: [1030, 1110],
    panel: { x: [140, 760], y: [1150, 1360] },
    portraitStyle: 'height:92%;width:auto;bottom:-2%',
  },
  locked: {
    src: '/ui/collection/frame-locked.webp',
    width: 900,
    height: 1500,
    arch: { x: 150, y: 110, w: 600, h: 650 },
    plaqueY: [845, 955],
    subtitleY: [985, 1075],
    panel: { x: [120, 780], y: [1125, 1385] },
    // The bird sits on the arch's floor and the padlock bump covers its feet.
    portraitStyle: 'height:90%;width:auto;bottom:-1%',
    overlay: { x: [360, 540], y: [680, 810] },
  },
};

const pct = (value: number, of: number): string => `${((value / of) * 100).toFixed(4)}%`;

function frameFor(card: CardViewModel): FrameGeometry {
  return FRAMES[card.frame];
}

/**
 * The arch is an overflow-hidden box placed exactly over the window, with its
 * top corners rounded by half the window's width so the clip is a true
 * semicircle on a square. The portrait sits inside and can be sized freely.
 */
function archStyle(f: FrameGeometry): string {
  const { x, y, w, h } = f.arch;
  const radius = ((w / 2) / h) * 100;
  return [
    `left:${pct(x, f.width)}`, `top:${pct(y, f.height)}`,
    `width:${pct(w, f.width)}`, `height:${pct(h, f.height)}`,
    `border-radius:50% 50% 0 0 / ${radius.toFixed(3)}% ${radius.toFixed(3)}% 0 0`,
  ].join(';');
}

function bandStyle(f: FrameGeometry, band: readonly [number, number], x: readonly [number, number] = [90, 810]): string {
  return [
    `left:${pct(x[0], f.width)}`, `right:${pct(f.width - x[1], f.width)}`,
    `top:${pct(band[0], f.height)}`, `height:${pct(band[1] - band[0], f.height)}`,
  ].join(';');
}

/**
 * Portrait inside the arch, sized to FIT the window's height rather than fill
 * its width, so the taller costumes keep the beanie's pom-pom. A small
 * negative bottom keeps the chest running down into the sill.
 */

function renderCard(card: CardViewModel, index: number): string {
  const f = frameFor(card);
  // Hidden copy shows a padlock, not dashes: the panel is something that
  // unlocks, and the lock says so where blanks only said "nothing here".
  const hidden = card.lines.every((line) => line === HIDDEN_LINE);
  const lines = hidden
    ? '<img class="collection-line-lock" src="/ui/sanctuary/padlock.png" alt="" aria-hidden="true">'
    : card.lines.map((line) => `<span class="collection-line">${line}</span>`).join('');
  // The meter lives under the card, not on it: the card stays art, the bar is
  // the deck's chrome, and the Unlock button takes the same slot when a rung
  // is ready.
  const meter = card.claimable && card.progress !== null
    ? `<button class="collection-unlock-btn" type="button" data-claim-rung="${CARD_STATE_ORDER.indexOf(card.state as CardState) + 1}">Unlock ${card.progress.label === 'Unlock' ? (card.bird ? BIRD_DEFS[card.bird].tabLabels[1] : 'Bird') : card.progress.label}</button>`
    : card.progress === null
      ? (card.kind === 'sparrow' && !card.locked
        ? '<div class="collection-meter collection-meter--done" role="group" aria-label="Complete"><span class="collection-meter-text">Complete</span></div>'
        : '<div class="collection-meter collection-meter--empty" aria-hidden="true"></div>')
      : `
      <div class="collection-meter" role="group" aria-label="${card.progress.label} progress">
        <span class="collection-meter-fill" style="width:${(card.progress.fraction * 100).toFixed(2)}%"></span>
        <span class="collection-meter-text">${card.progress.current} / ${card.progress.target}</span>
      </div>`;
  return `
    <li class="collection-slide" data-card-index="${index}">
      <article class="collection-card${card.locked ? ' collection-card--locked' : ''}" data-card-kind="${card.kind}"${card.bird ? ` data-bird="${card.bird}"` : ''} data-card-state="${card.state}" aria-label="${card.ariaLabel}">
        <img class="collection-card-frame" src="${f.src}" alt="" aria-hidden="true">
        <span class="collection-card-arch" style="${archStyle(f)}" aria-hidden="true">
          ${card.portraitSrc === '' ? '' : `<img class="collection-card-portrait" src="${card.portraitSrc}" alt="" style="${card.portraitStyle ?? f.portraitStyle}">`}
        </span>
        ${f.overlay ? `<img class="collection-card-frame collection-card-frame--over" src="${f.src}" alt="" aria-hidden="true" style="clip-path:inset(${pct(f.overlay.y[0], f.height)} ${pct(f.width - f.overlay.x[1], f.width)} ${pct(f.height - f.overlay.y[1], f.height)} ${pct(f.overlay.x[0], f.width)})">` : ''}
        ${card.tabs.length === 0 ? '' : `<div class="collection-tabs" role="tablist" aria-label="Sparrow looks">
          ${card.tabs.map((tab) => `<button class="collection-tab${tab.unlocked ? ' collection-tab--open' : ' collection-tab--locked'}${tab.selected ? ' collection-tab--selected' : ''}" type="button" role="tab" data-rung="${tab.rung}" aria-selected="${tab.selected ? 'true' : 'false'}" aria-label="${tab.label}${tab.unlocked ? '' : ', locked'}"${tab.unlocked ? '' : ' aria-disabled="true"'}>${tab.unlocked ? `<img class="collection-tab-icon" src="${tab.icon}" alt="" aria-hidden="true">` : ''}</button>`).join('')}
        </div>`}
        <div class="collection-card-text">
          <p class="collection-plaque" style="${bandStyle(f, f.plaqueY)}">${card.plaque}</p>
          <p class="collection-ribbon" style="${bandStyle(f, f.subtitleY, [120, 780])}">${card.ribbon}</p>
          <div class="collection-bubble" style="${bandStyle(f, f.panel.y, f.panel.x)}">${lines}</div>
        </div>
      </article>
      ${meter}
    </li>`;
}

const SANCTUARY_MANIFEST = (manifestJson as unknown as { sanctuary: SanctuaryManifest }).sanctuary;

function applyRect(element: HTMLElement, rect: Rect): void {
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

/**
 * The deck sits on the Sanctuary's backdrop, placed by the Sanctuary's own
 * cover-fit so the tree does not shift when the player crosses between the
 * two pages: same image, same viewport, same rect.
 */
function placeBackdrop(page: ParentNode): void {
  const holder = page.querySelector<HTMLElement>('.collection-backdrop');
  const image = page.querySelector<HTMLImageElement>('#collection-bg');
  if (holder === null || image === null) return;
  const place = (): void => {
    const viewport = { width: holder.clientWidth, height: holder.clientHeight };
    if (viewport.width === 0 || viewport.height === 0) return;
    applyRect(image, fitBackground(SANCTUARY_MANIFEST, viewport).rect);
  };
  place();
  requestAnimationFrame(place);
  window.addEventListener('resize', place, { passive: true });
}

export function renderCollectionPageBody(): string {
  const cards = collectionDeck(allCardInputs());
  const dots = cards
    .map((_, index) => `<span class="collection-dot${index === 0 ? ' collection-dot--active' : ''}" data-dot-index="${index}"></span>`)
    .join('');
  return `
    <div class="collection-backdrop" aria-hidden="true">
      <img class="sanctuary-bg" id="collection-bg" src="${SANCTUARY_MANIFEST.background.src}" alt="">
    </div>
    <section class="collection-deck-wrap">
      <ul class="collection-deck" id="collection-deck" tabindex="0" aria-label="Bird collection, swipe to browse">
        ${cards.map(renderCard).join('')}
      </ul>
      <div class="collection-dots" id="collection-dots" aria-hidden="true">${dots}</div>
    </section>
  `;
}

/**
 * Which card the deck is on, read from its scroll position: correct for a
 * flick, a slow drag, a snap-back and a keyboard scroll alike, with no gesture
 * state of its own. The dots and the rung tabs both follow this one reading, so
 * they can never disagree about which card is open.
 */
function syncDeck(deck: HTMLElement): void {
  const slides = [...deck.querySelectorAll<HTMLElement>('.collection-slide')];
  const slideWidth = slides[0]?.offsetWidth ?? deck.clientWidth;
  if (slides.length === 0 || slideWidth === 0) return;
  const index = Math.max(0, Math.min(slides.length - 1, Math.round(deck.scrollLeft / slideWidth)));
  slides.forEach((slide, i) => { slide.classList.toggle('collection-slide--current', i === index); });
  const dots = deck.parentElement?.querySelectorAll<HTMLElement>('.collection-dot') ?? [];
  dots.forEach((dot, i) => { dot.classList.toggle('collection-dot--active', i === index); });
}

/**
 * Open the deck on the bird the game is talking about. The counter that brings
 * the player here talks about one bird — a rung that is ready, else the one
 * closest to ready — so landing on the first card makes them go hunting for it.
 * Page-open only: after a claim the deck redraws in place and must stay where
 * the player left it.
 */
export function focusCollectionDeck(page: ParentNode): void {
  const focus = focusBird();
  const deck = page.querySelector<HTMLElement>('#collection-deck');
  if (focus === null || deck === null) return;
  const slides = [...deck.querySelectorAll<HTMLElement>('.collection-slide')];
  const index = slides.findIndex((slide) => slide.querySelector(`.collection-card[data-bird="${focus.bird}"]`) !== null);
  const slideWidth = slides[0]?.offsetWidth ?? 0;
  if (index <= 0 || slideWidth === 0) return;
  // Set the deck's own scroll rather than calling scrollIntoView on the card.
  // scrollIntoView walks every scrollable ancestor, and an overflow-hidden one
  // still scrolls when script asks: it dragged the whole page overlay 280px up
  // the screen. This can only move the deck, and it jumps rather than gliding
  // through the cards in between while the page is still sliding in.
  deck.scrollLeft = index * slideWidth;
  syncDeck(deck);
}

export function wireCollectionPage(page: ParentNode): void {
  placeBackdrop(page);
  preloadMetaSounds();
  const deck = page.querySelector<HTMLElement>('#collection-deck');
  const dots = [...page.querySelectorAll<HTMLElement>('.collection-dot')];
  if (deck === null || dots.length === 0) return;

  let frame = 0;
  const sync = (): void => { frame = 0; syncDeck(deck); };
  deck.addEventListener('scroll', () => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(sync);
  }, { passive: true });
  // Mark the current card before the first paint, so its tabs render already
  // out instead of sliding in from nowhere; the frame after covers the case
  // where the deck has no layout yet.
  syncDeck(deck);
  requestAnimationFrame(sync);

  // Claiming a rung: persist, redraw the deck in place, then flip and flare
  // the card so the new art arrives as a reward rather than a refresh.
  const redraw = (bird: string): HTMLElement | null => {
    const body = page.querySelector<HTMLElement>('.home-page-body');
    if (body === null) return null;
    const scrollLeft = deck.scrollLeft;
    body.innerHTML = renderCollectionPageBody();
    // Restore the scroll BEFORE wiring: wiring marks the current card, and a
    // deck still reading 0 would mark the first one and flash its tabs out.
    const freshDeck = page.querySelector<HTMLElement>('#collection-deck');
    if (freshDeck !== null) freshDeck.scrollLeft = scrollLeft;
    wireCollectionPage(page);
    return page.querySelector<HTMLElement>(`.collection-card[data-bird="${bird}"]`);
  };

  // Tabs: an open tab picks the look the card (and the Sanctuary) shows.
  const birdOf = (el: Element): string => el.closest<HTMLElement>('.collection-card')?.dataset.bird ?? 'sparrow';
  for (const tab of page.querySelectorAll<HTMLButtonElement>('.collection-tab--open')) {
    tab.addEventListener('click', () => {
      playUITap();
      const bird = birdOf(tab);
      if (!gameState.selectCollectionRung(Number(tab.dataset.rung), bird)) return;
      const card = redraw(bird);
      card?.querySelector('.collection-card-arch')?.classList.add('collection-arch--swap');
    });
  }
  for (const tab of page.querySelectorAll<HTMLButtonElement>('.collection-tab--locked')) {
    tab.addEventListener('click', () => { shakeLockedNavButton(tab); });
  }

  for (const button of page.querySelectorAll<HTMLButtonElement>('.collection-unlock-btn')) button.addEventListener('click', () => {
    const rung = Number(button.dataset.claimRung);
    const bird = button.closest<HTMLElement>('.collection-slide')?.querySelector<HTMLElement>('.collection-card')?.dataset.bird ?? 'sparrow';
    playUITap();
    if (!gameState.claimCollectionRung(rung, bird)) return;
    void analytics.birdCollected({ bird_type: bird, level_id: `claim:${String(rung)}`, total: gameState.birdCount(bird) });
    const sparrow = redraw(bird);
    if (sparrow === null) return;
    // Measure BEFORE the reveal starts: its first frame is rotateY(-90deg),
    // where the card's box has no width and a burst has nowhere to come from.
    const cardCenter = centerOf(sparrow);
    sparrow.classList.add('collection-card--reveal', 'collection-card--claimed');
    sparrow.querySelector(`.collection-tab[data-rung="${String(rung)}"]`)?.classList.add('collection-tab--pop');
    // The chime lands with the tap; confetti and the chirp arrive as the flip
    // settles (~60% of the 620ms reveal), so the new art is what gets cheered.
    playCollectionClaim();
    hapticFound();
    const deckWrap = page.querySelector<HTMLElement>('.collection-deck-wrap');
    if (deckWrap !== null && cardCenter !== null) nudge(deckWrap, cardCenter, 0.03);
    window.setTimeout(playFind, 380);
    refreshMetaNav();
    updateSparrowCounter();
  });
}
