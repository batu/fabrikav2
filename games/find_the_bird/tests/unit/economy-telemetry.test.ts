import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/audio/AudioManager', () => ({ playUITap: vi.fn(), playHint: vi.fn(), setMusicEnabled: vi.fn(), setSoundEffectsEnabled: vi.fn(), setMusicPausedForAd: vi.fn() }));
vi.mock('../../src/ui/EconomyTransfer', () => ({ animateHintsToBalance: vi.fn() }));
vi.mock('../../src/platform/storageFallback', () => ({ runtimeStorageDurability: 'durable' }));

import { gameState } from '../../src/core/GameState';
import { analytics } from '../../src/analytics/AnalyticsService';
import { adService, setRewardedAdResultForTest } from '../../src/ads/Service';
import { showTrackedEconomyReward } from '../../src/analytics/EconomyTelemetry';
import { initHUD, setHintCallback } from '../../src/ui/HUD';
import { remoteConfigService } from '../../src/config/RemoteConfigService';

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) });
  gameState.reset();
  gameState.setHintsForTest(0);
  gameState.setCoinsForTest(0);
  gameState.settings.adsEnabled = true;
  remoteConfigService.setValuesForTest({ hintRwEnabled: true });
  document.body.innerHTML = '<div id="hud-overlay"></div>';
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setRewardedAdResultForTest(null); document.body.innerHTML = ''; });

describe('hint offer telemetry', () => {
  it('records visible options once, including zero balance, affordability and cap status', () => {
    const shown = vi.spyOn(analytics, 'offerShown');
    const snapshot = vi.spyOn(analytics, 'economySnapshot');
    const outcome = vi.spyOn(analytics, 'offerOutcome');
    vi.spyOn(gameState, 'isRewardedHintCapped').mockReturnValue(true);
    initHUD();
    document.getElementById('hint-btn')!.click();
    document.getElementById('hint-btn')!.click();
    expect(shown).toHaveBeenCalledTimes(4);
    expect(shown).toHaveBeenCalledWith(expect.objectContaining({ offer_type: 'coinSingle', status: 'insufficientCoins', coins: 0, hints: 0, coin_price: 250 }));
    expect(shown).toHaveBeenCalledWith(expect.objectContaining({ offer_type: 'rewardedAd', status: 'disabled', rewarded_hint_capped: true }));
    expect(snapshot).toHaveBeenCalledTimes(1);
    document.getElementById('hint-booster-close')!.click();
    expect(outcome).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'declined' }));
  });

  it('records coin selection and preserves the wallet transaction and hint callback', () => {
    gameState.setCoinsForTest(250);
    const outcome = vi.spyOn(analytics, 'offerOutcome');
    const callback = vi.fn();
    setHintCallback(callback);
    initHUD();
    document.getElementById('hint-btn')!.click();
    document.getElementById('hint-booster-buy-single')!.click();
    expect(outcome).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ offer_type: 'coinSingle', outcome: 'selected', coins: 250 }));
    expect(gameState.coinBalance).toBe(0);
    expect(gameState.hintsRemaining).toBe(1);
    expect(callback).toHaveBeenCalledOnce();
  });

  it.each([true, false])('records provider granted=%s separately from local grants', async (granted) => {
    setRewardedAdResultForTest({ granted });
    const attempt = vi.spyOn(analytics, 'rewardedAttempt');
    const grant = vi.spyOn(analytics, 'rewardedAdGranted');
    await expect(showTrackedEconomyReward('level_complete_double')).resolves.toEqual({ granted });
    expect(attempt.mock.calls.map(([p]) => p.outcome)).toEqual(['requested', granted ? 'provider_granted' : 'not_granted']);
    expect(grant).not.toHaveBeenCalled();
    expect(gameState.hintsRemaining).toBe(0);
  });

  it('records provider errors without claiming a video dismissal or local grant', async () => {
    vi.spyOn(adService, 'showRewardedAd').mockRejectedValue(new Error('native failure'));
    const attempt = vi.spyOn(analytics, 'rewardedAttempt');
    await expect(showTrackedEconomyReward('hint_button')).rejects.toThrow('native failure');
    expect(attempt.mock.calls.map(([p]) => p.outcome)).toEqual(['requested', 'failed']);
  });
});
