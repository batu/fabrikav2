import { describe, expect, it } from 'vitest';
import { resolveCdnOriginForRuntime } from '../../src/config/cdn';

const BIRD_CDN_ORIGIN = 'https://ftb-level-origin.batuaytemiz.workers.dev';

describe('Find the Bird CDN configuration', () => {
  it('uses the Bird worker as the production and Android fallback', () => {
    expect(resolveCdnOriginForRuntime({}, 'ios', 'production')).toBe(BIRD_CDN_ORIGIN);
    expect(resolveCdnOriginForRuntime({}, 'android', 'development')).toBe(BIRD_CDN_ORIGIN);
  });

  it('preserves explicit runtime overrides', () => {
    expect(
      resolveCdnOriginForRuntime(
        {
          VITE_CDN_ORIGIN_ANDROID: 'https://android.example.test',
          VITE_CDN_ORIGIN_PROD: 'https://production.example.test',
          VITE_CDN_ORIGIN_DEV: 'https://development.example.test',
        },
        'android',
        'production',
      ),
    ).toBe('https://android.example.test');

    expect(
      resolveCdnOriginForRuntime(
        {
          VITE_CDN_ORIGIN_PROD: 'https://production.example.test',
          VITE_CDN_ORIGIN_DEV: 'https://development.example.test',
        },
        'ios',
        'development',
      ),
    ).toBe('https://development.example.test');
  });

  it('returns null when CDN delivery is explicitly disabled', () => {
    expect(resolveCdnOriginForRuntime({ VITE_CDN_ENABLED: 'false' }, 'ios', 'production')).toBeNull();
  });
});
