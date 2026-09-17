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
import { playFind, playUITap } from '../audio/AudioManager';
import { hapticFound } from '../haptics/HapticsManager';
import { analytics } from '../analytics/AnalyticsService';
import { gameState } from '../core/GameState';
import { collectionTeaseCount, collectionThresholds } from '../collection/config';
import { collectionDeck, HIDDEN_LINE, type CardFrame, type CardViewModel } from '../collection/cardModel';
import { CARD_STATE_ORDER, clampRung, type CardState } from '../collection/thresholds';

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
    // The snail sits in the panel's bottom-right; copy stays above it.
    panel: { x: [125, 775], y: [1150, 1315] },
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
    ? `<button class="collection-unlock-btn" type="button" data-claim-rung="${CARD_STATE_ORDER.indexOf(card.state as CardState) + 1}">Unlock ${card.progress.label === 'Unlock' ? 'Sparrow' : card.progress.label}</button>`
    : card.progress === null
      ? (card.kind === 'sparrow' && !card.locked
        ? '<div class="collection-meter collection-meter--done" role="group" aria-label="Complete"><span class="collection-meter-text">Complete</span></div>'
        : '<div class="collection-meter collection-meter--empty" aria-hidden="true"></div>')
      : `
      <div class="collection-meter" role="group" aria-label="${card.progress.label} progress">
        <span class="collection-meter-fill" style="width:${(card.progress.fraction * 100).toFixed(2)}%"></span>
        <span class="collection-meter-text"><b>${card.progress.label}</b> ${card.progress.current} / ${card.progress.target}</span>
      </div>`;
  return `
    <li class="collection-slide" data-card-index="${index}">
      <article class="collection-card${card.locked ? ' collection-card--locked' : ''}" data-card-kind="${card.kind}" data-card-state="${card.state}" aria-label="${card.ariaLabel}">
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
  const cards = collectionDeck({
    count: gameState.birdCount('sparrow'),
    thresholds: collectionThresholds(),
    claimed: clampRung(gameState.collectionMeta.claimedRung),
    selected: gameState.collectionMeta.selectedRung,
    teaseCount: collectionTeaseCount(),
  });
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
 * Bind the dots to the deck's own scroll position rather than to swipe events:
 * it stays correct for a flick, a slow drag, a snap-back and a keyboard scroll
 * alike, and needs no gesture state of its own.
 */
export function wireCollectionPage(page: ParentNode): void {
  placeBackdrop(page);
  const deck = page.querySelector<HTMLElement>('#collection-deck');
  const dots = [...page.querySelectorAll<HTMLElement>('.collection-dot')];
  if (deck === null || dots.length === 0) return;

  let frame = 0;
  const sync = (): void => {
    frame = 0;
    const slideWidth = deck.querySelector<HTMLElement>('.collection-slide')?.offsetWidth ?? deck.clientWidth;
    if (slideWidth === 0) return;
    const index = Math.max(0, Math.min(dots.length - 1, Math.round(deck.scrollLeft / slideWidth)));
    dots.forEach((dot, i) => { dot.classList.toggle('collection-dot--active', i === index); });
  };
  deck.addEventListener('scroll', () => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(sync);
  }, { passive: true });

  // Claiming a rung: persist, redraw the deck in place, then flip and flare
  // the card so the new art arrives as a reward rather than a refresh.
  const redraw = (): HTMLElement | null => {
    const body = page.querySelector<HTMLElement>('.home-page-body');
    if (body === null) return null;
    const scrollLeft = deck.scrollLeft;
    body.innerHTML = renderCollectionPageBody();
    wireCollectionPage(page);
    const freshDeck = page.querySelector<HTMLElement>('#collection-deck');
    if (freshDeck !== null) freshDeck.scrollLeft = scrollLeft;
    return page.querySelector<HTMLElement>('.collection-card[data-card-kind="sparrow"]');
  };

  // Tabs: an open tab picks the look the card (and the Sanctuary) shows.
  for (const tab of page.querySelectorAll<HTMLButtonElement>('.collection-tab--open')) {
    tab.addEventListener('click', () => {
      playUITap();
      if (!gameState.selectCollectionRung(Number(tab.dataset.rung))) return;
      const sparrow = redraw();
      sparrow?.querySelector('.collection-card-arch')?.classList.add('collection-arch--swap');
    });
  }
  for (const tab of page.querySelectorAll<HTMLButtonElement>('.collection-tab--locked')) {
    tab.addEventListener('click', () => { shakeLockedNavButton(tab); });
  }

  page.querySelector<HTMLButtonElement>('.collection-unlock-btn')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const rung = Number(button.dataset.claimRung);
    playUITap();
    if (!gameState.claimCollectionRung(rung)) return;
    void analytics.birdCollected({ bird_type: 'sparrow', level_id: `claim:${String(rung)}`, total: gameState.birdCount('sparrow') });
    const sparrow = redraw();
    if (sparrow === null) return;
    sparrow.classList.add('collection-card--reveal', 'collection-card--claimed');
    sparrow.querySelector(`.collection-tab[data-rung="${String(rung)}"]`)?.classList.add('collection-tab--pop');
    playFind();
    hapticFound();
    refreshMetaNav();
    updateSparrowCounter();
  });
}
