import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from './contract.ts';
import { ENV_PARAM_KEY } from './contract.ts';
import { createConsoleSink } from './console-sink.ts';

const EVENT: AnalyticsEvent = {
  name: 'purchase',
  params: { product_id: 'coins_100', price_usd: 0.99 },
  timestamp: 1_700_000_000_000,
  sessionId: 'sess-1',
  env: 'development',
};

describe('createConsoleSink', () => {
  it('writes the event name and the env-tagged flattened payload', () => {
    const log = vi.fn();
    const sink = createConsoleSink({ log });

    sink.emit(EVENT);

    expect(log).toHaveBeenCalledTimes(1);
    const [name, payload] = log.mock.calls[0]!;
    expect(name).toBe('purchase');
    expect(payload[ENV_PARAM_KEY]).toBe('development');
    expect(payload.product_id).toBe('coins_100');
  });
});
