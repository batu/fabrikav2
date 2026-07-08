import fs from 'node:fs';
import path from 'node:path';
import { normalizeContentInsetTop } from './contentInset.mjs';
import { parsePlatform } from './platform.mjs';

export function loadDeviceRegistry({ repoRoot = process.cwd(), env = process.env, registryPath } = {}) {
  const explicitPath = registryPath || env.VERIFY_DEVICE_REGISTRY;
  const candidates = explicitPath
    ? [path.resolve(explicitPath)]
    : [
        path.join(repoRoot, 'devices.json'),
        path.join(repoRoot, 'tools', 'verify-device', 'devices.json'),
      ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    if (explicitPath) throw new Error(`device registry not found: ${path.resolve(explicitPath)}`);
    return { path: null, devices: [] };
  }
  const raw = JSON.parse(fs.readFileSync(found, 'utf8'));
  return { path: found, devices: normalizeDeviceRegistry(raw, found) };
}

export function normalizeDeviceRegistry(raw, source = 'devices.json') {
  const devices = Array.isArray(raw) ? raw : raw?.devices;
  if (!Array.isArray(devices)) {
    throw new Error(`${source}: expected a JSON array or an object with a devices array`);
  }
  const seen = new Set();
  return devices.map((entry, index) => {
    const device = normalizeDeviceEntry(entry, `${source}[${index}]`);
    if (seen.has(device.name)) throw new Error(`${source}: duplicate device name "${device.name}"`);
    seen.add(device.name);
    return device;
  });
}

export function resolveDeviceConfig({ args = {}, manifest = {}, registry = [], env = {} } = {}) {
  const devices = registryDevices(registry);
  const byName = new Map(devices.map((device) => [device.name, device]));
  const request = requestedDeviceName({ args, manifest, env });
  const selected = request.value ? byName.get(request.value) : null;
  let legacyTarget;

  if (request.value && !selected) {
    if (request.source === '--device' && devices.length === 0) {
      legacyTarget = request.value;
    } else {
      const known = devices.map((device) => device.name).join(', ') || 'none';
      throw new Error(`unknown device "${request.value}" from ${request.source}; known devices: ${known}`);
    }
  }

  return cleanObject({
    name: selected?.name || null,
    source: selected ? request.source : legacyTarget ? 'legacy --device' : 'auto',
    platform: firstDefined(
      parseOptionalPlatform(env.VERIFY_DEVICE_PLATFORM, 'VERIFY_DEVICE_PLATFORM'),
      selected?.platform,
    ),
    udid: firstDefined(env.VERIFY_DEVICE_UDID, selected?.udid),
    serial: firstDefined(env.VERIFY_DEVICE_SERIAL, env.ANDROID_SERIAL, selected?.serial),
    legacyTarget,
    adbPrefix: firstDefined(args.adbPrefix, env.VERIFY_DEVICE_ADB_PREFIX, selected?.adbPrefix),
    buildPrefix: firstDefined(args.buildPrefix, env.VERIFY_DEVICE_BUILD_PREFIX, selected?.buildPrefix),
    androidSdk: firstDefined(args.androidSdk, env.VERIFY_DEVICE_ANDROID_SDK, selected?.androidSdk),
    contentInsets: selected?.contentInsets,
  });
}

export function iosDeviceUdid(config = {}) {
  return firstDefined(config.udid, config.legacyTarget);
}

export function androidDeviceSerial(config = {}) {
  return firstDefined(config.serial, config.legacyTarget);
}

function requestedDeviceName({ args = {}, manifest = {}, env = {} } = {}) {
  if (args.device !== undefined) return { value: args.device, source: '--device' };
  if (env.VERIFY_DEVICE_NAME) return { value: env.VERIFY_DEVICE_NAME, source: 'VERIFY_DEVICE_NAME' };
  const verifyDevice = manifest.verifyDevice || {};
  if (verifyDevice.defaultDevice) {
    return { value: verifyDevice.defaultDevice, source: 'verifyDevice.defaultDevice' };
  }
  if (verifyDevice.device) {
    return { value: verifyDevice.device, source: 'verifyDevice.device' };
  }
  return { value: null, source: 'auto' };
}

function normalizeDeviceEntry(entry, label) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${label}: device entry must be an object`);
  }
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!name) throw new Error(`${label}.name must be a non-empty string`);
  const platform = parseConcretePlatform(entry.platform, `${label}.platform`);
  const sshHost = firstDefined(entry.ssh, entry.host, entry.sshHost);
  return cleanObject({
    name,
    platform,
    udid: stringOrUndefined(entry.udid),
    serial: stringOrUndefined(entry.serial),
    adbPrefix: stringOrUndefined(entry.adbPrefix)
      || (platform === 'android' && sshHost ? `ssh ${sshHost} adb` : undefined),
    buildPrefix: stringOrUndefined(entry.buildPrefix)
      || (sshHost ? `ssh ${sshHost}` : undefined),
    androidSdk: stringOrUndefined(entry.androidSdk),
    contentInsets: normalizeRegistryContentInsets(entry, label),
  });
}

function parseConcretePlatform(value, label) {
  const platform = parsePlatform(value, label);
  if (platform === 'auto') throw new Error(`${label} must be "ios" or "android", got: auto`);
  return platform;
}

function parseOptionalPlatform(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  return parseConcretePlatform(value, label);
}

function normalizeRegistryContentInsets(entry, label) {
  const source = entry.contentInsets && typeof entry.contentInsets === 'object'
    ? entry.contentInsets
    : {};
  const top = firstDefined(source.top, source.contentInsetTop, entry.contentInsetTop);
  const bottom = firstDefined(source.bottom, source.contentInsetBottom, entry.contentInsetBottom);
  if (top === undefined && bottom === undefined) return undefined;
  return cleanObject({
    top: top === undefined ? undefined : normalizeContentInsetTop(top, `${label}.contentInsets.top`),
    bottom: bottom === undefined ? undefined : normalizeContentInsetTop(bottom, `${label}.contentInsets.bottom`),
  });
}

function registryDevices(registry) {
  if (Array.isArray(registry)) return registry;
  if (Array.isArray(registry?.devices)) return registry.devices;
  return [];
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function stringOrUndefined(value) {
  if (value === undefined || value === null) return undefined;
  const string = String(value).trim();
  return string || undefined;
}

function cleanObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}
