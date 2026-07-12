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

export function extractLogcatEpochMs(line) {
  const match = String(line || '').match(/^\s*(\d{10,13})(?:\.(\d{1,9}))?\s+/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  if (match[1].length >= 13) return base;
  const millis = match[2] ? Number(match[2].padEnd(3, '0').slice(0, 3)) : 0;
  return (base * 1000) + millis;
}

export function extractInsituTourLogcatEvents(logcat, { sinceEpochMs } = {}) {
  const events = [];
  const since = Number.isFinite(sinceEpochMs) ? Number(sinceEpochMs) : null;
  for (const line of String(logcat || '').split(/\r?\n/)) {
    if (!line.includes('[insituTour]')) continue;
    const epochMs = extractLogcatEpochMs(line);
    if (since !== null && (epochMs === null || epochMs < since)) continue;
    const match = line.match(/\[insituTour\][^"\n\r]*\bstate=([A-Za-z0-9_-]+)/);
    if (match) events.push({ state: match[1], epochMs, line });
  }
  return events;
}

export function readTourLogcatMarker(logcat, state, { sinceEpochMs } = {}) {
  const exact = String(state);
  let marker = 'missing';
  for (const event of extractInsituTourLogcatEvents(logcat, { sinceEpochMs })) {
    if (event.state === exact) marker = 'reached';
    else if (event.state === `${exact}-FAILED`) marker = 'failed';
    else if (event.state === `${exact}-DONE`) marker = 'retired';
    else if (event.state === 'done') marker = 'done';
  }
  return marker;
}

export async function waitForAndroidTourState({
  state,
  readLogcat,
  logcatSinceEpochMs,
  dumpUi,
  timeoutMs = DEFAULT_ANDROID_STATE_TIMEOUT_MS,
  pollMs = DEFAULT_ANDROID_POLL_MS,
  sleep = defaultSleep,
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    const logcatResult = readLogcatTourMarker(readLogcat, state, logcatSinceEpochMs);
    if (logcatResult.marker === 'reached') return { status: 'reached', logcat: logcatResult.logcat };
    if (logcatResult.marker === 'failed') return { status: 'failed', logcat: logcatResult.logcat };
    if (logcatResult.marker === 'retired') return { status: 'retired', logcat: logcatResult.logcat };
    if (logcatResult.marker === 'done') return { status: 'done', logcat: logcatResult.logcat };

    if (dumpUi) {
      const dump = dumpUi();
      const marker = readTourMarker(dump, state);
      if (marker === 'reached') return { status: 'reached', dump };
      if (marker === 'failed') return { status: 'failed', dump };
      if (marker === 'retired') return { status: 'retired', dump };
      if (marker === 'done') return { status: 'done', dump };
    }
    await sleep(pollMs);
  }
  return { status: 'timeout' };
}

export async function waitForAndroidTourRetire({
  state,
  readLogcat,
  logcatSinceEpochMs,
  dumpUi,
  timeoutMs = DEFAULT_ANDROID_STATE_TIMEOUT_MS,
  pollMs = DEFAULT_ANDROID_POLL_MS,
  sleep = defaultSleep,
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    const logcatResult = readLogcatTourMarker(readLogcat, state, logcatSinceEpochMs);
    if (logcatResult.marker === 'retired' || logcatResult.marker === 'done') {
      return { status: 'retired', logcat: logcatResult.logcat };
    }
    if (logcatResult.marker === 'failed') return { status: 'failed', logcat: logcatResult.logcat };

    if (dumpUi) {
      const dump = dumpUi();
      const marker = readTourMarker(dump, state);
      if (marker === 'retired' || marker === 'done') return { status: 'retired', dump };
      if (marker === 'failed') return { status: 'failed', dump };
    }
    await sleep(pollMs);
  }
  return { status: 'timeout' };
}

// An unfiltered dump of a real device's main buffer exceeds execFileSync's
// 1 MB default maxBuffer (ENOBUFS on the Pixel 6a), which silently demoted
// marker reads to UIAutomator. Silence every tag except the Capacitor console
// (where [insituTour] markers land) and bound the tail so repeated dumps stay
// far under the child-process buffer; freshness filtering already discards
// anything older than the app launch.
const ANDROID_LOGCAT_TAIL_LINES = 2000;

export function dumpAndroidLogcat({ adbPrefix, serial, shImpl = execCommandParts } = {}) {
  return String(shImpl(buildAdbCommandParts({
    adbPrefix,
    serial,
    adbArgs: [
      'logcat', '-d', '-v', 'epoch', '-t', String(ANDROID_LOGCAT_TAIL_LINES),
      '-s', 'Capacitor/Console:I', '*:S',
    ],
  })));
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
  readLogcat,
  logcatSinceEpochMs,
  dumpUi,
  capturePng,
  sleep = defaultSleep,
  now = Date.now,
} = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const captures = {};
  const failures = [];
  const readLogs = readLogcat === undefined
    ? (dumpUi ? null : () => dumpAndroidLogcat({ adbPrefix, serial, shImpl }))
    : readLogcat;
  const readDump = dumpUi === undefined
    ? (() => dumpAndroidUi({ adbPrefix, serial, shImpl }))
    : dumpUi;
  const shoot = capturePng || ((outFile) => captureAndroidPng({ adbPrefix, serial, outFile, shImpl }));

  for (const state of states || []) {
    const reached = await waitForAndroidTourState({
      state,
      readLogcat: readLogs,
      logcatSinceEpochMs,
      dumpUi: readDump,
      timeoutMs,
      pollMs,
      sleep,
      now,
    });
    if (reached.status !== 'reached') {
      failures.push(androidStateFailure(state, reached.status));
      continue;
    }

    const outFile = path.join(outDir, `${state}.png`);
    shoot(outFile, state);
    captures[state] = outFile;

    const retired = await waitForAndroidTourRetire({
      state,
      readLogcat: readLogs,
      logcatSinceEpochMs,
      dumpUi: readDump,
      timeoutMs,
      pollMs,
      sleep,
      now,
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
  if (status === 'retired') {
    return `state "${state}" retired as tourstate:${state}-DONE before capture`;
  }
  if (status === 'done') {
    return `tour completed before state "${state}" was captured`;
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

function readLogcatTourMarker(readLogcat, state, sinceEpochMs) {
  if (!readLogcat) return { marker: 'missing' };
  try {
    const logcat = readLogcat();
    return {
      marker: readTourLogcatMarker(logcat, state, { sinceEpochMs }),
      logcat,
    };
  } catch (err) {
    return { marker: 'missing', error: err };
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
