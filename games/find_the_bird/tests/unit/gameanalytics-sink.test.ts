import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from '@fabrikav2/sdk/analytics';
import { createGameAnalyticsSink, type GameAnalyticsSdk } from '../../src/analytics/GameAnalyticsSink';

function event(name: string, params: AnalyticsEvent['params']): AnalyticsEvent {
  return { name, params, timestamp: 1, sessionId: 's', env: 'development' };
}

describe('GameAnalytics AnalyticsSink', () => {
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

  it('uses the Find the Bird namespace for progression events', async () => {
    const addProgressionEvent = vi.fn();
    const sdk = gameAnalyticsSdk({ addProgressionEvent });
    const sink = createGameAnalyticsSink(validConfig(), { loader: vi.fn(async () => sdk) });

    sink.emit(event('level_start', { level_id: 'level_1' }));
    await sink.flush?.();

    expect(addProgressionEvent).toHaveBeenCalledWith(
      1,
      'find_the_bird',
      'level_1',
      undefined,
      undefined,
      expect.any(Object),
    );
  });

  it.each([true, false])('maps first_open=%s as a queryable non-identifying dimension', async (firstOpen) => {
    const addDesignEvent = vi.fn();
    const sdk = gameAnalyticsSdk({ addDesignEvent });
    const sink = createGameAnalyticsSink(validConfig(), { loader: vi.fn(async () => sdk) });

    sink.emit(event('session_start', {
      first_open: firstOpen,
      user_id: 'user-secret-123456',
      device_id: 'device-secret-123456',
    }));
    await sink.flush?.();

    expect(addDesignEvent).toHaveBeenCalledWith('session:start', undefined, {
      first_open: String(firstOpen),
    });
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
  ])('preserves approved provenance for canonical design event %s', async (name, wireName, eventFields) => {
    const addDesignEvent = vi.fn();
    const sink = createGameAnalyticsSink(validConfig(), {
      loader: vi.fn(async () => gameAnalyticsSdk({ addDesignEvent })),
    });

    sink.emit(event(name, {
      ...eventFields,
      app_version: '1.2.0',
      build: '1.2.0+abc123',
      platform: 'ios',
      game: 'find_the_bird',
      environment: 'production',
      cohort_bucket: 7,
      user_id: 'user-secret-123456',
    }));
    await sink.flush?.();

    expect(addDesignEvent).toHaveBeenCalledWith(wireName, undefined, expect.objectContaining({
      app_version: '1.2.0',
      build: '1.2.0+abc123',
      platform: 'ios',
      game: 'find_the_bird',
      environment: 'production',
      cohort_bucket: '7',
    }));
    expect(addDesignEvent.mock.calls[0]?.[2]).not.toHaveProperty('user_id');
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
    expect(sink.diagnostics()).toMatchObject({ sent: 1, dropped: 0 });
  });

  it('preserves queued events across a transient loader failure and retries during flush', async () => {
    const sdk = gameAnalyticsSdk();
    const loader = vi.fn()
      .mockRejectedValueOnce(new TypeError('network canary'))
      .mockResolvedValue(sdk);
    const sink = createGameAnalyticsSink(validConfig(), {
      loader,
      logger: { warn: vi.fn() },
      retryDelayMs: 0,
    });

    sink.emit(event('dog_found', { level_id: 'l1', dog_index: 0 }));
    await vi.waitFor(() => expect(sink.diagnostics().initializationFailure).toBe('TypeError'));
    expect(sink.diagnostics()).toMatchObject({ queued: 1, sent: 0, dropped: 0, initializationFailure: 'TypeError' });

    await sink.flush?.();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(sink.diagnostics()).toMatchObject({ queued: 0, sent: 1, retried: 1, dropped: 0, initializationFailure: null });

    sink.emit(event('dog_found', { level_id: 'l1', dog_index: 1 }));
    await sink.flush?.();
    expect(sink.diagnostics()).toMatchObject({ queued: 0, sent: 2, retried: 1, dropped: 0, initializationFailure: null });
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
      expect(sink.diagnostics()).toMatchObject({ queued: 0, sent: 2, retried: 1, dropped: 0 });
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
    expect(sink.diagnostics()).toMatchObject({ queued: 2, sent: 0, dropped: 1 });
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
    expect(sink.diagnostics()).toMatchObject({ queued: 0, sent: 0, retried: 1, dropped: 3, initializationFailure: 'TypeError' });
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
      expect(sink.diagnostics()).toMatchObject({ queued: 1, sent: 0, dropped: 0, initializationFailure: 'SdkReadyTimeout' });

      sink.emit(event('dog_found', { level_id: 'l1', dog_index: 1 }));
      sink.emit(event('dog_found', { level_id: 'l1', dog_index: 2 }));
      expect(loader).toHaveBeenCalledTimes(1);
      ready = true;
      await vi.advanceTimersByTimeAsync(5);
      await sink.flush?.();

      expect(loader).toHaveBeenCalledTimes(1);
      expect(initialize).toHaveBeenCalledTimes(1);
      expect(addDesignEvent).toHaveBeenCalledTimes(3);
      expect(sink.diagnostics()).toMatchObject({ queued: 0, sent: 3, retried: 1, dropped: 0, initializationFailure: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a hard SDK shape failure, drops queued events, and never claims backend acknowledgement', async () => {
    const warn = vi.fn();
    const sink = createGameAnalyticsSink(
      { gameKey: 'a'.repeat(32), secretKey: 'b'.repeat(40), verboseLogging: false },
      { loader: vi.fn(async () => ({ notGameAnalytics: true })), logger: { warn } },
    );

    sink.emit(event('dog_found', { level_id: 'l1', dog_index: 0 }));
    await sink.flush?.();

    expect(warn).toHaveBeenCalledWith('[analytics:gameanalytics] initialization failed (SdkShapeError)');
    expect(sink.diagnostics?.()).toEqual({
      queued: 0,
      sent: 0,
      retried: 0,
      dropped: 1,
      initializationFailure: 'SdkShapeError',
      flushAttempts: 1,
      lastSuccessfulFlushAt: null,
    });
    sink.emit(event('dog_found', { level_id: 'l2', dog_index: 1 }));
    expect(sink.diagnostics()).toMatchObject({ queued: 0, dropped: 2 });
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
      isSdkReady: vi.fn(() => true),
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
