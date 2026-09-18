import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// happy-dom has no AudioContext; the page taps SFX on every sheet button.
vi.mock('../../src/audio/AudioManager', () => ({
  playBirdPlace: vi.fn(), playFind: vi.fn(), playHouseBuild: vi.fn(), playUITap: vi.fn(), preloadMetaSounds: vi.fn(),
}));
vi.mock('../../src/haptics/HapticsManager', () => ({ hapticFound: vi.fn() }));

import { installMemStorage, removeMemStorage } from './support/memStorage';
import { gameState } from '../../src/core/GameState';
import { renderSanctuaryPageBody, wireSanctuaryPage, teardownSanctuaryPage } from '../../src/ui/SanctuaryPage';
import { housePrice } from '../../src/collection/config';
import { BIRDS } from '../../src/collection/birds';

const VIEWPORT = { width: 390, height: 700 };
/** Pin the page's clock so accrual cannot drift the assertions. */
const NOW = Date.parse('2026-09-16T12:00:00.000Z');

/**
 * happy-dom reports zero for every layout box, and the page refuses to draw
 * into a zero-sized scene. Pin the scene's measured size so the layout runs.
 */
function mount(): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderSanctuaryPageBody();
  document.body.appendChild(host);
  const scene = host.querySelector<HTMLElement>('#sanctuary-scene');
  if (scene !== null) {
    Object.defineProperty(scene, 'clientWidth', { value: VIEWPORT.width, configurable: true });
    Object.defineProperty(scene, 'clientHeight', { value: VIEWPORT.height, configurable: true });
  }
  wireSanctuaryPage(host);
  return host;
}

