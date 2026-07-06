import { describe, expect, it } from 'vitest';
import {
  CANONICAL_EVENT_NAMES,
  ENV_PARAM_KEY,
  SESSION_PARAM_KEY,
  TIMESTAMP_PARAM_KEY,
  compactParams,
  isCanonicalEventName,
  toWirePayload,
  type AnalyticsEvent,
} from './contract.ts';

describe('canonical event core', () => {
  it('has unique, game-agnostic event names', () => {
    const unique = new Set<string>(CANONICAL_EVENT_NAMES);
    expect(unique.size).toBe(CANONICAL_EVENT_NAMES.length);
    // no game-specific leakage (FTD's dog_found etc. must NOT be here)
    expect(unique.has('dog_found')).toBe(false);
    // the core the card enumerates is present
    for (const name of [
      'session_start',
      'level_start',
      'level_complete',
      'level_fail',
      'purchase',
      'ad_impression',
      'resource_change',
    ]) {
      expect(unique.has(name)).toBe(true);
    }
  });

  it('classifies canonical vs extension names', () => {
    expect(isCanonicalEventName('level_start')).toBe(true);
    expect(isCanonicalEventName('dog_found')).toBe(false);
  });
});

describe('toWirePayload — the env-marker chokepoint', () => {
  const event: AnalyticsEvent = {
    name: 'level_start',
    params: { level_id: 'l1', level_index: 0 },
    timestamp: 1_700_000_000_000,
    sessionId: 'sess-1',
    env: 'test',
  };

  it('injects the mandatory environment marker into every payload', () => {
    const wire = toWirePayload(event);
    expect(wire[ENV_PARAM_KEY]).toBe('test');
    expect(wire[SESSION_PARAM_KEY]).toBe('sess-1');
    expect(wire[TIMESTAMP_PARAM_KEY]).toBe(1_700_000_000_000);
    // original dimensions survive
    expect(wire.level_id).toBe('l1');
  });

  it('never lets an explicit param shadow the env marker', () => {
    const spoofed: AnalyticsEvent = {
      ...event,
      // a caller tries to override env via params
      params: { [ENV_PARAM_KEY]: 'production', level_id: 'l1' },
    };
    expect(toWirePayload(spoofed)[ENV_PARAM_KEY]).toBe('test');
  });
});

describe('compactParams', () => {
  it('drops undefined and null but keeps falsy primitives', () => {
    expect(
      compactParams({
        a: 0,
        b: false,
        c: '',
        d: undefined,
        e: null,
      }),
    ).toEqual({ a: 0, b: false, c: '' });
  });
});
