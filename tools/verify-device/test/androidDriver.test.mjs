import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildAdbCommandParts,
  dumpAndroidLogcat,
  extractInsituTourLogcatEvents,
  extractLogcatEpochMs,
  captureAndroidPng,
  captureAndroidStates,
  extractUiAutomatorMarkerValues,
  hasExactTourStateMarker,
  readTourLogcatMarker,
  readTourMarker,
} from '../src/androidDriver.mjs';

const tmpDirs = [];
const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const logcatBaseMs = 1_800_000_000_000;

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-android-'));
  tmpDirs.push(dir);
  return dir;
}

function node(attrs) {
  return `<node text="${attrs.text || ''}" content-desc="${attrs.desc || ''}" />`;
}

function logLine(epochMs, message) {
  const seconds = Math.floor(epochMs / 1000);
  const millis = String(epochMs % 1000).padStart(3, '0');
  return `${seconds}.${millis} 1234 5678 I chromium: [INFO:CONSOLE] "[insituTour] ${message}", source: app.js`;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Android UIAutomator tour markers', () => {
  it('extracts text/content-desc marker values and decodes XML entities', () => {
    const dump = `${node({ text: 'tourstate:menu' })}<node content-desc="tourstate:win&amp;bonus" />`;
    expect(extractUiAutomatorMarkerValues(dump)).toEqual(['tourstate:menu', '', 'tourstate:win&bonus']);
  });

  it('matches exact tourstate markers without accepting retired or failed markers', () => {
    const dump = [
      node({ text: 'tourstate:menu-DONE' }),
      node({ desc: 'tourstate:pause-FAILED' }),
      node({ desc: 'tourstate:settings' }),
    ].join('');

    expect(hasExactTourStateMarker(dump, 'menu')).toBe(false);
    expect(readTourMarker(dump, 'menu')).toBe('retired');
    expect(readTourMarker(dump, 'pause')).toBe('failed');
    expect(readTourMarker(dump, 'settings')).toBe('reached');
  });
});

describe('Android logcat tour markers', () => {
  it('extracts insituTour state events after the launch timestamp', () => {
    const logcat = [
      logLine(logcatBaseMs - 1_000, 'state=menu scene=menu'),
      logLine(logcatBaseMs + 1_125, 'state=menu scene=menu'),
      logLine(logcatBaseMs + 2_000, 'autoWin returned true; confirmed=true'),
    ].join('\n');

    expect(extractLogcatEpochMs(logLine(logcatBaseMs + 1_125, 'state=menu scene=menu'))).toBe(logcatBaseMs + 1_125);
    expect(extractInsituTourLogcatEvents(logcat, { sinceEpochMs: logcatBaseMs })).toMatchObject([
      { state: 'menu', epochMs: logcatBaseMs + 1_125 },
    ]);
  });

  it('rejects stale logcat state lines when a launch timestamp is provided', () => {
    const logcat = logLine(logcatBaseMs - 1_000, 'state=menu scene=menu');

    expect(readTourLogcatMarker(logcat, 'menu', { sinceEpochMs: logcatBaseMs })).toBe('missing');
    expect(readTourLogcatMarker(logcat, 'menu')).toBe('reached');
  });

  it('uses the latest matching logcat marker so retired or failed states are not captured late', () => {
    const logcat = [
      logLine(logcatBaseMs + 1_000, 'state=menu scene=menu'),
      logLine(logcatBaseMs + 2_000, 'state=menu-DONE scene=menu'),
      logLine(logcatBaseMs + 3_000, 'state=pause-FAILED scene=playing'),
    ].join('\n');

    expect(readTourLogcatMarker(logcat, 'menu', { sinceEpochMs: logcatBaseMs })).toBe('retired');
    expect(readTourLogcatMarker(logcat, 'pause', { sinceEpochMs: logcatBaseMs })).toBe('failed');
    expect(readTourLogcatMarker(
      logLine(logcatBaseMs + 4_000, 'state=done scene=failed'),
      'win',
      { sinceEpochMs: logcatBaseMs },
    )).toBe('done');
  });
});

