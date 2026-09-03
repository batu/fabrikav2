import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/RemoteConfigService', async () => {
  const { REMOTE_CONFIG_DEFAULTS } = await import('../../src/config/remoteConfigSchema');
  return {
    remoteConfigService: {
      value: (key: keyof typeof REMOTE_CONFIG_DEFAULTS) => REMOTE_CONFIG_DEFAULTS[key],
      snapshot: () => ({ values: REMOTE_CONFIG_DEFAULTS }),
    },
  };
});

vi.mock('../../src/audio/AudioManager', () => ({
  playUITap: vi.fn(),
  playHint: vi.fn(),
  setMusicEnabled: vi.fn(),
  setSoundEffectsEnabled: vi.fn(),
}));

import { analytics } from '../../src/analytics/AnalyticsService';
import { REMOTE_CONFIG_DEFAULTS } from '../../src/config/remoteConfigSchema';
import { iapService } from '../../src/shop/IapService';
import {
  getPickupStylePreference,
  registerPickupStyleApplier,
  setPickupStylePreference,
} from '../../src/settings/pickupStylePreference';
import { openPage, setHomeCallback } from '../../src/ui/HUD';

function productCard(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-catalog-id="${id}"]`);
  if (found === null) throw new Error(`Missing shop product ${id}`);
  return found;
}

function purchaseButton(id: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`.shop-purchase-btn[data-catalog-id="${id}"]`);
  if (found === null) throw new Error(`Missing purchase button ${id}`);
  return found;
}

describe('shop and Settings parity', () => {
  beforeAll(async () => {
    iapService.setStateForTest({
      state: 'ready',
      purchaseDelayMsByProductId: {
        [REMOTE_CONFIG_DEFAULTS.hintPack50ProductId]: 1_000,
      },
    });
    await iapService.initPromiseValue;
  });

  beforeEach(() => {
    document.body.innerHTML = '<div id="hud-overlay"><div id="home-shell"></div></div>';
    setHomeCallback(null);
    setPickupStylePreference('dissolve');
    registerPickupStyleApplier(null);
    vi.restoreAllMocks();
  });

  it('lets players switch pickup presentation from Settings for the current session', () => {
    const apply = vi.fn();
    registerPickupStyleApplier(apply);
    expect(getPickupStylePreference()).toBe('dissolve');

    openPage('settings');

    const select = document.querySelector<HTMLSelectElement>('#pickup-style');
    expect(select?.getAttribute('aria-label')).toBe('Pickup style');
    expect([...select!.options].map((option) => option.value)).toEqual(['feathers']);
    expect(select?.querySelector('option[value="feathers"]')?.hasAttribute('selected')).toBe(true);

    select!.value = 'feathers';
    select!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(getPickupStylePreference()).toBe('feathers');
    expect(apply).toHaveBeenCalledWith('feathers');
  });

  it('renders the premium icon and exhaustive live-text badge policy with rationed accents', () => {
    openPage('shop');

    const noAds = productCard('no-ads');
    expect(noAds.querySelector<HTMLImageElement>('.shop-featured-icon img')?.getAttribute('src'))
      .toBe('/ui/home/no-ads-runtime.png');

    const vip = productCard('no-ads-premium');
    expect(vip.querySelector<HTMLImageElement>('.shop-featured-icon img')?.getAttribute('src'))
      .toBe('/ui/shop/shop_no_ads_premium.png');

    const expectedBadges = new Map([
      ['no-ads-premium', 'Best Value'],
      ['hint-pack-25', 'Popular'],
      ['hint-pack-50', 'Best Value'],
      ['coin-pack-5000', 'Popular'],
      ['coin-pack-100000', 'Best Value'],
    ] as const);

    for (const [id, label] of expectedBadges) {
      const wrapper = productCard(id).closest<HTMLElement>('.shop-featured-wrapper, .shop-grid-wrapper');
      const badge = wrapper?.querySelector<HTMLElement>('.shop-featured-badge, .shop-grid-badge') ?? null;
      expect(badge?.getAttribute('aria-label')).toBe(label);
      expect(badge?.textContent).toContain(label);
      expect(badge?.querySelector('img')).toBeNull();
      expect(badge?.querySelectorAll('.shop-sparkle')).toHaveLength(0);
      expect(productCard(id).querySelectorAll(':scope > .shop-sparkle').length).toBeLessThanOrEqual(2);
    }

    for (const id of ['no-ads', 'hint-pack-10', 'coin-pack-1000', 'coin-pack-10000', 'coin-pack-25000', 'coin-pack-50000']) {
      const wrapper = productCard(id).closest<HTMLElement>('.shop-featured-wrapper, .shop-grid-wrapper');
      expect(wrapper?.querySelector('.shop-featured-badge, .shop-grid-badge')).toBeNull();
    }
  });

  it('keeps only the pending product visually busy while preserving every price and blocking re-entry', () => {
    const tappedSpy = vi.spyOn(analytics, 'productTapped').mockResolvedValue();
    vi.spyOn(analytics, 'purchaseInitiated').mockResolvedValue();
    openPage('shop');

    const pending = purchaseButton('hint-pack-50');
    const other = purchaseButton('coin-pack-5000');
    const pendingPrice = pending.textContent;
    const otherPrice = other.textContent;

    pending.click();
    expect(pending.classList.contains('shop-btn-purchasing')).toBe(true);
    expect(pending.textContent).toBe(pendingPrice);
    expect(other.classList.contains('shop-btn-purchasing')).toBe(false);
    expect(other.textContent).toBe(otherPrice);
    expect(other.disabled).toBe(false);

    other.click();
    expect(tappedSpy).toHaveBeenCalledTimes(1);
  });

  it('closes Settings before invoking the replaceable Home callback and preserves existing controls', () => {
    const observations: boolean[] = [];
    setHomeCallback(() => {
      observations.push(document.getElementById('home-page-overlay')?.classList.contains('home-page-overlay--open') ?? false);
    });

    openPage('settings');
    expect(document.getElementById('privacy-choices-btn')).not.toBeNull();
    expect(document.getElementById('toggle-music')).not.toBeNull();
    expect(document.getElementById('settings-home-btn')).not.toBeNull();
    document.getElementById('settings-home-btn')?.click();
    expect(observations).toEqual([false]);

    setHomeCallback(null);
    document.body.innerHTML = '<div id="hud-overlay"><div id="home-shell"></div></div>';
    openPage('settings');
    document.getElementById('settings-home-btn')?.click();
    expect(observations).toEqual([false]);
  });
});
