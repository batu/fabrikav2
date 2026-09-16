import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// happy-dom has no AudioContext; the page taps SFX on every sheet button.
vi.mock('../../src/audio/AudioManager', () => ({ playUITap: vi.fn(), playFind: vi.fn() }));
vi.mock('../../src/haptics/HapticsManager', () => ({ hapticFound: vi.fn() }));

import { installMemStorage, removeMemStorage } from './support/memStorage';
import { gameState } from '../../src/core/GameState';
import { renderSanctuaryPageBody, wireSanctuaryPage, teardownSanctuaryPage } from '../../src/ui/SanctuaryPage';

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

  it('offers the build sheet and shows the plot marker with no house', () => {
    const host = mount();
    expect(host.querySelector('.sanctuary-plot')).not.toBeNull();
    expect(host.querySelector('.sanctuary-house')).toBeNull();
    expect(host.querySelector('.sanctuary-sheet-title')?.textContent).toBe('Build a nest box');
  });

  it('tells the player exactly how short they are, and offers the shop instead', () => {
    gameState.setCoinsForTest(149);
    const host = mount();
    const primary = host.querySelector<HTMLButtonElement>('.sanctuary-pill--primary');
    expect(primary?.textContent).toBe('Need 1 more');
  });

  it('builds at the price, debits the wallet and drops the house in', () => {
    gameState.setCoinsForTest(150);
    const host = mount();
    host.querySelector<HTMLButtonElement>('.sanctuary-pill--primary')?.click();
    expect(gameState.sanctuary.houseTier).toBe(1);
    expect(gameState.coinBalance).toBe(0);
    expect(host.querySelector('.sanctuary-house')).not.toBeNull();
    expect(host.querySelector('.sanctuary-plot')).toBeNull();
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
    expect(host.querySelector('.sanctuary-sheet-note')?.textContent).toContain('Find sparrows');
    expect(host.querySelector<HTMLButtonElement>('.sanctuary-pill--primary')?.textContent).toBe('Collection');
  });

  it('places the unlocked sparrow on the tapped perch', () => {
    gameState.setBirdCountForTest('sparrow', 10);
    gameState.setSanctuaryForTest({ houseTier: 1 });
    const host = mount();
    host.querySelector<HTMLButtonElement>('.sanctuary-pedestal')?.click();
    host.querySelector<HTMLButtonElement>('.sanctuary-pill--primary')?.click();
    expect(gameState.sanctuary.placed).toEqual({ 0: 'sparrow' });
    expect(host.querySelectorAll('.sanctuary-pedestal--empty')).toHaveLength(0);
    expect(host.querySelector('.sanctuary-shadow')).not.toBeNull();
  });

  it('dresses the housed bird in the costume the card has earned', () => {
    gameState.setSanctuaryForTest({ houseTier: 1, placed: { 0: 'sparrow' } });

    gameState.setBirdCountForTest('sparrow', 10);
    expect(mount().querySelector<HTMLImageElement>('.sanctuary-pedestal img')?.src).toContain('sparrow-plain');
    document.body.innerHTML = '';

    gameState.setBirdCountForTest('sparrow', 20);
    expect(mount().querySelector<HTMLImageElement>('.sanctuary-pedestal img')?.src).toContain('sparrow-hat');
    document.body.innerHTML = '';

    gameState.setBirdCountForTest('sparrow', 35);
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

  it('previews the next tier as a ghost when the house is tapped', () => {
    gameState.setSanctuaryForTest({ houseTier: 1 });
    const host = mount();
    host.querySelector<HTMLButtonElement>('.sanctuary-house')?.click();
    expect(host.querySelector('.sanctuary-sheet-title')?.textContent).toBe('Nest box · Tier 1');
    expect(host.querySelector<HTMLImageElement>('.sanctuary-ghost')?.src).toContain('house-tier2');
  });

  it('says max tier at the top of the ladder and offers no purchase', () => {
    gameState.setSanctuaryForTest({ houseTier: 3 });
    const host = mount();
    host.querySelector<HTMLButtonElement>('.sanctuary-house')?.click();
    expect(host.querySelector('.sanctuary-sheet-note')?.textContent).toBe('Max tier');
    expect(host.querySelector('.sanctuary-pill--primary')).toBeNull();
    expect(host.querySelector('.sanctuary-ghost')).toBeNull();
  });

  it('upgrades tier by tier and adds a perch each time', () => {
    gameState.setCoinsForTest(5_000);
    gameState.setSanctuaryForTest({ houseTier: 1 });
    const host = mount();
    host.querySelector<HTMLButtonElement>('.sanctuary-house')?.click();
    host.querySelector<HTMLButtonElement>('.sanctuary-pill--primary')?.click();
    expect(gameState.sanctuary.houseTier).toBe(2);
    expect(host.querySelectorAll('.sanctuary-pedestal')).toHaveLength(2);
    expect(gameState.coinBalance).toBe(5_000 - 300);
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
