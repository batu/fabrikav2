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
        isSdkReady: vi.fn(() => true),
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

    sink.emit(event('dog_found', {
      level_id: 'l1',
      dog_index: 0,
      app_version: '1.2.0',
      build: '1.2.0+abc123',
      platform: 'ios',
      game: 'find_the_bird',
      environment: 'production',
      user_id: 'user-secret-123456',
      device_id: 'device-secret-123456',
      session_id: 'session-secret-123456',
      purchase_id: 'purchase-secret-123456',
      ad_impression_id: 'impression-secret-123456',
    }));
    sink.emit(event('purchase_fulfilled', { product_id: 'p', no_ads: false, hints: 0, coins: 0, continue_level: false }));
    await sink.flush?.();

    expect(calls.indexOf('currencies')).toBeLessThan(calls.indexOf('initialize'));
    expect(calls.indexOf('types')).toBeLessThan(calls.indexOf('initialize'));
    expect(addDesignEvent).toHaveBeenCalledWith('dog:found', undefined, {
      app_version: '1.2.0',
      build: '1.2.0+abc123',
      dog_index: '0',
      environment: 'production',
      game: 'find_the_bird',
      level_id: 'l1',
      platform: 'ios',
    });
    expect(addDesignEvent).toHaveBeenCalledWith('purchase:fulfilled', undefined, expect.objectContaining({
      no_ads: 'false',
      hints: '0',
      coins: '0',
      continue_level: 'false',
    }));
    expect(sink.diagnostics?.()).toMatchObject({
      queued: 0,
      sent: 2,
      dropped: 0,
      lastSuccessfulFlushAt: null,
    });
  });

  it('reports initialization failure, drops queued events, and records flush attempts without claiming backend acknowledgement', async () => {
    const warn = vi.fn();
    const sink = createGameAnalyticsSink(
      { gameKey: 'a'.repeat(32), secretKey: 'b'.repeat(40), verboseLogging: false },
      { loader: vi.fn(async () => { throw new TypeError('secret-canary'); }), logger: { warn } },
    );

    sink.emit(event('dog_found', { level_id: 'l1', dog_index: 0 }));
    await sink.flush?.();

    expect(warn).toHaveBeenCalledWith('[analytics:gameanalytics] initialization failed (TypeError)');
    expect(sink.diagnostics?.()).toEqual({
      queued: 0,
      sent: 0,
      retried: 0,
      dropped: 1,
      initializationFailure: 'TypeError',
      flushAttempts: 1,
      lastSuccessfulFlushAt: null,
    });
    expect(JSON.stringify(sink.diagnostics?.())).not.toContain('secret-canary');
  });
});
