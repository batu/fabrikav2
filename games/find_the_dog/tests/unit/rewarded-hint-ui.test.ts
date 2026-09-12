import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/audio/AudioManager', () => ({
  playUITap: vi.fn(), playHint: vi.fn(), setMusicEnabled: vi.fn(),
  setSoundEffectsEnabled: vi.fn(), setMusicPausedForAd: vi.fn(),
}));
vi.mock('../../src/ui/EconomyTransfer', () => ({ animateHintsToBalance: vi.fn() }));
import { gameState } from '../../src/core/GameState';
import { remoteConfigService } from '../../src/config/RemoteConfigService';
import { analytics } from '../../src/analytics/AnalyticsService';
import { adService } from '../../src/ads/Service';
import { iapService } from '../../src/shop/IapService';
import { buildHintBoosterOffers } from '../../src/shop/HintBoosterOffers';
import { initHUD, openPage, setHintCallback } from '../../src/ui/HUD';

function button(id: string): HTMLButtonElement {
  const el = document.getElementById(id);
  expect(el, id).not.toBeNull();
  return el as HTMLButtonElement;
}

describe('rewarded hint UI through the real wallet and ad service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    localStorage.setItem('ftd_rewarded_hints_today', '0');
    gameState.load();
    gameState.settings.adsEnabled = true;
    gameState.hintCircleActive = false;
    remoteConfigService.setValuesForTest({ hintRwEnabled: true });
    iapService.setStateForTest({ state: 'ready' });
    document.body.innerHTML = '<div id="hud-overlay"></div>';
    setHintCallback(() => { gameState.spendHint('gameplayHint'); });
    vi.spyOn(analytics, 'resourceChanged').mockResolvedValue();
  });

  it.each([[0, 2], [1, 1], [2, 1], [3, 1], [10, 1], [27, 1]])('offers the correct amount at balance %i', (hints, amount) => {
    const offers = buildHintBoosterOffers({ hints, coins: 0, adsEnabled: true, hasNoAdsEntitlement: false, rewardedAdAvailable: true });
    expect(offers.options.find(o => o.kind === 'rewardedAd')?.hintAmount).toBe(amount);
  });

  it('announces +2 in the booster, grants two and uses one immediately', async () => {
    gameState.setHintsForTest(0);
    vi.spyOn(adService, 'showRewardedAd').mockResolvedValue({ granted: true });
    initHUD();
    button('hint-btn').click();
    expect(button('hint-booster-watch-ad').textContent).toContain('+2 hints');
    button('hint-booster-watch-ad').click();
    await vi.waitFor(() => expect(gameState.hintsRemaining).toBe(1));
    expect(gameState.walletSnapshot().counters.rewardedHintGrants).toBe(2);
    expect(analytics.resourceChanged).toHaveBeenCalledWith(expect.objectContaining({ amount: 2, item_id: 'rewarded_hint' }));
  });

  it('adds +1 from the shop with existing hints without spending it or forcing an ad on normal hint use', async () => {
    gameState.setHintsForTest(2);
    const show = vi.spyOn(adService, 'showRewardedAd').mockResolvedValue({ granted: true });
    initHUD();
    button('hint-btn').click();
    expect(gameState.hintsRemaining).toBe(1);
    expect(show).not.toHaveBeenCalled();
    openPage('shop');
    expect(button('shop-watch-ad-hint').textContent).toContain('+1 hint');
    button('shop-watch-ad-hint').click();
    await vi.waitFor(() => expect(gameState.hintsRemaining).toBe(2));
    expect(analytics.resourceChanged).toHaveBeenCalledWith(expect.objectContaining({ amount: 1, item_id: 'rewarded_hint' }));
  });
  it.each([[0, 2], [1, 1], [3, 1], [10, 1], [27, 1]])('shop top-up at balance %i keeps the full reward and reports its units', async (balance, amount) => {
    gameState.setHintsForTest(balance);
    const useHint = vi.fn(() => { gameState.spendHint('gameplayHint'); });
    setHintCallback(useHint);
    const show = vi.spyOn(adService, 'showRewardedAd').mockResolvedValue({ granted: true });
    openPage('shop');
    const watch = button('shop-watch-ad-hint');
    expect(watch.disabled).toBe(false);
    expect(watch.textContent).toContain(`+${amount} ${amount === 1 ? 'hint' : 'hints'}`);
    watch.click();
    await vi.waitFor(() => expect(gameState.hintsRemaining).toBe(balance + amount));
    expect(useHint).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledTimes(1);
    expect(gameState.rewardedHintsToday).toBe(1);
    expect(gameState.walletSnapshot().counters.rewardedHintGrants).toBe(amount);
    expect(analytics.resourceChanged).toHaveBeenCalledTimes(1);
    expect(analytics.resourceChanged).toHaveBeenCalledWith(expect.objectContaining({ amount, item_id: 'rewarded_hint' }));
  });

  it.each(['cancel', 'failure'])('does not grant or consume a daily slot on %s; retry can succeed', async (outcome) => {
    gameState.setHintsForTest(0);
    const show = vi.spyOn(adService, 'showRewardedAd');
    if (outcome === 'cancel') show.mockResolvedValue({ granted: false });
    else show.mockRejectedValue(new Error('native show failed'));
    openPage('shop');
    button('shop-watch-ad-hint').click();
    await vi.waitFor(() => expect(button('shop-watch-ad-hint').dataset.pending).toBeUndefined());
    expect(gameState.hintsRemaining).toBe(0);
    expect(gameState.rewardedHintsToday).toBe(0);
    expect(analytics.resourceChanged).not.toHaveBeenCalled();
    show.mockResolvedValue({ granted: true });
    button('shop-watch-ad-hint').click();
    await vi.waitFor(() => expect(gameState.hintsRemaining).toBe(2));
  });

  it('keeps the displayed offer across balance changes and ignores duplicate taps/reopened controls', async () => {
    gameState.setHintsForTest(0);
    let resolve!: (result: { granted: boolean }) => void;
    const show = vi.spyOn(adService, 'showRewardedAd').mockReturnValue(new Promise(r => { resolve = r; }));
    openPage('shop');
    const watch = button('shop-watch-ad-hint');
    expect(watch.textContent).toContain('+2 hints');
    gameState.setHintsForTest(1); // changed after the offer, before watch
    watch.click();
    watch.dispatchEvent(new MouseEvent('click'));
    document.getElementById('home-page-overlay')!.remove();
    openPage('shop');
    button('shop-watch-ad-hint').dispatchEvent(new MouseEvent('click'));
    expect(show).toHaveBeenCalledTimes(1);
    gameState.setHintsForTest(10); // changed again while watching
    resolve({ granted: true });
    await vi.waitFor(() => expect(gameState.hintsRemaining).toBe(12));
    expect(gameState.rewardedHintsToday).toBe(1);
    expect(analytics.resourceChanged).toHaveBeenCalledTimes(1);
    expect(analytics.resourceChanged).toHaveBeenCalledWith(expect.objectContaining({ amount: 2 }));
  });

  it('does not auto-use a booster hint in a replacement scene', async () => {
    gameState.setHintsForTest(0);
    let resolve!: (result: { granted: boolean }) => void;
    vi.spyOn(adService, 'showRewardedAd').mockReturnValue(new Promise(r => { resolve = r; }));
    initHUD();
    button('hint-btn').click();
    button('hint-booster-watch-ad').click();
    const nextScene = vi.fn();
    setHintCallback(nextScene);
    resolve({ granted: true });
    await vi.waitFor(() => expect(gameState.hintsRemaining).toBe(2));
    expect(nextScene).not.toHaveBeenCalled();
  });

  it('rechecks ad enablement before watching a displayed offer', () => {
    gameState.setHintsForTest(1);
    const show = vi.spyOn(adService, 'showRewardedAd');
    openPage('shop');
    remoteConfigService.setValuesForTest({ hintRwEnabled: false });
    button('shop-watch-ad-hint').click();
    expect(show).not.toHaveBeenCalled();
    expect(gameState.rewardedHintsToday).toBe(0);
  });

});
