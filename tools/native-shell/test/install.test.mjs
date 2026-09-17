import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runIosBuild } from '../src/build-output.mjs';
import {
  prepareValidatedIosWebBuildEnvironment,
  runValidatedIosWebBuild,
} from '../src/install-web-build.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('owned native build output', () => {
  let cacheRoot;
  const previousRoot = process.env.FABRIKAV2_NATIVE_SHELL_CACHE_ROOT;

  beforeEach(() => {
    cacheRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-cache-')));
    process.env.FABRIKAV2_NATIVE_SHELL_CACHE_ROOT = cacheRoot;
  });

  afterEach(() => {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.FABRIKAV2_NATIVE_SHELL_CACHE_ROOT;
    else process.env.FABRIKAV2_NATIVE_SHELL_CACHE_ROOT = previousRoot;
  });

  /** Stands in for xcodebuild: writes the product wherever -derivedDataPath points. */
  const succeedingRun = (calls) => (file, args) => {
    calls?.push([file, args]);
    const derived = args[args.indexOf('-derivedDataPath') + 1];
    const configuration = args[args.indexOf('-configuration') + 1] ?? 'Debug';
    if (!derived.startsWith('{')) {
      fs.mkdirSync(path.join(derived, 'Build', 'Products', `${configuration}-iphoneos`, 'App.app'), { recursive: true });
    }
    fs.writeFileSync(args[args.indexOf('--result-file') + 1], JSON.stringify({ output_dir: '/private/tmp/owned-release' }));
    return '** BUILD SUCCEEDED **';
  };

  const buildDebug = (gameDir, calls) => runIosBuild({
    gameDir, configuration: 'Debug', args: ['-configuration', 'Debug', 'build'], run: succeedingRun(calls),
  });

  const seedCache = (checkout, lane, ageMs) => {
    const derived = path.join(cacheRoot, checkout, lane, 'DerivedData');
    fs.mkdirSync(derived, { recursive: true });
    const used = new Date(Date.now() - ageMs);
    fs.utimesSync(derived, used, used);
    return derived;
  };

  it('returns the exact built artifact from the shared runner and protects release output', () => {
    const calls = [];
    const built = runIosBuild({ gameDir: path.join(repoRoot, 'games/find_the_bird'), configuration: 'Release', args: ['build'],
      run: succeedingRun(calls),
    });
    expect(calls[0][0]).toBe('agency');
    expect(calls[0][1]).toContain('durable');
    expect(calls[0][1]).toContain('{agency-output}/DerivedData');
    expect(built.appPath).toBe('/private/tmp/owned-release/DerivedData/Build/Products/Release-iphoneos/App.app');
  });

  it('compiles scratch lanes into a reused cache outside the retained attempt', () => {
    const calls = [];
    const built = buildDebug(path.join(repoRoot, 'games/find_the_bird'), calls);
    const derivedDataPath = calls[0][1][calls[0][1].indexOf('-derivedDataPath') + 1];
    expect(calls[0][1]).toContain('scratch');
    expect(path.isAbsolute(derivedDataPath)).toBe(true);
    expect(derivedDataPath.startsWith(cacheRoot)).toBe(true);
    expect(derivedDataPath.startsWith('/private/tmp/owned-release')).toBe(false);
    expect(derivedDataPath.endsWith(path.join('find_the_bird-ios-debug', 'DerivedData'))).toBe(true);
    expect(built.appPath).toBe(path.join(derivedDataPath, 'Build/Products/Debug-iphoneos/App.app'));
  });

  it('gives each checkout its own scratch cache so concurrent worktrees never share one', () => {
    const derivedDataFor = (gameDir) => {
      const calls = [];
      buildDebug(gameDir, calls);
      return calls[0][1][calls[0][1].indexOf('-derivedDataPath') + 1];
    };
    const main = derivedDataFor(path.join(repoRoot, 'games/find_the_bird'));
    const worktree = derivedDataFor(path.join(repoRoot, '.worktrees/ftb-ad-cadence/games/find_the_bird'));
    expect(main).not.toBe(worktree);
    expect(path.basename(path.dirname(main))).toBe(path.basename(path.dirname(worktree)));
  });

  it('resolves the checkout so one source tree reached two ways keeps one cache', () => {
    const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-')));
    const link = `${real}-link`;
    fs.mkdirSync(path.join(real, 'games', 'find_the_bird'), { recursive: true });
    fs.symlinkSync(real, link);
    try {
      const derivedDataFor = (root) => {
        const calls = [];
        buildDebug(path.join(root, 'games', 'find_the_bird'), calls);
        return calls[0][1][calls[0][1].indexOf('-derivedDataPath') + 1];
      };
      expect(derivedDataFor(real)).toBe(derivedDataFor(link));
    } finally {
      fs.rmSync(link, { force: true });
      fs.rmSync(real, { recursive: true, force: true });
    }
  });

  it('fails instead of handing back the previous product when a build makes none', () => {
    expect(() => runIosBuild({ gameDir: path.join(repoRoot, 'games/find_the_bird'), configuration: 'Debug', args: ['build'],
      run: (file, args) => {
        fs.writeFileSync(args[args.indexOf('--result-file') + 1], JSON.stringify({ output_dir: '/private/tmp/owned-release' }));
        return '** BUILD SUCCEEDED **';
      },
    })).toThrow(/produced no App.app/);
  });

  it('keeps only the three most recently built scratch caches for a lane', () => {
    const day = 24 * 60 * 60 * 1000;
    const seeded = [2, 3, 4, 5].map((days, index) => seedCache(`stale${index}`, 'find_the_bird-ios-debug', days * day));
    buildDebug(path.join(repoRoot, 'games/find_the_bird'));
    expect(seeded.map((cache) => fs.existsSync(cache))).toEqual([true, true, false, false]);
  });

  it('never prunes a cache a concurrent worktree may still be compiling into', () => {
    const hour = 60 * 60 * 1000;
    const seeded = [1, 2, 3, 4].map((hours, index) => seedCache(`busy${index}`, 'find_the_bird-ios-debug', hours * hour));
    buildDebug(path.join(repoRoot, 'games/find_the_bird'));
    expect(seeded.every((cache) => fs.existsSync(cache))).toBe(true);
  });

  it('sweeps idle caches of a lane that is no longer being built', () => {
    const day = 24 * 60 * 60 * 1000;
    const abandoned = [2, 3, 4, 5].map((days, index) => seedCache(`dog${index}`, 'find_the_dog-ios-debug', days * day));
    buildDebug(path.join(repoRoot, 'games/find_the_bird'));
    expect(abandoned.map((cache) => fs.existsSync(cache))).toEqual([true, true, true, false]);
  });

  it('does not leave empty checkout directories behind after pruning', () => {
    const day = 24 * 60 * 60 * 1000;
    [2, 3, 4, 5].forEach((days, index) => seedCache(`gone${index}`, 'find_the_bird-ios-debug', days * day));
    buildDebug(path.join(repoRoot, 'games/find_the_bird'));
    expect(fs.existsSync(path.join(cacheRoot, 'gone2'))).toBe(false);
    expect(fs.existsSync(path.join(cacheRoot, 'gone3'))).toBe(false);
  });

  it('never falls back to a stale in-tree build after runner failure', () => {
    expect(() => runIosBuild({ gameDir: '/repo/games/bird', configuration: 'Debug', args: [],
      run: () => { throw new Error('build failed'); },
    })).toThrow('build failed');
  });
});

