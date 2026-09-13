import { describe, expect, it, vi } from 'vitest';
import { updateLevelBanner } from '../../src/ads/levelBannerPolicy';

describe('gameplay banner exclusions', () => {
  it('allows later levels to recover after a failed native operation', async () => {
    const provider = {
      showBanner: vi.fn(async () => true),
      hideBanner: vi.fn(async () => { throw new Error('native hide failed'); }),
    };
    const failed = updateLevelBanner(provider, 'american_southwest_sw_cactus_garden_ranch_bird_19f1', true);
    const recovered = updateLevelBanner(provider, 'future-level', true);
    await expect(failed).rejects.toThrow('native hide failed');
    expect(await recovered).toBe(true);
    expect(provider.showBanner).toHaveBeenCalledOnce();
  });
  it('hides a late show from the previous level after entering an excluded level', async () => {
    let finishShow!: () => void;
    let visible = false;
    const provider = {
      showBanner: vi.fn(async () => {
        await new Promise<void>((resolve) => { finishShow = resolve; });
        visible = true;
        return true;
      }),
      hideBanner: vi.fn(async () => { visible = false; }),
    };
    const pending = updateLevelBanner(provider, 'future-level', true);
    await vi.waitFor(() => expect(provider.showBanner).toHaveBeenCalledOnce());
    const excluded = updateLevelBanner(provider, 'american_southwest_sw_cactus_garden_ranch_bird_19f1', true);
    finishShow();
    expect(await pending).toBeNull();
    await excluded;
    expect(visible).toBe(false);
  });

  it('finishes allowed -> excluded -> allowed in order even when hiding is delayed', async () => {
    let finishHide!: () => void;
    let visible = false;
    const provider = {
      showBanner: vi.fn(async () => { visible = true; return true; }),
      hideBanner: vi.fn(async () => {
        await new Promise<void>((resolve) => { finishHide = resolve; });
        visible = false;
      }),
    };
    await updateLevelBanner(provider, 'future-level', true);
    const hidden = updateLevelBanner(provider, 'american_southwest_sw_cactus_garden_ranch_bird_19f1', true);
    await vi.waitFor(() => expect(provider.hideBanner).toHaveBeenCalledOnce());
    const restored = updateLevelBanner(provider, 'future-level', true);
    finishHide();
    await hidden;
    expect(await restored).toBe(true);
    expect(visible).toBe(true);
  });
  it('hides an existing banner on the cactus level and restores it on an unaffected level', async () => {
    let visible = false;
    const provider = {
      showBanner: vi.fn(async () => { visible = true; return true; }),
      hideBanner: vi.fn(async () => { visible = false; }),
    };
    const allowed = 'american_southwest_sw_desert_trading_post_bird_7396';
    expect(await updateLevelBanner(provider, allowed, true)).toBe(true);
    expect(visible).toBe(true);
    expect(await updateLevelBanner(provider, 'american_southwest_sw_cactus_garden_ranch_bird_19f1', true)).toBeNull();
    expect(visible).toBe(false);
    expect(provider.showBanner).toHaveBeenCalledTimes(1);
    expect(await updateLevelBanner(provider, allowed, true)).toBe(true);
    expect(visible).toBe(true);
  });

  it('honors disabled ads and preserves no-fill reporting for allowed levels', async () => {
    const provider = { showBanner: vi.fn(async () => false), hideBanner: vi.fn(async () => {}) };
    expect(await updateLevelBanner(provider, 'future-level', false)).toBeNull();
    expect(provider.hideBanner).toHaveBeenCalledOnce();
    expect(provider.showBanner).not.toHaveBeenCalled();
    expect(await updateLevelBanner(provider, 'future-level', true)).toBe(false);
  });
});
