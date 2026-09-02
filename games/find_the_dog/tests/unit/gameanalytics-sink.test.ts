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
        isSdkReady: vi.fn()
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(false)
          .mockReturnValue(true),
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
      app_version: '1.0.4',
      build: '1.0.4+abc123',
      platform: 'ios',
      game: 'find_the_dog',
      cohort_bucket: 7,
      purchase_id: 'purchase-secret-123456',
      ad_impression_id: 'impression-secret-123456',
    }));
    sink.emit(event('purchase_fulfilled', { product_id: 'p', no_ads: false, hints: 0, coins: 0, continue_level: false }));
    await sink.flush?.();

    expect(calls).not.toContain('stop');
    expect(calls).not.toContain('resume');
    expect(sink.diagnostics?.()?.lastSuccessfulFlushAt).toBeNull();

    expect(calls.indexOf('currencies')).toBeLessThan(calls.indexOf('initialize'));
    expect(calls.indexOf('types')).toBeLessThan(calls.indexOf('initialize'));
    expect(addDesignEvent).toHaveBeenCalledWith('dog:found', undefined, {
      app_version: '1.0.4',
      build: '1.0.4+abc123',
      cohort_bucket: '7',
      dog_index: '0',
      game: 'find_the_dog',
      level_id: 'l1',
      platform: 'ios',
    });
    expect(addDesignEvent).toHaveBeenCalledWith('purchase:fulfilled', undefined, expect.objectContaining({
      no_ads: 'false',
      hints: '0',
      coins: '0',
      continue_level: 'false',
    }));
  });

  it('accepts the callable browser namespace and waits for SDK readiness', async () => {
    const initialize = vi.fn();
    const isSdkReady = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const addDesignEvent = vi.fn();
    const GameAnalytics = Object.assign(() => undefined, {
      setEnabledInfoLog: vi.fn(),
      setEnabledVerboseLog: vi.fn(),
      configureAvailableResourceCurrencies: vi.fn(),
      configureAvailableResourceItemTypes: vi.fn(),
      initialize,
      isSdkReady,
      addProgressionEvent: vi.fn(),
      addDesignEvent,
      addResourceEvent: vi.fn(),
      addAdEvent: vi.fn(),
    });
    const sdk = {
      GameAnalytics,
      EGAProgressionStatus: { Start: 1, Complete: 2, Fail: 3 },
      EGAResourceFlowType: { Source: 1, Sink: 2 },
      EGAAdAction: { Show: 1, FailedShow: 2, RewardReceived: 3, Undefined: 0 },
      EGAAdType: { Banner: 1, Interstitial: 2, RewardedVideo: 3 },
    } as unknown as GameAnalyticsSdk;
    const sink = createGameAnalyticsSink(
      { gameKey: 'g'.repeat(32), secretKey: 's'.repeat(40), verboseLogging: false },
      { loader: vi.fn(async () => sdk) },
    );

    sink.emit(event('dog_found', { level_id: 'l1', dog_index: 0 }));
    await sink.flush?.();

    expect(initialize).toHaveBeenCalledWith('g'.repeat(32), 's'.repeat(40));
    expect(isSdkReady).toHaveBeenCalled();
    expect(addDesignEvent).toHaveBeenCalledWith(
      'dog:found',
      undefined,
      expect.objectContaining({ dog_index: '0' }),
    );
  });

  it('logs initialization failures as readable messages', async () => {
    const warn = vi.fn();
    const sink = createGameAnalyticsSink(
      { gameKey: 'g'.repeat(32), secretKey: 's'.repeat(40), verboseLogging: false },
      {
        loader: vi.fn(async () => { throw new Error('dynamic import exploded'); }),
        logger: { warn },
      },
    );

    sink.emit(event('dog_found', { level_id: 'l1', dog_index: 0 }));
    await sink.flush?.();

    expect(warn).toHaveBeenCalledWith(
      '[analytics:gameanalytics] initialization failed (Error)',
    );
    expect(sink.diagnostics?.()).toEqual({
      queued: 0,
      sent: 0,
      retried: 0,
      dropped: 1,
      initializationFailure: 'Error',
      lastSuccessfulFlushAt: null,
    });

    sink.emit(event('dog_found', { level_id: 'l2', dog_index: 1 }));
    expect(sink.diagnostics?.()?.dropped).toBe(2);
  });

  it('maps ad_request to a supported design event instead of rejected Undefined ad action', async () => {
    const addDesignEvent = vi.fn();
    const addAdEvent = vi.fn();
    const sdk = gameAnalyticsSdk({ addDesignEvent, addAdEvent });
    const sink = createGameAnalyticsSink(validConfig(), { loader: vi.fn(async () => sdk) });

    sink.emit(event('ad_request', { placement: 'level_end', ad_type: 'interstitial', provider: 'admob' }));
    await sink.flush?.();

    expect(addAdEvent).not.toHaveBeenCalled();
    expect(addDesignEvent).toHaveBeenCalledWith('ad:request', undefined, expect.any(Object));
  });

  it('counts the throwing event and every still-queued event as dropped when queued dispatch fails', async () => {
    const addDesignEvent = vi.fn(() => { throw new Error('dispatch failed'); });
    const sdk = gameAnalyticsSdk({ addDesignEvent });
    const sink = createGameAnalyticsSink(validConfig(), { loader: vi.fn(async () => sdk), logger: { warn: vi.fn() } });

    sink.emit(event('dog_found', { level_id: 'l1', dog_index: 0 }));
    sink.emit(event('dog_found', { level_id: 'l1', dog_index: 1 }));
    sink.emit(event('dog_found', { level_id: 'l1', dog_index: 2 }));
    await sink.flush?.();

    expect(sink.diagnostics?.()).toMatchObject({ queued: 0, sent: 0, dropped: 3 });
  });

  it('counts a dispatch exception after initialization as one dropped event', async () => {
    const addDesignEvent = vi.fn();
    const sdk = gameAnalyticsSdk({ addDesignEvent });
    const sink = createGameAnalyticsSink(validConfig(), { loader: vi.fn(async () => sdk) });

    sink.emit(event('dog_found', { level_id: 'l1', dog_index: 0 }));
    await sink.flush?.();
    addDesignEvent.mockImplementationOnce(() => { throw new Error('dispatch failed'); });

    expect(() => sink.emit(event('dog_found', { level_id: 'l1', dog_index: 1 }))).toThrow('dispatch failed');
    expect(sink.diagnostics?.()?.dropped).toBe(1);
  });

  it('counts a non-positive resource event as dropped rather than sent', async () => {
    const addResourceEvent = vi.fn();
    const sdk = gameAnalyticsSdk({ addResourceEvent });
    const sink = createGameAnalyticsSink(validConfig(), { loader: vi.fn(async () => sdk) });

    sink.emit(event('resource_change', {
      currency: 'coins',
      flow: 'source',
      amount: 0,
      item_type: 'shop',
      reason: 'invalid_zero_award',
    }));
    await sink.flush?.();

    expect(addResourceEvent).not.toHaveBeenCalled();
    expect(sink.diagnostics?.()).toMatchObject({ sent: 0, dropped: 1 });
  });

  it.each([
    ['purchase_initiated', 'purchase:initiated', { product_id: 'hints_pack', surface: 'shop' }],
    ['purchase_cancelled', 'purchase:cancelled', { product_id: 'hints_pack', surface: 'fail_continue' }],
    ['purchase_failed', 'purchase:failed', { product_id: 'hints_pack', surface: 'shop', reason: 'failed', failure_kind: 'timeout' }],
  ])('maps %s with declared dimensions while rejecting arbitrary params', async (name, wireName, dimensions) => {
    const addDesignEvent = vi.fn();
    const sink = createGameAnalyticsSink(validConfig(), {
      loader: vi.fn(async () => gameAnalyticsSdk({ addDesignEvent })),
    });

    sink.emit(event(name, { ...dimensions, arbitrary_param: 'must-not-leak' }));
    await sink.flush?.();

    expect(addDesignEvent).toHaveBeenCalledWith(wireName, undefined, dimensions);
    expect(addDesignEvent.mock.calls[0]?.[2]).not.toHaveProperty('arbitrary_param');
  });

  it.each([
    ['app_background', 'app:background', {}],
    ['app_foreground', 'app:foreground', {}],
    ['product_tapped', 'store:product_tap', { product_id: 'hints_pack' }],
    ['purchase_sheet_shown', 'purchase:sheet_shown', { product_id: 'hints_pack' }],
    ['iap_state_changed', 'iap:state_changed', { state: 'ready', reason: 'catalog_loaded' }],
  ])('preserves allowed fields for canonical design event %s', async (name, wireName, eventFields) => {
    const addDesignEvent = vi.fn();
    const sink = createGameAnalyticsSink(validConfig(), {
      loader: vi.fn(async () => gameAnalyticsSdk({ addDesignEvent })),
    });

    sink.emit(event(name, {
      ...eventFields,
      app_version: '1.0.4',
      build: '1.0.4+abc123',
      platform: 'ios',
      game: 'find_the_dog',
      cohort_bucket: 7,
    }));
    await sink.flush?.();

    expect(addDesignEvent).toHaveBeenCalledWith(wireName, undefined, expect.objectContaining({
      app_version: '1.0.4',
      build: '1.0.4+abc123',
      cohort_bucket: '7',
      game: 'find_the_dog',
      platform: 'ios',
    }));
  });
});

function validConfig() {
  return { gameKey: 'g'.repeat(32), secretKey: 's'.repeat(40), verboseLogging: false };
}

function gameAnalyticsSdk(overrides: Partial<GameAnalyticsSdk['GameAnalytics']> = {}): GameAnalyticsSdk {
  return {
    GameAnalytics: {
      setEnabledInfoLog: vi.fn(),
      setEnabledVerboseLog: vi.fn(),
      configureAvailableResourceCurrencies: vi.fn(),
      configureAvailableResourceItemTypes: vi.fn(),
      initialize: vi.fn(),
      isSdkReady: vi.fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)
        .mockReturnValue(true),
      addProgressionEvent: vi.fn(),
      addDesignEvent: vi.fn(),
      addResourceEvent: vi.fn(),
      addAdEvent: vi.fn(),
      ...overrides,
    },
    EGAProgressionStatus: { Start: 1, Complete: 2, Fail: 3 },
    EGAResourceFlowType: { Source: 1, Sink: 2 },
    EGAAdAction: { Show: 1, FailedShow: 2, RewardReceived: 3 },
    EGAAdType: { Banner: 1, Interstitial: 2, RewardedVideo: 3 },
  };
}
