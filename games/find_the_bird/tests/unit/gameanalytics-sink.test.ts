import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from '@fabrikav2/sdk/analytics';
import { createGameAnalyticsSink, type GameAnalyticsSdk } from '../../src/analytics/GameAnalyticsSink';

function event(name: string, params: AnalyticsEvent['params']): AnalyticsEvent {
  return { name, params, timestamp: 1, sessionId: 's', env: 'development' };
}

describe('GameAnalytics AnalyticsSink', () => {
  it('initializes allowlists before the SDK and preserves falsy custom fields as strings', async () => {
    const calls: string[] = [];
    const addDesignEvent = vi.fn();
    const sdk: GameAnalyticsSdk = {
      GameAnalytics: {
        setEnabledInfoLog: vi.fn(() => calls.push('info')),
        setEnabledVerboseLog: vi.fn(() => calls.push('verbose')),
        configureAvailableResourceCurrencies: vi.fn(() => calls.push('currencies')),
        configureAvailableResourceItemTypes: vi.fn(() => calls.push('types')),
        initialize: vi.fn(() => calls.push('initialize')),
        addProgressionEvent: vi.fn(),
        addDesignEvent,
        addResourceEvent: vi.fn(),
        addAdEvent: vi.fn(),
      },
      EGAProgressionStatus: { Start: 1, Complete: 2, Fail: 3 },
      EGAResourceFlowType: { Source: 1, Sink: 2 },
      EGAAdAction: { Show: 1, FailedShow: 2, RewardReceived: 3, Undefined: 0 },
      EGAAdType: { Banner: 1, Interstitial: 2, RewardedVideo: 3 },
    };
    const sink = createGameAnalyticsSink(
      { gameKey: 'g'.repeat(32), secretKey: 's'.repeat(40), verboseLogging: false },
      { loader: vi.fn(async () => sdk) },
    );

    sink.emit(event('dog_found', { level_id: 'l1', dog_index: 0 }));
    sink.emit(event('purchase_fulfilled', { product_id: 'p', no_ads: false, hints: 0, coins: 0, continue_level: false }));
    await sink.flush?.();

    expect(calls.indexOf('currencies')).toBeLessThan(calls.indexOf('initialize'));
    expect(calls.indexOf('types')).toBeLessThan(calls.indexOf('initialize'));
    expect(addDesignEvent).toHaveBeenCalledWith('dog:found', undefined, expect.objectContaining({ dog_index: '0' }));
    expect(addDesignEvent).toHaveBeenCalledWith('purchase:fulfilled', undefined, expect.objectContaining({
      no_ads: 'false',
      hints: '0',
      coins: '0',
      continue_level: 'false',
    }));
  });
});
