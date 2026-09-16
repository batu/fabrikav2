import { beforeEach, describe, expect, it, vi } from 'vitest';

const hapticWrong = vi.fn();
vi.mock('../../src/haptics/HapticsManager', () => ({ hapticWrong }));

describe('locked home nav tiles', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    hapticWrong.mockClear();
  });

  it('roll-shakes and buzzes on tap without navigating, and clears the class after the animation', async () => {
    const { bindHomeNavigation } = await import('../../src/ui/homeNavigation');
    const overlay = document.createElement('div');
    overlay.innerHTML = `
      <button id="home-nav-collection" class="home-nav-btn home-nav-btn--locked" type="button" aria-disabled="true"></button>
      <button id="home-nav-shop" class="home-nav-btn" type="button"></button>`;
    document.body.appendChild(overlay);
    const openPage = vi.fn();
    bindHomeNavigation(overlay, { triggerNavBounce: vi.fn(), startCurrentLevel: vi.fn(), openPage });

    const locked = overlay.querySelector<HTMLButtonElement>('#home-nav-collection')!;
    locked.click();
    expect(locked.classList.contains('home-nav-btn--shake')).toBe(true);
    expect(hapticWrong).toHaveBeenCalledTimes(1);
    expect(openPage).not.toHaveBeenCalled();

    locked.dispatchEvent(new Event('animationend'));
    expect(locked.classList.contains('home-nav-btn--shake')).toBe(false);

    // Rapid re-tap restarts the shake without leaking listeners.
    locked.click();
    locked.click();
    expect(locked.classList.contains('home-nav-btn--shake')).toBe(true);
    locked.dispatchEvent(new Event('animationend'));
    expect(locked.classList.contains('home-nav-btn--shake')).toBe(false);
  });

  it('stays inert while a page overlay is open', async () => {
    const { bindHomeNavigation } = await import('../../src/ui/homeNavigation');
    const overlay = document.createElement('div');
    overlay.innerHTML = '<button id="home-nav-sanctuary" class="home-nav-btn home-nav-btn--locked" type="button"></button>';
    document.body.appendChild(overlay);
    const page = document.createElement('div');
    page.id = 'home-page-overlay';
    document.body.appendChild(page);
    bindHomeNavigation(overlay, { triggerNavBounce: vi.fn(), startCurrentLevel: vi.fn(), openPage: vi.fn() });
    overlay.querySelector<HTMLButtonElement>('#home-nav-sanctuary')!.click();
    expect(hapticWrong).not.toHaveBeenCalled();
  });
});
