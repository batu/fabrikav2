import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  prepareValidatedIosWebBuildEnvironment,
  runValidatedIosWebBuild,
} from '../src/install-web-build.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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
