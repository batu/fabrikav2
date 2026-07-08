export function parsePlatform(v, label = '--platform') {
  if (v !== 'auto' && v !== 'ios' && v !== 'android') {
    throw new Error(`${label} must be "auto", "ios", or "android", got: ${v}`);
  }
  return v;
}

export function resolveDevicePlatform({ args = {}, manifest = {}, device = {} } = {}) {
  const requested = parsePlatform(args.platform || 'auto');
  if (requested !== 'auto') return requested;

  if (device.platform !== undefined && device.platform !== null) {
    return parsePlatform(device.platform, 'devices.json platform');
  }

  const configured = manifest.verifyDevice?.platform;
  if (configured !== undefined && configured !== null) {
    return parsePlatform(configured, 'verifyDevice.platform');
  }
  return 'ios';
}
