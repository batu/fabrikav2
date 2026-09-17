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
import { playFind, playUITap } from '../audio/AudioManager';
import { hapticFound } from '../haptics/HapticsManager';
import { analytics } from '../analytics/AnalyticsService';
import { gameState } from '../core/GameState';
import { collectionThresholds } from '../collection/config';
import { collectionDeck, type CardViewModel } from '../collection/cardModel';
import { CARD_STATE_ORDER, clampRung, type CardState } from '../collection/thresholds';

/** Card art geometry, mirroring public/ui/sanctuary/manifest.json. */
const CARD = {
  width: 1024,
  height: 1536,
  porthole: { cx: 488, cy: 410, r: 276 },
  // Measured from the card art, not estimated: the first guesses put the name
  // on the ribbon and the copy off the bottom of the card on device.
  plaqueY: [700, 855] as const,
  ribbonY: [860, 958] as const,
  bubbleY: [988, 1207] as const,
} as const;

const pct = (value: number, of: number): string => `${((value / of) * 100).toFixed(4)}%`;

/**
 * The porthole is a circular window cut in the card art. Rather than clipping
 * the portrait in its own coordinate space, place a round, overflow-hidden box
 * exactly over the hole and let the portrait sit inside it: the bird can then
 * be sized and nudged freely (a hat grows the sprite) without any risk of it
 * spilling over the wooden ring.
 */
function portholeStyle(): string {
  const { cx, cy, r } = CARD.porthole;
  return [
    `left:${pct(cx - r, CARD.width)}`,
    `top:${pct(cy - r, CARD.height)}`,
    `width:${pct(r * 2, CARD.width)}`,
    `height:${pct(r * 2, CARD.height)}`,
  ].join(';');
}

/**
 * Portrait inside the porthole, sized to FIT the circle rather than fill its
 * width. Filling the width overflowed the top for the taller costumes and cut
 * the beanie's pom-pom off, losing the very detail the costume is read by.
 * A small negative bottom keeps the chest running down into the hole.
 */
const PORTRAIT_STYLE = 'height:97%;width:auto;bottom:-4%';

function renderCard(card: CardViewModel, index: number): string {
  const lines = card.lines
    .map((line) => `<span class="collection-line">${line}</span>`)
    .join('');
  const progress = card.claimable && card.progress !== null
    ? `<button class="collection-unlock-btn" type="button" data-claim-rung="${CARD_STATE_ORDER.indexOf(card.state as CardState) + 1}">Unlock ${card.progress.label === 'Unlock' ? 'Sparrow' : card.progress.label}</button>`
    : card.progress === null
    ? (card.kind === 'sparrow'
      ? '<p class="collection-progress collection-progress--done">Complete</p>'
      : '')
    : `
      <div class="collection-progress" role="group" aria-label="${card.progress.label} progress">
        <span class="collection-progress-label">${card.progress.label}</span>
        <span class="collection-progress-track"><span class="collection-progress-fill" style="width:${(card.progress.fraction * 100).toFixed(2)}%"></span></span>
        <span class="collection-progress-count">${card.progress.current} / ${card.progress.target}</span>
      </div>`;
  return `
    <li class="collection-slide" data-card-index="${index}">
      <article class="collection-card${card.locked ? ' collection-card--locked' : ''}" data-card-kind="${card.kind}" data-card-state="${card.state}" aria-label="${card.ariaLabel}">
        <img class="collection-card-frame" src="/ui/collection/card-frame.webp" alt="" aria-hidden="true">
        <span class="collection-card-porthole" style="${portholeStyle()}" aria-hidden="true">
          <img class="collection-card-portrait" src="${card.portraitSrc}" alt="" style="${PORTRAIT_STYLE}">
        </span>
        ${card.locked ? '<img class="collection-card-lock" src="/ui/sanctuary/padlock.png" alt="" aria-hidden="true">' : ''}
        <div class="collection-card-text">
          <p class="collection-plaque">${card.plaque}</p>
          <p class="collection-ribbon">${card.ribbon}</p>
          <div class="collection-bubble">${lines}</div>
          ${progress}
        </div>
      </article>
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
  const cards = collectionDeck(gameState.birdCount('sparrow'), collectionThresholds(), clampRung(gameState.collectionMeta.claimedRung));
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
  page.querySelector<HTMLButtonElement>('.collection-unlock-btn')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const rung = Number(button.dataset.claimRung);
    playUITap();
    if (!gameState.claimCollectionRung(rung)) return;
    void analytics.birdCollected({ bird_type: 'sparrow', level_id: `claim:${String(rung)}`, total: gameState.birdCount('sparrow') });
    const body = page.querySelector<HTMLElement>('.home-page-body');
    if (body === null) return;
    const scrollLeft = deck.scrollLeft;
    body.innerHTML = renderCollectionPageBody();
    wireCollectionPage(page);
    const freshDeck = page.querySelector<HTMLElement>('#collection-deck');
    if (freshDeck !== null) freshDeck.scrollLeft = scrollLeft;
    const sparrow = page.querySelector<HTMLElement>('.collection-card[data-card-kind="sparrow"]');
    sparrow?.classList.add('collection-card--reveal', 'collection-card--claimed');
    playFind();
    hapticFound();
    refreshMetaNav();
    updateSparrowCounter();
  });
}
