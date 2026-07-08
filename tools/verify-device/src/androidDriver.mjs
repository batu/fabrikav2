import fs from 'node:fs';
import path from 'node:path';
import { execCommandParts, splitCommandPrefix } from './command.mjs';

export const DEFAULT_ANDROID_STATE_TIMEOUT_MS = 25_000;
export const DEFAULT_ANDROID_POLL_MS = 250;

export function buildAdbCommandParts({ adbPrefix = 'adb', serial, adbArgs = [] } = {}) {
  const parts = splitCommandPrefix(adbPrefix, 'adb prefix');
  return serial ? [...parts, '-s', String(serial), ...adbArgs] : [...parts, ...adbArgs];
}

export function extractUiAutomatorMarkerValues(dump) {
  const values = [];
  const re = /\b(?:text|content-desc)="([^"]*)"/g;
  let match;
  while ((match = re.exec(String(dump || ''))) !== null) {
    values.push(decodeXmlAttr(match[1]));
  }
  return values;
}

export function readTourMarker(dump, state) {
  const values = new Set(extractUiAutomatorMarkerValues(dump));
  const exact = `tourstate:${state}`;
  if (values.has(exact)) return 'reached';
  if (values.has(`${exact}-FAILED`)) return 'failed';
  if (values.has(`${exact}-DONE`)) return 'retired';
  if (values.has('tourstate:done')) return 'done';
  return 'missing';
}

export function hasExactTourStateMarker(dump, state) {
  return readTourMarker(dump, state) === 'reached';
}

export async function waitForAndroidTourState({
  state,
  dumpUi,
  timeoutMs = DEFAULT_ANDROID_STATE_TIMEOUT_MS,
  pollMs = DEFAULT_ANDROID_POLL_MS,
  sleep = defaultSleep,
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    const dump = dumpUi();
    const marker = readTourMarker(dump, state);
    if (marker === 'reached') return { status: 'reached', dump };
    if (marker === 'failed') return { status: 'failed', dump };
    await sleep(pollMs);
  }
  return { status: 'timeout' };
}

export async function waitForAndroidTourRetire({
  state,
  dumpUi,
  timeoutMs = DEFAULT_ANDROID_STATE_TIMEOUT_MS,
  pollMs = DEFAULT_ANDROID_POLL_MS,
  sleep = defaultSleep,
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    const dump = dumpUi();
    const marker = readTourMarker(dump, state);
    if (marker === 'retired' || marker === 'done') return { status: 'retired', dump };
    if (marker === 'failed') return { status: 'failed', dump };
    await sleep(pollMs);
  }
  return { status: 'timeout' };
}

export function dumpAndroidUi({ adbPrefix, serial, shImpl = execCommandParts } = {}) {
  const remotePath = '/sdcard/verify-device-window.xml';
  shImpl(buildAdbCommandParts({
    adbPrefix,
    serial,
    adbArgs: ['shell', 'uiautomator', 'dump', remotePath],
  }));
  return String(shImpl(buildAdbCommandParts({
    adbPrefix,
    serial,
    adbArgs: ['shell', 'cat', remotePath],
  })));
}

export function captureAndroidPng({ adbPrefix, serial, outFile, shImpl = execCommandParts } = {}) {
  const png = shImpl(buildAdbCommandParts({
    adbPrefix,
    serial,
    adbArgs: ['exec-out', 'screencap', '-p'],
  }));
  const buffer = Buffer.isBuffer(png) ? png : Buffer.from(String(png), 'binary');
  if (!isPng(buffer)) {
    throw new Error('adb exec-out screencap did not return a PNG');
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buffer);
  return outFile;
}

export async function captureAndroidStates({
  states,
  outDir,
  adbPrefix = process.env.VERIFY_DEVICE_ADB_PREFIX || 'adb',
  serial,
  timeoutMs = DEFAULT_ANDROID_STATE_TIMEOUT_MS,
  pollMs = DEFAULT_ANDROID_POLL_MS,
  shImpl = execCommandParts,
  dumpUi,
  capturePng,
  sleep = defaultSleep,
  now = Date.now,
} = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const captures = {};
  const failures = [];
  const readDump = dumpUi || (() => dumpAndroidUi({ adbPrefix, serial, shImpl }));
  const shoot = capturePng || ((outFile) => captureAndroidPng({ adbPrefix, serial, outFile, shImpl }));

  for (const state of states || []) {
    const reached = await waitForAndroidTourState({
      state, dumpUi: readDump, timeoutMs, pollMs, sleep, now,
    });
    if (reached.status !== 'reached') {
      failures.push(androidStateFailure(state, reached.status));
      continue;
    }

    const outFile = path.join(outDir, `${state}.png`);
    shoot(outFile, state);
    captures[state] = outFile;

    const retired = await waitForAndroidTourRetire({
      state, dumpUi: readDump, timeoutMs, pollMs, sleep, now,
    });
    if (retired.status !== 'retired') {
      failures.push(androidRetireFailure(state, retired.status));
    }
  }

  return { captures, failures };
}

function androidStateFailure(state, status) {
  if (status === 'failed') {
    return `state "${state}" published exact tourstate:${state}-FAILED before capture`;
  }
  return `state "${state}" never published exact tourstate:${state} before timeout`;
}

function androidRetireFailure(state, status) {
  if (status === 'failed') {
    return `state "${state}" published tourstate:${state}-FAILED while waiting for retire`;
  }
  return `state "${state}" never retired exact tourstate:${state}-DONE before timeout`;
}

function decodeXmlAttr(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function isPng(buffer) {
  return buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
