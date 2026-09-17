import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/audio/AudioManager', () => ({ playUITap: vi.fn(), playFind: vi.fn(), playHint: vi.fn(), setMusicEnabled: vi.fn(), setSoundEffectsEnabled: vi.fn(), setMusicPausedForAd: vi.fn() }));
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

  it('renders the bar inside the collection page', () => {
    openPage('collection');
    const page = document.getElementById('home-page-overlay');
    expect(page).not.toBeNull();
    const nav = page?.querySelector('.home-page-nav');
    expect(nav).not.toBeNull();
    expect(nav?.querySelectorAll('.home-nav-btn')).toHaveLength(3);
    expect(nav?.querySelector('#home-nav-collection')?.classList.contains('home-nav-btn--active')).toBe(true);
  });

  it('swaps to the sanctuary in place, keeping the bar', () => {
    openPage('collection');
    const page = document.getElementById('home-page-overlay')!;
    page.querySelector<HTMLButtonElement>('.home-page-nav #home-nav-sanctuary')?.click();
    expect(page.classList.contains('home-page-sanctuary')).toBe(true);
    expect(document.getElementById('home-page-title')?.textContent).toBe('Sanctuary');
    expect(page.querySelector('.home-page-nav #home-nav-sanctuary')?.classList.contains('home-nav-btn--active')).toBe(true);
    expect(page.querySelector('.sanctuary-scene')).not.toBeNull();
  });
});
