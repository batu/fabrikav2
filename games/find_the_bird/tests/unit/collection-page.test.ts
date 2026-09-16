import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMemStorage, removeMemStorage } from './support/memStorage';
import { gameState } from '../../src/core/GameState';
import { renderCollectionPageBody, wireCollectionPage } from '../../src/ui/CollectionPage';

function mount(): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderCollectionPageBody();
  document.body.appendChild(host);
  return host;
}

describe('collection page', () => {
  beforeEach(() => {
    installMemStorage();
    gameState.load();
    gameState.setBirdCountForTest('sparrow', 0);
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    removeMemStorage();
  });

  it('renders a two-card deck with one dot per card', () => {
    const host = mount();
    expect(host.querySelectorAll('.collection-slide')).toHaveLength(2);
    expect(host.querySelectorAll('.collection-dot')).toHaveLength(2);
    expect(host.querySelector('.collection-dot')?.classList.contains('collection-dot--active')).toBe(true);
  });

  it('shows the sparrow locked, with hidden copy and a padlock, at zero', () => {
    const host = mount();
    const card = host.querySelector<HTMLElement>('.collection-card[data-card-kind="sparrow"]');
    expect(card?.dataset.cardState).toBe('silhouette');
    expect(card?.classList.contains('collection-card--locked')).toBe(true);
    expect(card?.querySelector('.collection-plaque')?.textContent).toBe('? ? ?');
    expect(card?.querySelector('.collection-card-lock')).not.toBeNull();
    expect(card?.querySelector('.collection-line')?.textContent).not.toContain('Loud');
  });

  it('shows progress towards the unlock threshold', () => {
    gameState.setBirdCountForTest('sparrow', 6);
    const host = mount();
    expect(host.querySelector('.collection-progress-count')?.textContent).toBe('6 / 10');
    expect(host.querySelector('.collection-progress-label')?.textContent).toBe('Unlock');
  });

  it('reveals the bird, its name and its copy once unlocked', () => {
    gameState.setBirdCountForTest('sparrow', 10);
    const host = mount();
    const card = host.querySelector<HTMLElement>('.collection-card[data-card-kind="sparrow"]');
    expect(card?.dataset.cardState).toBe('plain');
    expect(card?.classList.contains('collection-card--locked')).toBe(false);
    expect(card?.querySelector('.collection-plaque')?.textContent).toBe('Sparrow');
    expect(card?.querySelector('.collection-line')?.textContent).toContain('Loud');
    expect(card?.querySelector('.collection-card-lock')).toBeNull();
    expect(host.querySelector('.collection-progress-label')?.textContent).toBe('Hat');
  });

  it('swaps the portrait for each costume', () => {
    gameState.setBirdCountForTest('sparrow', 20);
    expect(mount().querySelector<HTMLImageElement>('.collection-card-portrait')?.src).toContain('portrait-sparrow-hat');
    document.body.innerHTML = '';
    gameState.setBirdCountForTest('sparrow', 35);
    expect(mount().querySelector<HTMLImageElement>('.collection-card-portrait')?.src).toContain('portrait-sparrow-cardigan');
  });

  it('reports the finished card as complete', () => {
    gameState.setBirdCountForTest('sparrow', 35);
    const host = mount();
    expect(host.querySelector('.collection-progress--done')?.textContent).toBe('Complete');
  });

  it('always keeps the ? card locked with no progress bar', () => {
    gameState.setBirdCountForTest('sparrow', 99);
    const host = mount();
    const unknown = host.querySelector<HTMLElement>('.collection-card[data-card-kind="unknown"]');
    expect(unknown?.classList.contains('collection-card--locked')).toBe(true);
    expect(unknown?.querySelector('.collection-progress')).toBeNull();
    expect(unknown?.querySelector('.collection-ribbon')?.textContent).toBe('Coming soon');
  });

  it('plays the reveal flip once, then never again', () => {
    gameState.setBirdCountForTest('sparrow', 10);
    const first = mount();
    wireCollectionPage(first);
    expect(first.querySelector('.collection-card--reveal')).not.toBeNull();
    expect(gameState.collectionMeta.plainFlipShown).toBe(true);

    document.body.innerHTML = '';
    const second = mount();
    wireCollectionPage(second);
    expect(second.querySelector('.collection-card--reveal')).toBeNull();
  });

  it('does not flip while the bird is still locked', () => {
    gameState.setBirdCountForTest('sparrow', 4);
    const host = mount();
    wireCollectionPage(host);
    expect(host.querySelector('.collection-card--reveal')).toBeNull();
    expect(gameState.collectionMeta.plainFlipShown).toBe(false);
  });

  it('keeps the portrait inside a round porthole so a costume cannot spill', () => {
    const host = mount();
    const porthole = host.querySelector<HTMLElement>('.collection-card-porthole');
    expect(porthole).not.toBeNull();
    // Geometry comes from the manifest: a 552px circle on a 1024x1536 card.
    expect(porthole?.style.width).toBe('53.9063%');
    expect(porthole?.style.left).toBe('20.7031%');
  });
});
