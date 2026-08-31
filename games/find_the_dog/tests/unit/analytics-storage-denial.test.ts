import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

afterEach(() => {
  vi.resetModules();
  if (originalDescriptor === undefined) Reflect.deleteProperty(window, 'localStorage');
  else Object.defineProperty(window, 'localStorage', originalDescriptor);
});

describe('AnalyticsService storage denial', () => {
  it('does not crash module import when the localStorage getter throws', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new DOMException('denied', 'SecurityError'); },
    });

    await expect(import('../../src/analytics/AnalyticsService')).resolves.toHaveProperty('analytics');
  });
});
