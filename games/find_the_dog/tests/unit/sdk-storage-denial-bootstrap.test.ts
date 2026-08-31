import { afterEach, describe, expect, it, vi } from 'vitest';

const originalWindow = window;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('SDK storage denial composition', () => {
  it('boots getSdkContext with an unreplaceable throwing localStorage getter and fails analytics closed', async () => {
    const deniedWindow = new Proxy(originalWindow, {
      get(target, property, receiver) {
        if (property === 'localStorage') throw new DOMException('denied', 'SecurityError');
        return Reflect.get(target, property, receiver);
      },
      defineProperty(_target, property) {
        if (property === 'localStorage') return false;
        return true;
      },
    });
    vi.stubGlobal('window', deniedWindow);
    vi.resetModules();

    const { getSdkContext } = await import('../../src/sdk/SdkContext');
    const { analytics } = await import('../../src/analytics/AnalyticsService');
    const context = getSdkContext();
    await analytics.init({ hadExistingStateAtBootstrap: false });
    await analytics.appOpen();

    expect(context.analyticsRing.drain().map(({ name, params }) => [name, params.first_open])).toEqual([
      ['session_start', false],
      ['app_open', undefined],
    ]);
  });
});
