import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  configureLockfileMergeDriver,
  LOCKFILE_MERGE_DRIVER,
  LOCKFILE_MERGE_DRIVER_COMMAND,
  runNpmLockRegen,
} from '../src/lockfile-merge-driver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../..');
const driverScript = path.join(projectRoot, 'tools/verify-gate/npm-lock-merge-driver.mjs');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-merge-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function run(cmd, args, cwd = dir) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed (${res.status})\n${res.stdout || ''}${res.stderr || ''}`,
    );
  }
  return res;
}

function git(args, cwd = dir) {
  return run('git', args, cwd);
}

function writeJson(file, obj) {
  fs.writeFileSync(path.join(dir, file), `${JSON.stringify(obj, null, 2)}\n`);
}

function mutateLockVersion(version) {
  const file = path.join(dir, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
  lock.version = version;
  lock.packages[''].version = version;
  fs.writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`);
}

describe('lockfile merge-driver config', () => {
  it('writes the expected local Git merge driver config', () => {
    const calls = [];
    configureLockfileMergeDriver({
      cwd: '/repo',
      spawnImpl: (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts.cwd });
        return { status: 0, stdout: '', stderr: '' };
      },
      stdout: { write() {} },
    });

    expect(calls).toEqual([
      {
        cmd: 'git',
        args: [
          'config',
          `merge.${LOCKFILE_MERGE_DRIVER}.name`,
          'Regenerate npm package-lock.json on merge conflicts',
        ],
        cwd: '/repo',
      },
      {
        cmd: 'git',
        args: ['config', `merge.${LOCKFILE_MERGE_DRIVER}.driver`, LOCKFILE_MERGE_DRIVER_COMMAND],
        cwd: '/repo',
      },
    ]);
  });

  it('refuses nested package-lock files', () => {
    expect(() =>
      runNpmLockRegen({
        currentPath: 'package-lock.json',
        packagePath: 'games/demo/package-lock.json',
      }),
    ).toThrow(/only handles root package-lock\.json/);
  });
});

describe('npm-lock-regen merge driver', () => {
  it('resolves a package-lock conflict by regenerating the lock before the merge commit', () => {
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'user.name', 'Test User']);
    git(['config', `merge.${LOCKFILE_MERGE_DRIVER}.driver`, `node ${driverScript} %O %A %B %P`]);

    fs.writeFileSync(path.join(dir, '.gitattributes'), '/package-lock.json merge=npm-lock-regen\n');
    writeJson('package.json', {
      name: 'lockfile-merge-fixture',
      version: '1.0.0',
      private: true,
    });
    run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
    git(['add', '.']);
    git(['commit', '-m', 'base lockfile']);

    git(['checkout', '-b', 'card']);
    mutateLockVersion('1.0.0-card');
    git(['commit', '-am', 'card lock edit']);

    git(['checkout', 'main']);
    mutateLockVersion('1.0.0-main');
    git(['commit', '-am', 'main lock edit']);

    const merge = spawnSync('git', ['merge', '--no-edit', 'card'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(`${merge.stdout}\n${merge.stderr}`).toContain('npm-lock-regen');
    expect(merge.status).toBe(0);

    const lockText = fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8');
    expect(lockText).not.toContain('1.0.0-main');
    expect(lockText).not.toContain('1.0.0-card');
    const lock = JSON.parse(lockText);
    expect(lock.version).toBe('1.0.0');
    expect(lock.packages[''].version).toBe('1.0.0');
    expect(git(['status', '--porcelain']).stdout).toBe('');
  });
});