describe('native-shell install caller', () => {
  it('runs the game-env iOS validator before invoking the raw Vite build', () => {
    const env = { TEST_CANARY: 'preserved' };
    const calls = [];
    const run = vi.fn((...args) => calls.push(args));

    runValidatedIosWebBuild({ run, repoRoot, game: 'find_the_dog', env });

    expect(calls).toEqual([
      ['game-env validate --mode ios', 'node', [
        path.join(repoRoot, 'tools', 'game-env', 'validate.mjs'),
        '--game', 'find_the_dog',
        '--mode', 'ios',
      ], { cwd: repoRoot, env }],
      ['vite build --mode ios', 'npx', ['vite', 'build', '--mode', 'ios'], { env }],
    ]);
  });

  it('does not invoke Vite when validation fails', () => {
    const run = vi.fn((label) => {
      if (label === 'game-env validate --mode ios') throw new Error('invalid environment');
    });

    expect(() => runValidatedIosWebBuild({ run, repoRoot, game: 'find_the_dog', env: {} }))
      .toThrow('invalid environment');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('gives validation and Vite the same parsed values for quoted and commented dotenv input', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'native-shell-env-'));
    const gameDir = path.join(fixtureRoot, 'games', 'find_the_dog');
    const sourceEnvFile = path.join(fixtureRoot, 'release.env');
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(sourceEnvFile, [
      'VITE_QUOTED="same value # preserved"',
      'VITE_COMMENTED=effective-value # operator note',
      '',
    ].join('\n'));

    try {
      const prepared = prepareValidatedIosWebBuildEnvironment({
        gameDir,
        envFile: sourceEnvFile,
        environment: { EXISTING: 'kept' },
      });
      const calls = [];
      runValidatedIosWebBuild({
        run: (...args) => calls.push(args),
        repoRoot,
        game: 'find_the_dog',
        env: prepared.environment,
      });

      expect(prepared.environment).toMatchObject({
        EXISTING: 'kept',
        VITE_QUOTED: 'same value # preserved',
        VITE_COMMENTED: 'effective-value',
      });
      expect(calls[0][3].env).toBe(calls[1][3].env);
      expect(fs.readFileSync(prepared.localEnvFile, 'utf8')).toBe(fs.readFileSync(sourceEnvFile, 'utf8'));
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
