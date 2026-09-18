import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

// happy-dom has no AudioContext; wiring the page preloads the meta SFX.
vi.mock('../../src/audio/AudioManager', () => ({
  playCollectionClaim: vi.fn(), playFind: vi.fn(), playUITap: vi.fn(), preloadMetaSounds: vi.fn(),
}));
vi.mock('../../src/haptics/HapticsManager', () => ({ hapticFound: vi.fn() }));

import { installMemStorage, removeMemStorage } from './support/memStorage';
import { gameState } from '../../src/core/GameState';
import { renderCollectionPageBody, wireCollectionPage } from '../../src/ui/CollectionPage';
import { collectionThresholds } from '../../src/collection/config';
import { BIRDS } from '../../src/collection/birds';

const T = collectionThresholds('sparrow');

function mount(): HTMLElement {
  const host = document.createElement('div');
  // wireCollectionPage redraws into a `.home-page-body` DESCENDANT after a
  // claim, so the mount mirrors the real page's wrapper rather than a bare div.
  host.innerHTML = `<div class="home-page-body">${renderCollectionPageBody()}</div>`;
  document.body.appendChild(host);
  return host;
}

function sparrowSlide(host: HTMLElement): HTMLElement {
  const slide = host.querySelector<HTMLElement>('.collection-slide:has(.collection-card[data-bird="sparrow"])');
  expect(slide).not.toBeNull();
  return slide as HTMLElement;
}

