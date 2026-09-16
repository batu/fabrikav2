import { describe, expect, it, vi } from 'vitest';

describe('home No Ads badge', () => {
  it('opens the shop at entitlements and starts the no-ads purchase in one tap', async () => {
    const { bindHomeNavigation } = await import('../../src/ui/homeNavigation');
    const overlay = document.createElement('div');
    overlay.innerHTML = '<button id="home-no-ads" type="button"></button>';
    document.body.appendChild(overlay);
    const openPage = vi.fn();
    const triggerNavBounce = vi.fn();
    bindHomeNavigation(overlay, { triggerNavBounce, startCurrentLevel: vi.fn(), openPage });
    overlay.querySelector<HTMLButtonElement>('#home-no-ads')!.click();
    expect(openPage).toHaveBeenCalledWith('shop', { scrollTo: 'entitlements', purchase: 'no-ads' });
    expect(triggerNavBounce).toHaveBeenCalledTimes(1);
    document.body.innerHTML = '';
  });
});
