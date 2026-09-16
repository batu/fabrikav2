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

import { gameState } from '../core/GameState';
import { collectionThresholds } from '../collection/config';
import { collectionDeck, type CardViewModel } from '../collection/cardModel';
import { cardState } from '../collection/thresholds';

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

/** Portrait inside the porthole: 98% of its width, feet 0.1r below the rim so
 *  the body reads as continuing down into the hole. */
const PORTRAIT_STYLE = 'width:98%;bottom:-5%';

function renderCard(card: CardViewModel, index: number): string {
  const lines = card.lines
    .map((line) => `<span class="collection-line">${line}</span>`)
    .join('');
  const progress = card.progress === null
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

export function renderCollectionPageBody(): string {
  const cards = collectionDeck(gameState.birdCount('sparrow'), collectionThresholds());
  const dots = cards
    .map((_, index) => `<span class="collection-dot${index === 0 ? ' collection-dot--active' : ''}" data-dot-index="${index}"></span>`)
    .join('');
  return `
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
  const deck = page.querySelector<HTMLElement>('#collection-deck');
  const dots = [...page.querySelectorAll<HTMLElement>('.collection-dot')];
  if (deck === null || dots.length === 0) return;

  let frame = 0;
  const sync = (): void => {
    frame = 0;
    const slideWidth = deck.clientWidth;
    if (slideWidth === 0) return;
    const index = Math.max(0, Math.min(dots.length - 1, Math.round(deck.scrollLeft / slideWidth)));
    dots.forEach((dot, i) => { dot.classList.toggle('collection-dot--active', i === index); });
  };
  deck.addEventListener('scroll', () => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(sync);
  }, { passive: true });

  // First reveal of the unlocked bird: flip the card once, then persist so the
  // next visit opens calm.
  const sparrow = page.querySelector<HTMLElement>('.collection-card[data-card-kind="sparrow"]');
  const unlocked = cardState(gameState.birdCount('sparrow'), collectionThresholds()) !== 'silhouette';
  if (sparrow !== null && unlocked && !gameState.collectionMeta.plainFlipShown) {
    sparrow.classList.add('collection-card--reveal');
    gameState.markPlainFlipShown();
  }
}
