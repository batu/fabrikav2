import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// happy-dom has no AudioContext; both meta pages preload their SFX on wire.
vi.mock('../../src/audio/AudioManager', () => ({
  playUITap: vi.fn(), playFind: vi.fn(), playHint: vi.fn(), setMusicEnabled: vi.fn(),
  setSoundEffectsEnabled: vi.fn(), setMusicPausedForAd: vi.fn(),
  preloadMetaSounds: vi.fn(), playCollectionClaim: vi.fn(), playHouseBuild: vi.fn(), playBirdPlace: vi.fn(),
}));
vi.mock('../../src/haptics/HapticsManager', () => ({ hapticFound: vi.fn(), hapticWrong: vi.fn() }));
import { installMemStorage, removeMemStorage } from './support/memStorage';
import { gameState } from '../../src/core/GameState';
import { openPage, closePage } from '../../src/ui/HUD';

describe('meta pages keep the nav bar', () => {
  beforeEach(() => {
    installMemStorage();
    gameState.load();
    gameState.setTotalLevelsCompletedForTest(20);
    gameState.setBirdCountForTest('sparrow', 10);
    document.body.innerHTML = '<div id="hud-overlay"><div id="home-shell"></div></div>';
  });
  afterEach(() => { closePage(); document.body.innerHTML = ''; removeMemStorage(); });

  /** The bar hands its selection over on the next frame, so the lift travels
   *  instead of appearing; a swap then rebuilds the body after its leave. */
  const nextFrame = (): Promise<void> => new Promise((resolve) => { requestAnimationFrame(() => { resolve(); }); });
  const afterSwap = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 260); });

  it('renders the bar inside the collection page', async () => {
    openPage('collection');
    await nextFrame();
    const page = document.getElementById('home-page-overlay');
    expect(page).not.toBeNull();
    const nav = page?.querySelector('.home-page-nav');
    expect(nav).not.toBeNull();
    expect(nav?.querySelectorAll('.home-nav-btn')).toHaveLength(3);
    expect(nav?.querySelector('#home-nav-collection')?.classList.contains('home-nav-btn--active')).toBe(true);
  });

  it('offers Sanctuary, Play and Collection, and no shop', () => {
    openPage('collection');
    const nav = document.querySelector('.home-page-nav');
    expect([...nav!.querySelectorAll('.home-nav-btn span')].map((s) => s.textContent))
      .toEqual(['Sanctuary', 'Play', 'Collection']);
    expect(nav!.querySelector('#home-nav-shop')).toBeNull();
  });

  it('leaves the page when Play is tapped', () => {
    openPage('collection');
    const page = document.getElementById('home-page-overlay')!;
    page.querySelector<HTMLButtonElement>('.home-page-nav #home-nav-play')?.click();
    // closePage animates out; the overlay loses its open class immediately.
    expect(page.classList.contains('home-page-overlay--open')).toBe(false);
  });

  it('closes back to the menu when the current tile is tapped again', () => {
    openPage('collection');
    const page = document.getElementById('home-page-overlay')!;
    page.querySelector<HTMLButtonElement>('.home-page-nav #home-nav-collection')?.click();
    expect(page.classList.contains('home-page-overlay--open')).toBe(false);
  });

  it('shows a claim dot on the sanctuary tile when coins are waiting', async () => {
    const { renderMetaNavBar } = await import('../../src/ui/metaNavBar');
    gameState.setSanctuaryForTest({ houseTier: 1, placed: { 0: 'sparrow' }, pendingCoins: 4.2 });
    const withCoins = renderMetaNavBar();
    expect(withCoins).toContain('home-claim-dot--nav');
    expect(withCoins).toContain('4 coins to collect');

    gameState.setSanctuaryForTest({ pendingCoins: 0.3 });
    expect(renderMetaNavBar()).not.toContain('home-claim-dot--nav');
  });

  it('clears the claim dot as soon as the coins are collected', () => {
    gameState.setCoinsForTest(0);
    gameState.setSanctuaryForTest({ houseTier: 1, placed: { 0: 'sparrow' }, pendingCoins: 6.5 });
    // happy-dom measures every box as zero and the scene refuses to draw into
    // one, so give every element a phone-sized box before the page mounts.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { value: 390, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { value: 700, configurable: true });
    openPage('sanctuary');
    const page = document.getElementById('home-page-overlay')!;
    expect(page.querySelector('.home-page-nav .home-claim-dot')).not.toBeNull();

    page.querySelector<HTMLButtonElement>('.sanctuary-coins')?.click();
    expect(gameState.coinBalance).toBe(6);
    expect(page.querySelector('.home-page-nav .home-claim-dot')).toBeNull();
  });

  it('swaps to the sanctuary in place, keeping the bar', async () => {
    openPage('collection');
    // Let the open's own hand-over land first; a tap in the same frame would
    // race it and the bar would settle back on Collection.
    await nextFrame();
    const page = document.getElementById('home-page-overlay')!;
    page.querySelector<HTMLButtonElement>('.home-page-nav #home-nav-sanctuary')?.click();
    await afterSwap();
    expect(page.classList.contains('home-page-sanctuary')).toBe(true);
    expect(document.getElementById('home-page-title')?.textContent).toBe('Sanctuary');
    expect(page.querySelector('.home-page-nav #home-nav-sanctuary')?.classList.contains('home-nav-btn--active')).toBe(true);
    expect(page.querySelector('.sanctuary-scene')).not.toBeNull();
  });
});
