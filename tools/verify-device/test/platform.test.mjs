import { describe, it, expect } from 'vitest';
import { parsePlatform, resolveDevicePlatform } from '../src/platform.mjs';

describe('device platform selection', () => {
  it('validates platform names', () => {
    expect(parsePlatform('auto')).toBe('auto');
    expect(parsePlatform('ios')).toBe('ios');
    expect(parsePlatform('android')).toBe('android');
    expect(() => parsePlatform('browser')).toThrow(/auto.*ios.*android/);
  });

  it('honors CLI override, then registry device platform, then manifest platform, then iOS default', () => {
    expect(resolveDevicePlatform({ args: { platform: 'android' }, manifest: {} })).toBe('android');
    expect(resolveDevicePlatform({
      args: { platform: 'auto' },
      manifest: { verifyDevice: { platform: 'ios' } },
      device: { platform: 'android' },
    })).toBe('android');
    expect(resolveDevicePlatform({
      args: { platform: 'auto' },
      manifest: { verifyDevice: { platform: 'android' } },
    })).toBe('android');
    expect(resolveDevicePlatform({ args: { platform: 'auto' }, manifest: {} })).toBe('ios');
  });
});
