import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  androidDeviceSerial,
  iosDeviceUdid,
  loadDeviceRegistry,
  normalizeDeviceRegistry,
  resolveDeviceConfig,
} from '../src/deviceRegistry.mjs';

const tmpDirs = [];

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-devices-'));
  tmpDirs.push(dir);
  return dir;
}

function registry() {
  return normalizeDeviceRegistry({
    devices: [
      {
        name: 'iphone-local',
        platform: 'ios',
        udid: 'IOS-UDID',
        contentInsets: { top: 130 },
      },
      {
        name: 'pixel-remote',
        platform: 'android',
        serial: 'PIXEL-SERIAL',
        ssh: 'ubuntu-server',
        androidSdk: '/home/batu/android-sdk',
        contentInsets: { top: 72, bottom: 96 },
      },
    ],
  });
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('device registry loading', () => {
  it('loads a repo-local devices.json and normalizes ssh-prefixed Android fields', () => {
    const repoRoot = tmpDir();
    fs.writeFileSync(path.join(repoRoot, 'devices.json'), JSON.stringify({
      devices: [
        {
          name: 'pixel-remote',
          platform: 'android',
          serial: 'PIXEL-SERIAL',
          ssh: 'ubuntu-server',
          contentInsets: { top: 72, bottom: 96 },
        },
      ],
    }));

    const loaded = loadDeviceRegistry({ repoRoot, env: {} });

    expect(loaded.path).toBe(path.join(repoRoot, 'devices.json'));
    expect(loaded.devices).toEqual([
      {
        name: 'pixel-remote',
        platform: 'android',
        serial: 'PIXEL-SERIAL',
        adbPrefix: 'ssh ubuntu-server adb',
        buildPrefix: 'ssh ubuntu-server',
        contentInsets: { top: 72, bottom: 96 },
      },
    ]);
  });

  it('returns an empty registry when no local devices.json exists', () => {
    expect(loadDeviceRegistry({ repoRoot: tmpDir(), env: {} })).toEqual({ path: null, devices: [] });
  });

  it('fails explicit registry paths loudly', () => {
    expect(() => loadDeviceRegistry({
      repoRoot: tmpDir(),
      env: { VERIFY_DEVICE_REGISTRY: '/tmp/missing-devices.json' },
    })).toThrow(/device registry not found/);
  });

  it('rejects duplicate names and invalid platforms', () => {
    expect(() => normalizeDeviceRegistry({
      devices: [
        { name: 'same', platform: 'ios' },
        { name: 'same', platform: 'android' },
      ],
    })).toThrow(/duplicate device name/);
    expect(() => normalizeDeviceRegistry({
      devices: [{ name: 'unknown', platform: 'browser' }],
    })).toThrow(/ios.*android/);
  });
});

describe('device registry resolution precedence', () => {
  it('uses --device over env and manifest defaults, then env values over registry fields', () => {
    const resolved = resolveDeviceConfig({
      args: {
        device: 'pixel-remote',
        adbPrefix: 'cli adb',
      },
      manifest: {
        verifyDevice: {
          defaultDevice: 'iphone-local',
        },
      },
      registry: registry(),
      env: {
        VERIFY_DEVICE_NAME: 'iphone-local',
        VERIFY_DEVICE_SERIAL: 'ENV-SERIAL',
        VERIFY_DEVICE_BUILD_PREFIX: 'env build',
      },
    });

    expect(resolved).toMatchObject({
      name: 'pixel-remote',
      source: '--device',
      platform: 'android',
      serial: 'ENV-SERIAL',
      adbPrefix: 'cli adb',
      buildPrefix: 'env build',
      androidSdk: '/home/batu/android-sdk',
      contentInsets: { top: 72, bottom: 96 },
    });
    expect(androidDeviceSerial(resolved)).toBe('ENV-SERIAL');
  });

  it('uses VERIFY_DEVICE_NAME over the manifest default device', () => {
    const resolved = resolveDeviceConfig({
      args: {},
      manifest: {
        verifyDevice: {
          defaultDevice: 'iphone-local',
        },
      },
      registry: registry(),
      env: {
        VERIFY_DEVICE_NAME: 'pixel-remote',
      },
    });

    expect(resolved.name).toBe('pixel-remote');
    expect(resolved.source).toBe('VERIFY_DEVICE_NAME');
    expect(resolved.platform).toBe('android');
  });

  it('uses verifyDevice.defaultDevice when no CLI or env device is set', () => {
    const resolved = resolveDeviceConfig({
      args: {},
      manifest: {
        verifyDevice: {
          defaultDevice: 'iphone-local',
        },
      },
      registry: registry(),
      env: {},
    });

    expect(resolved.name).toBe('iphone-local');
    expect(resolved.source).toBe('verifyDevice.defaultDevice');
    expect(iosDeviceUdid(resolved)).toBe('IOS-UDID');
  });

  it('fails an unknown manifest-pinned device instead of silently auto-selecting', () => {
    expect(() => resolveDeviceConfig({
      args: {},
      manifest: {
        verifyDevice: {
          defaultDevice: 'missing',
        },
      },
      registry: registry(),
      env: {},
    })).toThrow(/unknown device "missing"/);
  });

  it('keeps legacy raw --device behavior when no registry is present', () => {
    const resolved = resolveDeviceConfig({
      args: { device: 'RAW-TARGET' },
      manifest: {},
      registry: [],
      env: {
        VERIFY_DEVICE_ADB_PREFIX: 'ssh old-host adb',
      },
    });

    expect(resolved.source).toBe('legacy --device');
    expect(iosDeviceUdid(resolved)).toBe('RAW-TARGET');
    expect(androidDeviceSerial(resolved)).toBe('RAW-TARGET');
    expect(resolved.adbPrefix).toBe('ssh old-host adb');
  });
});