describe('Android adb capture driver', () => {
  it('captures only after exact publish and waits for exact retire', async () => {
    const outDir = tmpDir();
    const seen = [];
    const dumps = [
      node({ desc: 'tourstate:settings-DONE' }),
      node({ desc: 'tourstate:menu' }),
      node({ desc: 'tourstate:menu-DONE' }),
    ];
    let t = 0;

    const result = await captureAndroidStates({
      states: ['menu'],
      outDir,
      dumpUi: () => dumps.shift() || node({ desc: 'tourstate:menu-DONE' }),
      capturePng: (outFile, state) => {
        seen.push(state);
        fs.writeFileSync(outFile, pngHeader);
      },
      sleep: async (ms) => { t += ms; },
      now: () => t,
      pollMs: 1,
      timeoutMs: 5,
    });

    expect(seen).toEqual(['menu']);
    expect(result.failures).toEqual([]);
    expect(result.captures.menu).toBe(path.join(outDir, 'menu.png'));
    expect(fs.existsSync(result.captures.menu)).toBe(true);
  });

  it('captures from logcat state markers when UIAutomator cannot see the off-screen marker', async () => {
    const outDir = tmpDir();
    const seen = [];
    const logs = [
      logLine(logcatBaseMs, 'tour starting'),
      logLine(logcatBaseMs + 1_000, 'state=menu scene=menu'),
      [
        logLine(logcatBaseMs + 1_000, 'state=menu scene=menu'),
        logLine(logcatBaseMs + 2_000, 'state=menu-DONE scene=menu'),
      ].join('\n'),
    ];

    const result = await captureAndroidStates({
      states: ['menu'],
      outDir,
      readLogcat: () => logs.shift() || logs.at(-1),
      dumpUi: () => node({ desc: '' }),
      logcatSinceEpochMs: logcatBaseMs,
      capturePng: (outFile, state) => {
        seen.push(state);
        fs.writeFileSync(outFile, pngHeader);
      },
      sleep: async () => {},
      now: () => 0,
      pollMs: 1,
      timeoutMs: 1,
    });

    expect(seen).toEqual(['menu']);
    expect(result.failures).toEqual([]);
    expect(result.captures.menu).toBe(path.join(outDir, 'menu.png'));
  });

  it('does not capture stale logcat markers from before app launch', async () => {
    const outDir = tmpDir();
    let t = 0;
    const result = await captureAndroidStates({
      states: ['menu'],
      outDir,
      readLogcat: () => logLine(logcatBaseMs - 1_000, 'state=menu scene=menu'),
      dumpUi: () => node({ desc: '' }),
      logcatSinceEpochMs: logcatBaseMs,
      capturePng: () => {
        throw new Error('should not capture stale state');
      },
      sleep: async (ms) => { t += ms; },
      now: () => t,
      pollMs: 1,
      timeoutMs: 0,
    });

    expect(result.captures).toEqual({});
    expect(result.failures).toEqual([
      'state "menu" never published exact tourstate:menu before timeout',
    ]);
  });

  it('records explicit -FAILED markers as failures instead of mislabeled captures', async () => {
    const outDir = tmpDir();
    const result = await captureAndroidStates({
      states: ['pause'],
      outDir,
      dumpUi: () => node({ desc: 'tourstate:pause-FAILED' }),
      capturePng: () => {
        throw new Error('should not capture failed state');
      },
      sleep: async () => {},
      now: () => 0,
      pollMs: 1,
      timeoutMs: 1,
    });

    expect(result.captures).toEqual({});
    expect(result.failures).toEqual([
      'state "pause" published exact tourstate:pause-FAILED before capture',
    ]);
  });

  it('builds adb command parts with ssh prefix and serial', () => {
    expect(buildAdbCommandParts({
      adbPrefix: 'ssh ubuntu-server adb',
      serial: '27091JEGR22183',
      adbArgs: ['install', '-r', '/tmp/app.apk'],
    })).toEqual([
      'ssh', 'ubuntu-server', 'adb', '-s', '27091JEGR22183', 'install', '-r', '/tmp/app.apk',
    ]);
  });

  it('dumps a bounded, Capacitor-console-only epoch logcat through the adb prefix', () => {
    const calls = [];
    const logcat = dumpAndroidLogcat({
      adbPrefix: 'ssh ubuntu-server adb',
      serial: '27091JEGR22183',
      shImpl: (parts) => {
        calls.push(parts);
        return Buffer.from('logcat');
      },
    });

    expect(logcat).toBe('logcat');
    expect(calls[0]).toEqual([
      'ssh', 'ubuntu-server', 'adb', '-s', '27091JEGR22183',
      'logcat', '-d', '-v', 'epoch', '-t', '2000', '-s', 'Capacitor/Console:I', '*:S',
    ]);
  });

  it('captures a PNG via adb exec-out screencap', () => {
    const outFile = path.join(tmpDir(), 'menu.png');
    const calls = [];
    const written = captureAndroidPng({
      adbPrefix: 'ssh ubuntu-server adb',
      serial: '27091JEGR22183',
      outFile,
      shImpl: (parts) => {
        calls.push(parts);
        return pngHeader;
      },
    });

    expect(written).toBe(outFile);
    expect(fs.readFileSync(outFile).equals(pngHeader)).toBe(true);
    expect(calls[0]).toEqual([
      'ssh', 'ubuntu-server', 'adb', '-s', '27091JEGR22183', 'exec-out', 'screencap', '-p',
    ]);
  });
});
