import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

vi.mock('@capacitor/app', () => ({ App: { getInfo: vi.fn() } }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
import type { AnalyticsEvent } from '@fabrikav2/sdk/analytics';
import { createGameAnalyticsSink, type GameAnalyticsSdk } from '../../src/analytics/GameAnalyticsSink';

function event(name: string, params: AnalyticsEvent['params']): AnalyticsEvent {
  return { name, params, timestamp: 1, sessionId: 's', env: 'development' };
}

describe('GameAnalytics AnalyticsSink', () => {
  it.each(['empty', 'rejected', 'timeout'])('does not emit unidentifiable native traffic when app info is %s', async (failure) => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.mocked(App.getInfo).mockImplementation(() => failure === 'timeout'
      ? new Promise(() => {})
      : failure === 'rejected' ? Promise.reject(new Error('bridge failed'))
        : Promise.resolve({ name: 'Find', id: 'com.example.find', version: '', build: '' }));
    const sdk = gameAnalyticsSdk();
    const sink = createGameAnalyticsSink(validConfig(), {
      loader: async () => sdk, logger: { warn: vi.fn() }, maxInitAttempts: 2, readyTimeoutMs: 5,
    });
    sink.emit(event('session_start', { build: '1.2.0+abc123' }));
    await sink.flush?.();
    expect(sdk.GameAnalytics.initialize).not.toHaveBeenCalled();
    expect(sink.diagnostics()).toMatchObject({ sent: 0, dropped: 1, queued: 0, retried: 1 });
    expect(App.getInfo).toHaveBeenCalledTimes(2);
  }, 500);

  it('stamps queued and subsequent GA events from native archive identity without replacing source provenance', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    let resolveInfo!: (info: Awaited<ReturnType<typeof App.getInfo>>) => void;
    vi.mocked(App.getInfo).mockImplementation(() => new Promise((resolve) => { resolveInfo = resolve; }));
    const sdk = gameAnalyticsSdk();
    const sink = createGameAnalyticsSink(validConfig(), { loader: async () => sdk });
    const params = { app_version: '1.2.0', build: '1.2.0+abc123-dirty', native_app_version: 'stale', native_build_number: '0' };
    sink.emit(event('session_start', params));
    await vi.waitFor(() => expect(App.getInfo).toHaveBeenCalledTimes(1));
    expect(sdk.GameAnalytics.initialize).not.toHaveBeenCalled();
    resolveInfo({ name: 'Find', id: 'com.example.find', version: '1.2.1', build: '35' });
    await sink.flush?.();
    sink.emit(event('dog_found', params));
    for (const name of ['session:start', 'dog:found']) {
      expect(sdk.GameAnalytics.addDesignEvent).toHaveBeenCalledWith(name, undefined, expect.objectContaining({
        app_version: '1.2.0', build: '1.2.0+abc123-dirty',
        native_app_version: '1.2.1', native_build_number: '35',
      }));
    }
    expect(App.getInfo).toHaveBeenCalledTimes(1);
    expect(params.native_build_number).toBe('0');
  });

  it('adopts the native session created by gameanalytics@4.4.7 and only starts after a real end', async () => {
    const calls: string[] = [];
    let nativeSessionActive = false;
    const sdk = gameAnalyticsSdk();
    const manual = {
      setEnabledManualSessionHandling: vi.fn(() => calls.push('manual')),
      startSession: vi.fn(() => {
        if (nativeSessionActive) calls.push('implicit-end-from-start');
        nativeSessionActive = true;
        calls.push('start');
      }),
      endSession: vi.fn(() => {
        nativeSessionActive = false;
        calls.push('end');
      }),
    };
    Object.assign(sdk.GameAnalytics, manual, {
      // Faithfully model 4.4.7: initialize unconditionally creates a session,
      // regardless of setEnabledManualSessionHandling(true).
      initialize: vi.fn(() => {
        nativeSessionActive = true;
        calls.push('initialize-created-session');
      }),
      addDesignEvent: vi.fn((_name: string) => calls.push('design')),
    });
    const sink = createGameAnalyticsSink(validConfig(), { loader: vi.fn(async () => sdk) });

    sink.emit(event('session_start', { first_open: true }));
    sink.emit(event('session_end', {}));
    sink.emit(event('session_start', { first_open: false }));
    await sink.flush?.();

    expect(calls.indexOf('manual')).toBeLessThan(calls.indexOf('initialize-created-session'));
    expect(manual.setEnabledManualSessionHandling).toHaveBeenCalledWith(true);
    expect(manual.startSession).toHaveBeenCalledTimes(1);
    expect(manual.endSession).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'manual',
      'initialize-created-session',
      'design',
      'design',
      'end',
      'start',
      'design',
    ]);
  });

  it('initializes allowlists before the SDK and preserves falsy custom fields as strings', async () => {
    const calls: string[] = [];
    const addDesignEvent = vi.fn();
    const sdk: GameAnalyticsSdk = {
      GameAnalytics: {
        setEnabledInfoLog: vi.fn(() => calls.push('info')),
        setEnabledVerboseLog: vi.fn(() => calls.push('verbose')),
        configureAvailableResourceCurrencies: vi.fn(() => calls.push('currencies')),
        configureAvailableResourceItemTypes: vi.fn(() => calls.push('types')),
        setEnabledManualSessionHandling: vi.fn(),
        initialize: vi.fn(() => calls.push('initialize')),
        startSession: vi.fn(),
        endSession: vi.fn(),
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
      setEnabledManualSessionHandling: vi.fn(),
      initialize,
      startSession: vi.fn(),
      endSession: vi.fn(),
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

  it('preserves queued events across a transient loader failure and retries during flush', async () => {
    const warn = vi.fn();
    const sdk = gameAnalyticsSdk();
    const loader = vi.fn()
      .mockRejectedValueOnce(new TypeError('network canary'))
      .mockResolvedValue(sdk);
    const sink = createGameAnalyticsSink(
      { gameKey: 'g'.repeat(32), secretKey: 's'.repeat(40), verboseLogging: false },
      { loader, logger: { warn }, retryDelayMs: 0 },
    );

    sink.emit(event('dog_found', { level_id: 'l1', dog_index: 0 }));
    await vi.waitFor(() => expect(sink.diagnostics?.()?.initializationFailure).toBe('TypeError'));

    expect(warn).toHaveBeenCalledWith(
      '[analytics:gameanalytics] initialization failed (TypeError)',
    );
    expect(sink.diagnostics?.()).toMatchObject({ queued: 1, sent: 0, dropped: 0, initializationFailure: 'TypeError' });

    await sink.flush?.();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(sink.diagnostics?.()).toMatchObject({ queued: 0, sent: 1, retried: 1, dropped: 0, initializationFailure: null });

    sink.emit(event('dog_found', { level_id: 'l2', dog_index: 1 }));
    await sink.flush?.();
    expect(sink.diagnostics?.()).toMatchObject({ queued: 0, sent: 2, retried: 1, dropped: 0, initializationFailure: null });
  });

  it('bypasses retry cooldown so a suspend flush drains lifecycle events immediately', async () => {
    vi.useFakeTimers();
    try {
      const addDesignEvent = vi.fn();
      const endSession = vi.fn();
      const sdk = gameAnalyticsSdk({ addDesignEvent, endSession });
      const loader = vi.fn()
        .mockRejectedValueOnce(new TypeError('temporary loader failure'))
        .mockResolvedValue(sdk);
      const sink = createGameAnalyticsSink(validConfig(), {
        loader,
        logger: { warn: vi.fn() },
        retryDelayMs: 50,
      });

      sink.emit(event('app_background', {}));
      sink.emit(event('session_end', {}));
      const flushing = sink.flush?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(loader).toHaveBeenCalledTimes(2);
      await flushing;

      expect(addDesignEvent).toHaveBeenCalledTimes(2);
      expect(endSession).toHaveBeenCalledTimes(1);
      expect(sink.diagnostics?.()).toMatchObject({ queued: 0, sent: 2, retried: 1, dropped: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds the pre-initialization queue and truthfully counts evicted events', () => {
    const sink = createGameAnalyticsSink(validConfig(), {
      loader: vi.fn(() => new Promise(() => undefined)),
      maxQueueItems: 2,
    });

    sink.emit(event('dog_found', { dog_index: 0 }));
    sink.emit(event('dog_found', { dog_index: 1 }));
    sink.emit(event('dog_found', { dog_index: 2 }));

    expect(sink.diagnostics?.()).toMatchObject({ queued: 2, sent: 0, dropped: 1 });
  });

  it('stops retrying a permanently failing loader and drops queued and later events truthfully', async () => {
    const loader = vi.fn(async () => { throw new TypeError('permanent loader failure'); });
    const sink = createGameAnalyticsSink(validConfig(), {
      loader,
      logger: { warn: vi.fn() },
      retryDelayMs: 0,
      maxInitAttempts: 2,
    });

    sink.emit(event('dog_found', { dog_index: 0 }));
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    sink.emit(event('dog_found', { dog_index: 1 }));
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    sink.emit(event('dog_found', { dog_index: 2 }));

    expect(loader).toHaveBeenCalledTimes(2);
    expect(sink.diagnostics?.()).toMatchObject({
      queued: 0,
      sent: 0,
      retried: 1,
      dropped: 3,
      initializationFailure: 'TypeError',
    });
  });

  it('permanently disables an incomplete SDK without leaking its error detail', async () => {
    const warn = vi.fn();
    const sink = createGameAnalyticsSink(validConfig(), {
      loader: vi.fn(async () => ({ GameAnalytics: {} })),
      logger: { warn },
    });
    sink.emit(event('dog_found', { level_id: 'secret-canary', dog_index: 0 }));
    await sink.flush?.();
    sink.emit(event('dog_found', { level_id: 'l2', dog_index: 1 }));

    expect(warn).toHaveBeenCalledWith('[analytics:gameanalytics] initialization failed (SdkShapeError)');
    expect(sink.diagnostics?.()).toMatchObject({ queued: 0, sent: 0, dropped: 2, initializationFailure: 'SdkShapeError' });
    expect(JSON.stringify(sink.diagnostics?.())).not.toContain('secret-canary');
  });

  it('preserves timed-out events and retries once on a later event without reinitializing', async () => {
    vi.useFakeTimers();
    try {
      let ready = false;
      const sdk = gameAnalyticsSdk({ isSdkReady: vi.fn(() => ready) });
      const loader = vi.fn(async () => sdk);
      const initialize = vi.mocked(sdk.GameAnalytics.initialize);
      const addDesignEvent = vi.mocked(sdk.GameAnalytics.addDesignEvent);
      const sink = createGameAnalyticsSink(validConfig(), {
        loader,
        logger: { warn: vi.fn() },
        readyTimeoutMs: 10,
        readyPollMs: 1,
        retryDelayMs: 5,
      });

      sink.emit(event('dog_found', { level_id: 'l1', dog_index: 0 }));
      await vi.advanceTimersByTimeAsync(10_001);
      expect(sink.diagnostics?.()).toMatchObject({ queued: 1, sent: 0, dropped: 0, initializationFailure: 'SdkReadyTimeout' });

      sink.emit(event('dog_found', { level_id: 'l1', dog_index: 1 }));
      sink.emit(event('dog_found', { level_id: 'l1', dog_index: 2 }));
      expect(loader).toHaveBeenCalledTimes(1);
      ready = true;
      await vi.advanceTimersByTimeAsync(5);
      await sink.flush?.();

      expect(loader).toHaveBeenCalledTimes(1);
      expect(initialize).toHaveBeenCalledTimes(1);
      expect(addDesignEvent).toHaveBeenCalledTimes(3);
      expect(sink.diagnostics?.()).toMatchObject({ queued: 0, sent: 3, retried: 1, dropped: 0, initializationFailure: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports flush attempts with the same diagnostic contract as Find the Bird', async () => {
    const sink = createGameAnalyticsSink(validConfig(), {
      loader: vi.fn(async () => gameAnalyticsSdk()),
    });

    sink.emit(event('dog_found', { dog_index: 0 }));
    await sink.flush?.();
    await sink.flush?.();

    expect(sink.diagnostics?.()).toMatchObject({ flushAttempts: 2, lastSuccessfulFlushAt: null });
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
      setEnabledManualSessionHandling: vi.fn(),
      initialize: vi.fn(),
      startSession: vi.fn(),
      endSession: vi.fn(),
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
