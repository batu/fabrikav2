import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdjustAttributionPlugin } from './AdjustAttributionPlugin.ts';

describe('AdjustAttribution plugin registration', (): void => {
  afterEach((): void => {
    vi.doUnmock('@capacitor/core');
    vi.resetModules();
  });

  it('registers the native bridge under the AdjustAttribution plugin name', async (): Promise<void> => {
    const registeredPlugin = {} as AdjustAttributionPlugin;
    const registerPlugin = vi.fn((): AdjustAttributionPlugin => registeredPlugin);
    vi.doMock('@capacitor/core', () => ({
      registerPlugin,
    }));

    const module = await import('./AdjustAttributionPlugin.ts');

    expect(registerPlugin).toHaveBeenCalledWith('AdjustAttribution');
    expect(module.AdjustAttribution).toBe(registeredPlugin);
  });
});
