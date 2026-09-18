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

  // 9df6619a3 removed the shop page's "Watch Ad +1 hint" button and its
  // renderer; the in-level hint booster is now the only rewarded-hint surface,
  // and it is only reachable at a zero balance. The +1-at-a-non-zero-balance
  // offer still exists in the pure builder and is covered by the parametrised
  // `buildHintBoosterOffers` test above; there is no UI for it to drive.
  it('spends an existing hint on tap, with no booster and no ad', () => {
    gameState.setHintsForTest(2);
    const show = vi.spyOn(adService, 'showRewardedAd').mockResolvedValue({ granted: true });
    initHUD();
    button('hint-btn').click();
    expect(gameState.hintsRemaining).toBe(1);
    expect(show).not.toHaveBeenCalled();
    expect(document.getElementById('hint-booster-watch-ad')).toBeNull();
    openPage('shop');
    expect(document.getElementById('shop-watch-ad-hint')).toBeNull();
  });

  it('booster top-up keeps the full reward and reports its units', async () => {
    gameState.setHintsForTest(0);
    const useHint = vi.fn(() => { gameState.spendHint('gameplayHint'); });
    setHintCallback(useHint);
    const show = vi.spyOn(adService, 'showRewardedAd').mockResolvedValue({ granted: true });
    initHUD();
    button('hint-btn').click();
    const watch = button('hint-booster-watch-ad');
    expect(watch.disabled).toBe(false);
    expect(watch.textContent).toContain('+2 hints');
    watch.click();
    // The booster grants the full two and spends one straight away: the player
    // asked for a hint, so two granted leaves one banked.
    await vi.waitFor(() => expect(gameState.hintsRemaining).toBe(1));
    expect(useHint).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
    expect(gameState.rewardedHintsToday).toBe(1);
    expect(gameState.walletSnapshot().counters.rewardedHintGrants).toBe(2);
    expect(analytics.resourceChanged).toHaveBeenCalledTimes(1);
    expect(analytics.resourceChanged).toHaveBeenCalledWith(expect.objectContaining({ amount: 2, item_id: 'rewarded_hint' }));
  });

  it.each(['cancel', 'failure'])('does not grant or consume a daily slot on %s; retry can succeed', async (outcome) => {
    gameState.setHintsForTest(0);
    const show = vi.spyOn(adService, 'showRewardedAd');
    if (outcome === 'cancel') show.mockResolvedValue({ granted: false });
    else show.mockRejectedValue(new Error('native show failed'));
    initHUD();
    button('hint-btn').click();
    button('hint-booster-watch-ad').click();
    // The booster closes once the tap settles, however the ad ended.
    await vi.waitFor(() => expect(document.getElementById('hint-booster-modal')).toBeNull());
    expect(gameState.hintsRemaining).toBe(0);
    expect(gameState.rewardedHintsToday).toBe(0);
    expect(analytics.resourceChanged).not.toHaveBeenCalled();
    show.mockResolvedValue({ granted: true });
    // A refused ad leaves nothing granted, so the retry starts from the pill.
    button('hint-btn').click();
    button('hint-booster-watch-ad').click();
    await vi.waitFor(() => expect(gameState.hintsRemaining).toBe(1));
  });

  it('keeps the displayed offer across balance changes and ignores duplicate taps', async () => {
    gameState.setHintsForTest(0);
    let resolve!: (result: { granted: boolean }) => void;
    const show = vi.spyOn(adService, 'showRewardedAd').mockReturnValue(new Promise(r => { resolve = r; }));
    initHUD();
    button('hint-btn').click();
    const watch = button('hint-booster-watch-ad');
    expect(watch.textContent).toContain('+2 hints');
    watch.click();
    watch.dispatchEvent(new MouseEvent('click'));
    expect(show).toHaveBeenCalledTimes(1);
    gameState.setHintsForTest(10); // changed while watching
    resolve({ granted: true });
    // 10 + the two the offer promised, less the one the booster spends.
    await vi.waitFor(() => expect(gameState.hintsRemaining).toBe(11));
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
    gameState.setHintsForTest(0);
    const show = vi.spyOn(adService, 'showRewardedAd');
    initHUD();
    button('hint-btn').click();
    remoteConfigService.setValuesForTest({ hintRwEnabled: false });
    button('hint-booster-watch-ad').click();
    expect(show).not.toHaveBeenCalled();
    expect(gameState.rewardedHintsToday).toBe(0);
  });

});