describe('collection page', () => {
  beforeEach(() => {
    installMemStorage();
    gameState.load();
    gameState.setBirdCountForTest('sparrow', 0);
    gameState.setClaimedRungForTest(0, 'sparrow');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    removeMemStorage();
  });

  it('renders one slide per bird plus the ? card, with one dot each', () => {
    // The deck grew from the sparrow + ? pair to all three birds + ?.
    const host = mount();
    const expected = BIRDS.length + 1;
    expect(host.querySelectorAll('.collection-slide')).toHaveLength(expected);
    expect(host.querySelectorAll('.collection-dot')).toHaveLength(expected);
    expect(host.querySelector('.collection-dot')?.classList.contains('collection-dot--active')).toBe(true);
  });

  it('shows the sparrow locked, with hidden copy and a padlock, at zero', () => {
    const host = mount();
    const card = host.querySelector<HTMLElement>('.collection-card[data-bird="sparrow"]');
    expect(card?.dataset.cardState).toBe('silhouette');
    expect(card?.classList.contains('collection-card--locked')).toBe(true);
    expect(card?.querySelector('.collection-plaque')?.textContent).toBe('? ? ?');
    // Hidden copy is a padlock in the panel now, not dashes on the card.
    expect(card?.querySelector('.collection-line-lock')).not.toBeNull();
    expect(card?.querySelector('.collection-line')).toBeNull();
  });

  it('shows progress towards the unlock threshold', () => {
    // The meter lives under the card as deck chrome; it counts inside the
    // current rung, which for rung 1 runs from zero.
    gameState.setBirdCountForTest('sparrow', T.unlock - 2);
    const host = mount();
    const meter = sparrowSlide(host).querySelector<HTMLElement>('.collection-meter');
    expect(meter?.querySelector('.collection-meter-text')?.textContent).toBe(`${T.unlock - 2} / ${T.unlock}`);
    expect(meter?.getAttribute('aria-label')).toBe('Unlock progress');
  });

  it('offers the Unlock button instead of a meter once the rung is earned', () => {
    gameState.setBirdCountForTest('sparrow', T.unlock);
    const host = mount();
    const slide = sparrowSlide(host);
    expect(slide.querySelector('.collection-meter')).toBeNull();
    expect(slide.querySelector('.collection-unlock-btn')?.getAttribute('data-claim-rung')).toBe('1');
    // Still locked: a rung is a reward the player opens.
    expect(slide.querySelector('.collection-card')?.classList.contains('collection-card--locked')).toBe(true);
  });

  it('reveals the bird and its name once rung 1 is claimed', () => {
    gameState.setBirdCountForTest('sparrow', T.unlock);
    gameState.setClaimedRungForTest(1, 'sparrow');
    const host = mount();
    const card = host.querySelector<HTMLElement>('.collection-card[data-bird="sparrow"]');
    expect(card?.dataset.cardState).toBe('plain');
    expect(card?.classList.contains('collection-card--locked')).toBe(false);
    expect(card?.querySelector('.collection-plaque')?.textContent).toBe('Chirpy');
    expect(card?.querySelector('.collection-line-lock')).not.toBeNull(); // copy waits for rung 2
    expect(sparrowSlide(host).querySelector('.collection-meter')?.getAttribute('aria-label')).toBe('Hat progress');
  });

  it('swaps the portrait for each claimed costume', () => {
    gameState.setBirdCountForTest('sparrow', T.hat);
    gameState.setClaimedRungForTest(2, 'sparrow');
    expect(mount().querySelector<HTMLImageElement>('.collection-card[data-bird="sparrow"] .collection-card-portrait')?.src)
      .toContain('portrait-sparrow-hat');
    document.body.innerHTML = '';
    gameState.setBirdCountForTest('sparrow', T.cardigan);
    gameState.setClaimedRungForTest(3, 'sparrow');
    expect(mount().querySelector<HTMLImageElement>('.collection-card[data-bird="sparrow"] .collection-card-portrait')?.src)
      .toContain('portrait-sparrow-cardigan');
  });

  it('reports the finished card as complete', () => {
    gameState.setBirdCountForTest('sparrow', T.cardigan);
    gameState.setClaimedRungForTest(3, 'sparrow');
    const host = mount();
    expect(sparrowSlide(host).querySelector('.collection-meter--done')?.textContent).toBe('Complete');
  });

  it('always keeps the ? card locked, bare and with nothing to claim', () => {
    gameState.setBirdCountForTest('sparrow', 999);
    const host = mount();
    const slide = host.querySelector<HTMLElement>('.collection-slide:has(.collection-card[data-card-kind="unknown"])');
    expect(slide?.querySelector('.collection-card')?.classList.contains('collection-card--locked')).toBe(true);
    expect(slide?.querySelector('.collection-unlock-btn')).toBeNull();
    // Deliberately bare: empty arch, no species ribbon, no portrait.
    expect(slide?.querySelector('.collection-ribbon')?.textContent).toBe('');
    expect(slide?.querySelector('.collection-card-portrait')).toBeNull();
    expect(slide?.querySelector('.collection-meter--empty')).not.toBeNull();
  });

  it('plays the reveal flip on the claim, and the rung cannot be claimed twice', () => {
    // The flip is no longer a saved one-shot on page open: it is tied to the
    // claim, which can only happen once per rung.
    gameState.setBirdCountForTest('sparrow', T.unlock);
    const host = mount();
    wireCollectionPage(host);
    expect(host.querySelector('.collection-card--reveal')).toBeNull();

    host.querySelector<HTMLButtonElement>('.collection-unlock-btn')?.click();
    expect(gameState.ladderOf('sparrow').claimedRung).toBe(1);
    const card = host.querySelector<HTMLElement>('.collection-card[data-bird="sparrow"]');
    expect(card?.classList.contains('collection-card--reveal')).toBe(true);

    // Redrawn deck: rung 1 is claimed, so no Unlock button offers it again.
    expect(host.querySelector('.collection-unlock-btn[data-claim-rung="1"]')).toBeNull();
  });

  it('does not offer a flip while the bird is still short of the rung', () => {
    gameState.setBirdCountForTest('sparrow', T.unlock - 1);
    const host = mount();
    wireCollectionPage(host);
    expect(host.querySelector('.collection-unlock-btn')).toBeNull();
    expect(host.querySelector('.collection-card--reveal')).toBeNull();
    expect(gameState.ladderOf('sparrow').claimedRung).toBe(0);
  });

  it('clips the portrait to the frame arch so a costume cannot spill', () => {
    const host = mount();
    const arch = host.querySelector<HTMLElement>('.collection-card[data-bird="sparrow"] .collection-card-arch');
    expect(arch).not.toBeNull();
    // Geometry comes from the sparrow frame art: a 688x643 window at 108,105
    // on a 900x1500 canvas, with the top corners rounded to a true semicircle.
    expect(arch?.style.left).toBe('12.0000%');
    expect(arch?.style.top).toBe('7.0000%');
    expect(arch?.style.width).toBe('76.4444%');
    expect(arch?.style.height).toBe('42.8667%');
    // happy-dom cannot round-trip the slash form, so read the inline style.
    expect(arch?.getAttribute('style')).toContain('border-radius:50% 50% 0 0 / 53.499% 53.499% 0 0');
  });
});
