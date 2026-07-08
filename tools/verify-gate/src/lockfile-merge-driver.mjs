import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const LOCKFILE_MERGE_DRIVER = 'npm-lock-regen';
export const LOCKFILE_MERGE_DRIVER_COMMAND =
  'node tools/verify-gate/npm-lock-merge-driver.mjs %O %A %B %P';

export function resolveRepoRoot(cwd = process.cwd(), spawnImpl = spawnSync) {
  const res = spawnImpl('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  });
  if (res.error) {
    throw new Error(`git rev-parse failed: ${res.error.message}`);
  }
  if (res.status !== 0 || !String(res.stdout || '').trim()) {
    throw new Error(String(res.stderr || 'git rev-parse --show-toplevel failed').trim());
  }
  return String(res.stdout).trim();
}

function resolveInsideRepo(repoRoot, repoPath) {
  const abs = path.resolve(repoRoot, repoPath);
  const rel = path.relative(repoRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`refusing to write outside repo: ${repoPath}`);
  }
  return abs;
}

function ensureRootPackageLock(packagePath) {
  const normalized = String(packagePath || '').replaceAll(path.sep, '/');
  if (normalized !== 'package-lock.json') {
    throw new Error(`npm-lock-regen only handles root package-lock.json, got: ${packagePath}`);
  }
}

function copyIfDifferent(from, to, fsImpl) {
  if (path.resolve(from) === path.resolve(to)) return;
  fsImpl.copyFileSync(from, to);
}

export function runNpmLockRegen({
  currentPath,
  packagePath,
  cwd = process.cwd(),
  spawnImpl = spawnSync,
  fsImpl = fs,
  stderr = process.stderr,
} = {}) {
  if (!currentPath) throw new Error('missing current-side file path (%A)');
  ensureRootPackageLock(packagePath);

  const repoRoot = resolveRepoRoot(cwd, spawnImpl);
  const currentAbs = path.resolve(cwd, currentPath);
  const lockAbs = resolveInsideRepo(repoRoot, packagePath);

  if (!fsImpl.existsSync(currentAbs)) {
    throw new Error(`current-side lockfile temp does not exist: ${currentPath}`);
  }

  stderr.write(
    'npm-lock-regen: using current lockfile side, then running npm install --package-lock-only\n',
  );
  copyIfDifferent(currentAbs, lockAbs, fsImpl);

  const npm = spawnImpl(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
  if (npm.error) {
    throw new Error(`npm install --package-lock-only failed: ${npm.error.message}`);
  }
  if (npm.status !== 0) {
    const output = [npm.stdout, npm.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`npm install --package-lock-only exited ${npm.status}${output ? `:\n${output}` : ''}`);
  }

  if (!fsImpl.existsSync(lockAbs)) {
    throw new Error('npm install --package-lock-only did not produce package-lock.json');
  }
  copyIfDifferent(lockAbs, currentAbs, fsImpl);
  return { repoRoot, lockPath: lockAbs };
}

export function configureLockfileMergeDriver({
  cwd = process.cwd(),
  spawnImpl = spawnSync,
  stdout = process.stdout,
} = {}) {
  const commands = [
    ['config', `merge.${LOCKFILE_MERGE_DRIVER}.name`, 'Regenerate npm package-lock.json on merge conflicts'],
    ['config', `merge.${LOCKFILE_MERGE_DRIVER}.driver`, LOCKFILE_MERGE_DRIVER_COMMAND],
  ];
  for (const args of commands) {
    const res = spawnImpl('git', args, { cwd, encoding: 'utf8' });
    if (res.error) throw new Error(`git ${args.join(' ')} failed: ${res.error.message}`);
    if (res.status !== 0) {
      throw new Error(String(res.stderr || `git ${args.join(' ')} failed`).trim());
    }
  }
  stdout.write(`configured Git merge driver ${LOCKFILE_MERGE_DRIVER}\n`);
  return {
    name: LOCKFILE_MERGE_DRIVER,
    command: LOCKFILE_MERGE_DRIVER_COMMAND,
  };
}
