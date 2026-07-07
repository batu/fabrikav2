// iOS device detection from `xcrun devicectl list devices --json-output <file>`.
// The device serial is NEVER hardcoded (card constraint): the CLI reads the
// connected device from devicectl JSON, or honours an explicit --device <udid>.
// These are pure functions over the already-parsed JSON so they unit-test
// without a Mac or a device attached.

/**
 * Extract connected iOS devices from parsed devicectl JSON.
 * @param {any} json result of `devicectl list devices --json-output`
 * @returns {Array<{udid:string, name:string, platform:string, state:string}>}
 */
export function parseDeviceList(json) {
  const devices = json?.result?.devices;
  if (!Array.isArray(devices)) return [];
  return devices
    .map((d) => ({
      udid: d?.hardwareProperties?.udid || d?.identifier || '',
      name: d?.deviceProperties?.name || '(unnamed)',
      platform: d?.hardwareProperties?.platform || '',
      state: d?.connectionProperties?.tunnelState || '',
      pairingState: d?.connectionProperties?.pairingState || '',
    }))
    .filter((d) => d.udid && /^iOS$/i.test(d.platform) && isUsable(d));
}

// A device usable for build/install/test is one that is PAIRED. tunnelState is
// established on demand by xcodebuild/devicectl, so an idle paired+wired device
// reports tunnelState 'disconnected' — the earlier tunnelState-only check
// rejected every idle device (found on verify-device's first live device run).
function isUsable(d) {
  return (
    d.pairingState === 'paired' || d.state === 'connected' || d.state === 'available'
  );
}

/**
 * Choose the target device.
 * @param {Array<{udid:string,name:string}>} devices connected iOS devices
 * @param {string|undefined} preferredUdid explicit --device value
 * @returns {{device:{udid:string,name:string}|null, reason:string}}
 *   device=null means "skip gracefully" (no device); reason explains the pick/skip.
 *   Throws only on an unsatisfiable explicit request or an ambiguous auto-pick.
 */
export function pickDevice(devices, preferredUdid) {
  if (preferredUdid) {
    const match = devices.find((d) => d.udid === preferredUdid);
    if (!match) {
      throw new Error(
        `requested --device ${preferredUdid} is not a connected iOS device ` +
        `(connected: ${devices.map((d) => d.udid).join(', ') || 'none'})`
      );
    }
    return { device: match, reason: `using requested device ${match.name} (${match.udid})` };
  }
  if (devices.length === 0) {
    return { device: null, reason: 'no connected iOS device' };
  }
  if (devices.length > 1) {
    throw new Error(
      `multiple connected iOS devices — pass --device <udid>: ` +
      devices.map((d) => `${d.name}=${d.udid}`).join(', ')
    );
  }
  const d = devices[0];
  return { device: d, reason: `auto-selected the only connected device ${d.name} (${d.udid})` };
}
