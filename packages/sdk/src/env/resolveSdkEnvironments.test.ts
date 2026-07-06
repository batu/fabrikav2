import { describe, expect, it } from 'vitest';
import { resolveSdkEnvironments } from './resolveSdkEnvironments.ts';

describe('resolveSdkEnvironments', () => {
  it('maps the development build to the sandbox/test row for every SDK', () => {
    expect(resolveSdkEnvironments('development')).toEqual({
      analytics: 'development',
      adjust: 'sandbox',
      admobTestMode: true,
      revenuecatSandbox: true,
    });
  });

  it('maps the production build to the live row for every SDK', () => {
    expect(resolveSdkEnvironments('production')).toEqual({
      analytics: 'production',
      adjust: 'production',
      admobTestMode: false,
      revenuecatSandbox: false,
    });
  });

  it('NEVER yields production analytics/adjust from the development build (pollution guard)', () => {
    const dev = resolveSdkEnvironments('development');
    expect(dev.analytics).not.toBe('production');
    expect(dev.adjust).not.toBe('production');
    // dev must also keep the money/test-mode flags in the safe position.
    expect(dev.admobTestMode).toBe(true);
    expect(dev.revenuecatSandbox).toBe(true);
  });
});
