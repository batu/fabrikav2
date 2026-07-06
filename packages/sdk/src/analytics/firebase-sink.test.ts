import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from './contract.ts';
import { ENV_PARAM_KEY } from './contract.ts';
import { createFirebaseSink, type FirebaseTransport } from './firebase-sink.ts';

const EVENT: AnalyticsEvent = {
  name: 'purchase',
  params: { product_id: 'no_ads', no_ads: true, quantity: 1 },
  timestamp: 1_700_000_000_000,
  sessionId: 'sess-1',
  env: 'test',
};

function fakeTransport(): FirebaseTransport & {
  logEvent: ReturnType<typeof vi.fn>;
} {
  return { logEvent: vi.fn(() => Promise.resolve()) };
}

describe('createFirebaseSink', () => {
  it('forwards name + env-tagged params, coercing booleans to strings', () => {
    const transport = fakeTransport();
    createFirebaseSink(transport).emit(EVENT);

    expect(transport.logEvent).toHaveBeenCalledTimes(1);
    const [name, params] = transport.logEvent.mock.calls[0]!;
    expect(name).toBe('purchase');
    // env marker present on the third-party payload
    expect(params[ENV_PARAM_KEY]).toBe('test');
    // native Firebase bundle drops booleans → coerced to strings
    expect(params.no_ads).toBe('true');
    // numbers pass through untouched
    expect(params.quantity).toBe(1);
  });

  it('swallows a rejecting transport (no unhandled rejection into the game)', async () => {
    const transport: FirebaseTransport = {
      logEvent: vi.fn(() => Promise.reject(new Error('bridge down'))),
    };
    expect(() => createFirebaseSink(transport).emit(EVENT)).not.toThrow();
    // give the swallowed rejection a tick to settle
    await Promise.resolve();
  });
});