describe('sanctuary page', () => {
  beforeEach(() => {
    installMemStorage();
    gameState.load();
    gameState.setBirdCountForTest('sparrow', 0);
    for (const bird of BIRDS) gameState.setClaimedRungForTest(0, bird);
    gameState.setSanctuaryForTest({ houseTier: 0, placed: {}, pendingCoins: 0, accrualStartedAt: null });
    window.__ftbNow = NOW;
    document.body.innerHTML = '';
  });

  afterEach(() => {
    teardownSanctuaryPage();
    delete window.__ftbNow;
    document.body.innerHTML = '';
    removeMemStorage();
  });

  it('offers the build action, with no house and no perch yet', () => {
    // Build/upgrade moved out of a sheet onto a persistent action bar, so the
    // offer is on screen from the moment the page opens.
    const host = mount();
    expect(host.querySelector('.sanctuary-house')).toBeNull();
    expect(host.querySelector('.sanctuary-pedestal')).toBeNull();
    const action = host.querySelector<HTMLButtonElement>('#sanctuary-actions .sanctuary-pill--primary');
    expect(action?.querySelector('.sanctuary-action-verb')?.textContent).toBe('Build nest box');
    expect(action?.querySelector('.sanctuary-action-price')?.textContent).toBe(String(housePrice(1)));
  });

  it('marks the action short of coins rather than hiding it', () => {
    gameState.setCoinsForTest(housePrice(1) - 1);
    const host = mount();
    const action = host.querySelector<HTMLButtonElement>('.sanctuary-pill--primary');
    expect(action?.classList.contains('sanctuary-action--short')).toBe(true);
    expect(action?.getAttribute('aria-label')).toContain('not enough coins');
    action?.click(); // a shop trip, never a build
    expect(gameState.sanctuary.houseTier).toBe(0);
    expect(gameState.coinBalance).toBe(housePrice(1) - 1);
  });

  it('builds at the price, debits the wallet and drops the house in', () => {
    gameState.setCoinsForTest(housePrice(1));
    const host = mount();
    const action = host.querySelector<HTMLButtonElement>('.sanctuary-pill--primary');
    expect(action?.classList.contains('sanctuary-action--ready')).toBe(true);
    action?.click();
    expect(gameState.sanctuary.houseTier).toBe(1);
    expect(gameState.coinBalance).toBe(0);
    expect(host.querySelector('.sanctuary-house')).not.toBeNull();
  });

  it('shows one empty perch per tier, and no bird before one is placed', () => {
    gameState.setSanctuaryForTest({ houseTier: 2 });
    const host = mount();
    const perches = host.querySelectorAll('.sanctuary-pedestal');
    expect(perches).toHaveLength(2);
    expect(host.querySelectorAll('.sanctuary-pedestal--empty')).toHaveLength(2);
  });

  it('sends a player with no unlocked bird to the collection instead of placing', () => {
    gameState.setSanctuaryForTest({ houseTier: 1 });
    const host = mount();
    host.querySelector<HTMLButtonElement>('.sanctuary-pedestal')?.click();
    expect(host.querySelector('.sanctuary-sheet-title')?.textContent).toBe('Who moves in?');
    // The sheet lists every bird; all locked means nothing is pickable.
    expect(host.querySelectorAll('.sanctuary-bird')).toHaveLength(BIRDS.length);
    expect(host.querySelectorAll('.sanctuary-bird--locked')).toHaveLength(BIRDS.length);
    expect(host.querySelector('.sanctuary-sheet-note')?.textContent).toBe('Unlock a bird in the Collection first.');
    expect(host.querySelector<HTMLButtonElement>('.sanctuary-sheet .sanctuary-pill--primary')?.textContent).toBe('Go to Collection');
  });

  it('places the claimed sparrow on the tapped perch', () => {
    // A bird moves in once its rung is CLAIMED, not merely earned.
    gameState.setClaimedRungForTest(1, 'sparrow');
    gameState.setSanctuaryForTest({ houseTier: 1 });
    const host = mount();
    host.querySelector<HTMLButtonElement>('.sanctuary-pedestal')?.click();
    const sparrow = host.querySelector<HTMLButtonElement>('.sanctuary-bird:not(.sanctuary-bird--locked)');
    expect(sparrow?.querySelector('.sanctuary-bird-name')?.textContent).toBe('Chirpy');
    sparrow?.click();
    expect(gameState.sanctuary.placed).toEqual({ 0: 'sparrow' });
    expect(host.querySelectorAll('.sanctuary-pedestal--empty')).toHaveLength(0);
    expect(host.querySelector('.sanctuary-shadow')).not.toBeNull();
  });

  it('dresses the housed bird in the costume the card has claimed', () => {
    gameState.setSanctuaryForTest({ houseTier: 1, placed: { 0: 'sparrow' } });

    gameState.setClaimedRungForTest(1, 'sparrow');
    expect(mount().querySelector<HTMLImageElement>('.sanctuary-pedestal img')?.src).toContain('sparrow-plain');
    document.body.innerHTML = '';

    gameState.setClaimedRungForTest(2, 'sparrow');
    expect(mount().querySelector<HTMLImageElement>('.sanctuary-pedestal img')?.src).toContain('sparrow-hat');
    document.body.innerHTML = '';

    gameState.setClaimedRungForTest(3, 'sparrow');
    expect(mount().querySelector<HTMLImageElement>('.sanctuary-pedestal img')?.src).toContain('sparrow-cardigan');
  });

  it('hides the coin pile until at least one whole coin is pending', () => {
    gameState.setSanctuaryForTest({ houseTier: 1, placed: { 0: 'sparrow' }, pendingCoins: 0.4 });
    expect(mount().querySelector('.sanctuary-coins')).toBeNull();
    document.body.innerHTML = '';
    gameState.setSanctuaryForTest({ pendingCoins: 3.6 });
    const host = mount();
    expect(host.querySelector('.sanctuary-coins-badge')?.textContent).toBe('+3');
  });

  it('banks the pile into the wallet and hides it', () => {
    gameState.setCoinsForTest(0);
    gameState.setSanctuaryForTest({ houseTier: 1, placed: { 0: 'sparrow' }, pendingCoins: 5.5 });
    const host = mount();
    host.querySelector<HTMLButtonElement>('.sanctuary-coins')?.click();
    expect(gameState.coinBalance).toBe(5);
    expect(host.querySelector('.sanctuary-coins')).toBeNull();
    expect(gameState.sanctuary.pendingCoins).toBeCloseTo(0.5, 6);
  });

  it('offers the next tier at its own price once a house stands', () => {
    gameState.setSanctuaryForTest({ houseTier: 1 });
    const host = mount();
    const action = host.querySelector<HTMLButtonElement>('.sanctuary-pill--primary');
    expect(action?.querySelector('.sanctuary-action-verb')?.textContent).toBe('Upgrade nest box');
    expect(action?.querySelector('.sanctuary-action-price')?.textContent).toBe(String(housePrice(2)));
  });

  it('offers nothing at the top of the ladder', () => {
    gameState.setSanctuaryForTest({ houseTier: 3 });
    const host = mount();
    expect(host.querySelector('#sanctuary-actions')?.innerHTML).toBe('');
    expect(host.querySelector('.sanctuary-pill--primary')).toBeNull();
  });

  it('upgrades tier by tier and adds a perch each time', () => {
    gameState.setCoinsForTest(5_000);
    gameState.setSanctuaryForTest({ houseTier: 1 });
    const host = mount();
    host.querySelector<HTMLButtonElement>('.sanctuary-pill--primary')?.click();
    expect(gameState.sanctuary.houseTier).toBe(2);
    expect(host.querySelectorAll('.sanctuary-pedestal')).toHaveLength(2);
    expect(gameState.coinBalance).toBe(5_000 - housePrice(2));
  });

  it('positions the house and its perches from the manifest, on screen', () => {
    gameState.setSanctuaryForTest({ houseTier: 3 });
    const host = mount();
    const house = host.querySelector<HTMLElement>('.sanctuary-house');
    expect(parseFloat(house?.style.width ?? '0')).toBeGreaterThan(0);
    for (const perch of host.querySelectorAll<HTMLElement>('.sanctuary-pedestal')) {
      expect(parseFloat(perch.style.height)).toBeGreaterThan(0);
      expect(parseFloat(perch.style.top)).toBeLessThan(VIEWPORT.height);
    }
  });
});
