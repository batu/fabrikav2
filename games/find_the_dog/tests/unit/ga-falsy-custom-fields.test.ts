import { describe, expect, it } from 'vitest';
import { designEvent, type GameAnalyticsCustomFields } from '../../src/analytics/GameAnalyticsEvents';

/**
 * Faithful mock of GameAnalytics JS SDK 4.4.7's validateAndCleanCustomFields
 * (GameAnalytics.debug.js:1892-1906): any entry whose VALUE is falsy is
 * silently dropped (`if (!key || !value)`), and non-string/non-number values
 * are dropped too. This ate 7,987 custom fields (`dog_index: 0`,
 * `restored_something: false`, …) during the 2026-06 UA test — the garbled
 * `key={0}` warnings in the GA error feed. compactCustomFields stringifies
 * numbers and booleans specifically to survive this validator; these tests
 * pin that behavior.
 */
function sdkValidateAndClean(fields: GameAnalyticsCustomFields): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const key in fields) {
    const value = fields[key];
    if (!key || !value) continue; // the falsy drop
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    if (!/^[a-zA-Z0-9_]{1,64}$/.test(key)) continue;
    out[key] = value;
  }
  return out;
}

describe('GA custom fields survive the SDK falsy-value drop', () => {
  it('a numeric 0 arrives at the SDK as the string "0"', () => {
    const event = designEvent('dog:found', { dog_index: 0, time_since_start: 12.5 });
    expect(event.customFields?.dog_index).toBe('0');
    const surviving = sdkValidateAndClean(event.customFields ?? {});
    expect(surviving.dog_index).toBe('0');
    expect(surviving.time_since_start).toBe('12.5');
  });

  it('a boolean false arrives at the SDK as the string "false"', () => {
    const event = designEvent('purchase:fulfilled', { no_ads: false, coins: 0 });
    expect(event.customFields?.no_ads).toBe('false');
    const surviving = sdkValidateAndClean(event.customFields ?? {});
    expect(surviving.no_ads).toBe('false');
    expect(surviving.coins).toBe('0');
  });

  it('regression shape: RAW 0/false would have been dropped by the validator', () => {
    // Documents the original bug: without stringification these vanish.
    expect(sdkValidateAndClean({ dog_index: 0, restored_something: false })).toEqual({});
  });
});
