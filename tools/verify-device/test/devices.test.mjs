import { describe, it, expect } from 'vitest';
import { parseDeviceList, pickDevice } from '../src/devices.mjs';

// Shaped like `xcrun devicectl list devices --json-output`.
function dev({
  udid,
  name = 'iPhone',
  platform = 'iOS',
  state = 'connected',
  pairingState,
}) {
  return {
    identifier: udid,
    hardwareProperties: { udid, platform },
    deviceProperties: { name },
    connectionProperties: { tunnelState: state, pairingState },
  };
}

describe('parseDeviceList', () => {
  it('keeps only connected iOS devices', () => {
    const json = { result: { devices: [
      dev({ udid: 'A', name: 'iPhone A' }),
      dev({ udid: 'B', name: 'Mac', platform: 'macOS' }),
      dev({ udid: 'C', name: 'Disconnected', state: 'unavailable' }),
      dev({ udid: 'D', name: 'iPhone D', state: 'available' }),
    ] } };
    expect(parseDeviceList(json).map((d) => d.udid).sort()).toEqual(['A', 'D']);
  });

  it('keeps paired idle devices even when their tunnel is disconnected', () => {
    const json = { result: { devices: [
      dev({ udid: 'P', state: 'disconnected', pairingState: 'paired' }),
    ] } };
    expect(parseDeviceList(json).map((d) => d.udid)).toEqual(['P']);
  });

  it('excludes explicitly unpaired devices even if tunnel state looks usable', () => {
    const json = { result: { devices: [
      dev({ udid: 'U1', state: 'connected', pairingState: 'unpaired' }),
      dev({ udid: 'U2', state: 'available', pairingState: 'unpaired' }),
    ] } };
    expect(parseDeviceList(json)).toEqual([]);
  });

  it('keeps connected/available devices for older devicectl shapes without pairingState', () => {
    const json = { result: { devices: [
      dev({ udid: 'C', state: 'connected' }),
      dev({ udid: 'A', state: 'available' }),
      dev({ udid: 'D', state: 'disconnected' }),
    ] } };
    expect(parseDeviceList(json).map((d) => d.udid).sort()).toEqual(['A', 'C']);
  });

  it('is empty-safe for missing/garbage shapes', () => {
    expect(parseDeviceList(null)).toEqual([]);
    expect(parseDeviceList({})).toEqual([]);
    expect(parseDeviceList({ result: { devices: [] } })).toEqual([]);
  });
});

describe('pickDevice', () => {
  const A = { udid: 'A', name: 'iPhone A' };
  const B = { udid: 'B', name: 'iPhone B' };

  it('auto-selects the single connected device', () => {
    const { device, reason } = pickDevice([A], undefined);
    expect(device).toBe(A);
    expect(reason).toMatch(/auto-selected/);
  });

  it('returns null (graceful skip) when none are connected', () => {
    const { device, reason } = pickDevice([], undefined);
    expect(device).toBeNull();
    expect(reason).toMatch(/no connected/);
  });

  it('throws on ambiguous auto-pick', () => {
    expect(() => pickDevice([A, B], undefined)).toThrow(/multiple connected/);
  });

  it('honours an explicit --device and validates it', () => {
    expect(pickDevice([A, B], 'B').device).toBe(B);
    expect(() => pickDevice([A], 'Z')).toThrow(/not a connected iOS device/);
  });
});
