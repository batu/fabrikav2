import { describe, it, expect } from 'vitest';
// Importing this module guards its (device-gated, otherwise unexercised) syntax.
import { adbCommand, captureV2 } from '../src/capture.mjs';

describe('capture lane helpers (live lanes are device-gated)', () => {
  it('builds an ssh+adb command with a serial', () => {
    const { cmd, args } = adbCommand(
      { host: 'ubuntu-server', adb: '/home/batu/android-sdk/platform-tools/adb', serial: 'ABC123' },
      ['exec-out', 'screencap', '-p'],
    );
    expect(cmd).toBe('ssh');
    expect(args[0]).toBe('ubuntu-server');
    expect(args[1]).toContain('-s ABC123');
    expect(args[1]).toContain('exec-out screencap -p');
  });

  it('omits -s when no serial is configured', () => {
    const { args } = adbCommand(
      { host: 'ubuntu-server', adb: 'adb', serial: null },
      ['shell', 'dumpsys'],
    );
    expect(args[1]).not.toContain('-s ');
  });

  it('v2 live lane refuses clearly until the harness card lands', async () => {
    await expect(captureV2()).rejects.toThrow(/harness driveTo/);
  });
});
