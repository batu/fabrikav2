import { describe, expect, test } from 'vitest';

import { wrapSnapshot } from './envelope.ts';

describe('wrapSnapshot', (): void => {
  test('stamps the wrong-package guard fields onto the envelope', (): void => {
    const envelope = wrapSnapshot(
      { scene: 'menu', coins: 3 },
      { buildVersion: '1.4.0', packageId: 'com.fabrikav2.marble_run', now: () => 1234 },
    );

    expect(envelope).toEqual({
      fingerprint: { scene: 'menu', coins: 3 },
      ts: 1234,
      buildVersion: '1.4.0',
      packageId: 'com.fabrikav2.marble_run',
    });
  });

  test('passes the inner fingerprint through untouched (does not interpret it)', (): void => {
    const fingerprint = { arbitrary: ['shape', 42], nested: { ok: true } };
    const envelope = wrapSnapshot(fingerprint, {
      buildVersion: 'dev',
      packageId: 'com.example',
      now: () => 0,
    });
    expect(envelope.fingerprint).toBe(fingerprint);
  });

  test('uses the injected monotonic clock for ts', (): void => {
    let tick = 100;
    const now = (): number => (tick += 5);
    const a = wrapSnapshot(null, { buildVersion: 'x', packageId: 'y', now });
    const b = wrapSnapshot(null, { buildVersion: 'x', packageId: 'y', now });
    expect(b.ts).toBeGreaterThan(a.ts);
  });
});
