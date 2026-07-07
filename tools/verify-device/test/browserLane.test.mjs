import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  harnessWindowKey, startDevServer, captureBrowserStates,
} from '../src/browserLane.mjs';

describe('harnessWindowKey', () => {
  it('derives __<GAME>_HARNESS__ from the manifest game name (main.ts convention)', () => {
    expect(harnessWindowKey('marble_run')).toBe('__MARBLE_RUN_HARNESS__');
  });
});

// Fake child_process.spawn: an EventEmitter with a stdout EventEmitter + kill().
function fakeSpawn() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.kill = () => { proc.killed = true; };
  return proc;
}

describe('startDevServer', () => {
  it('resolves baseUrl once vite prints the local dev URL on stdout', async () => {
    const proc = fakeSpawn();
    const spawnImpl = () => proc;
    const promise = startDevServer('/fake/game/dir', { spawnImpl, timeoutMs: 1000 });
    proc.stdout.emit('data', Buffer.from('  VITE v6.0.5  ready in 80 ms\n\n'));
    proc.stdout.emit('data', Buffer.from('  ➜  Local:   http://localhost:5210/\n'));
    const dev = await promise;
    expect(dev.baseUrl).toBe('http://localhost:5210/');
    dev.stop();
    expect(proc.killed).toBe(true);
  });

  it('rejects (and kills the process) if no URL shows up within timeoutMs', async () => {
    const proc = fakeSpawn();
    const spawnImpl = () => proc;
    await expect(startDevServer('/fake/game/dir', { spawnImpl, timeoutMs: 15 }))
      .rejects.toThrow(/did not report a URL/);
    expect(proc.killed).toBe(true);
  });

  it('rejects if the dev server process exits early', async () => {
    const proc = fakeSpawn();
    const spawnImpl = () => proc;
    const promise = startDevServer('/fake/game/dir', { spawnImpl, timeoutMs: 1000 });
    proc.emit('exit', 1);
    await expect(promise).rejects.toThrow(/exited early/);
  });
});

// Fake Playwright browser/page: `evaluate` runs the pageFunction with a real
// `window` global stubbed to the fake harness object (same technique as
// packages/testkit/src/playwright/harness.test.ts), so the SAME production
// code path (window[key].driveTo(...)) that runs under real Chromium runs here.
function fakeBrowser(harnessByState) {
  const originalWindow = globalThis.window;
  const withWindow = async (win, run) => {
    globalThis.window = win;
    try { return await run(); } finally { globalThis.window = originalWindow; }
  };
  return {
    async newPage() {
      let currentState = null;
      return {
        async goto() { /* no-op: state is set by evaluate below */ },
        async waitForFunction() { /* harness is always "ready" in the fake */ },
        async waitForTimeout() { /* no-op */ },
        async evaluate(fn, arg) {
          currentState = arg.name;
          const harness = harnessByState[currentState] || { driveTo: async () => false, snapshot: () => ({}) };
          return withWindow({ [arg.key]: harness }, () => fn(arg));
        },
        async screenshot() { return Buffer.from(`fake-png-${currentState}`); },
      };
    },
    async close() { /* no-op */ },
  };
}

describe('captureBrowserStates', () => {
  let outDir;
  afterEach(() => { if (outDir) fs.rmSync(outDir, { recursive: true, force: true }); });

  it('captures a screenshot only for states where driveTo confirms arrival', async () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-browser-'));
    const harnessByState = {
      menu: { driveTo: async () => true, snapshot: () => ({ scene: 'menu' }) },
      level: { driveTo: async () => false, snapshot: () => ({ scene: 'menu' }) }, // never confirmed -> gap
    };
    const launch = async () => fakeBrowser(harnessByState);

    const { captures, integrity } = await captureBrowserStates({
      states: ['menu', 'level'],
      baseUrl: 'http://localhost:5210/',
      windowKey: '__MARBLE_RUN_HARNESS__',
      outDir,
      launch,
    });

    expect(captures.menu).toBe(path.join(outDir, 'menu.png'));
    expect(fs.existsSync(captures.menu)).toBe(true);
    expect(captures.level).toBeUndefined(); // capture-integrity gate: no shot saved

    const menuEntry = integrity.find((i) => i.state === 'menu');
    const levelEntry = integrity.find((i) => i.state === 'level');
    expect(menuEntry).toMatchObject({ driveToReturned: true, integrityPass: true });
    expect(levelEntry).toMatchObject({ driveToReturned: false, integrityPass: false });
  });

  it('never invents a capture for an unknown/unreachable state', async () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-browser-'));
    const launch = async () => fakeBrowser({}); // no harness entries -> every driveTo resolves false
    const { captures, integrity } = await captureBrowserStates({
      states: ['win', 'fail'],
      baseUrl: 'http://localhost:5210/',
      windowKey: '__MARBLE_RUN_HARNESS__',
      outDir,
      launch,
    });
    expect(captures).toEqual({});
    expect(integrity.map((i) => i.state)).toEqual(['win', 'fail']);
    expect(integrity.every((i) => i.integrityPass === false)).toBe(true);
    expect(integrity.every((i) => i.driveToReturned === false)).toBe(true);
  });
});
