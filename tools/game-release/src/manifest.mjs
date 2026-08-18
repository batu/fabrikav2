import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { validateEnvironment as validateGameEnvironment } from '../../game-env/src/validate.mjs';
import { getGamePolicy } from '../../game-env/src/policies.mjs';
import { validateGeneratedShell as validateNativeShell } from '../../native-shell/src/native-shell.mjs';

const GAME_NAME = /^[a-z0-9_]+$/;
const REVISION = /^[0-9a-f]{40}$/;

function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', LANG: 'C', LC_ALL: 'C' },
  }).trim();
}

function safeEnvironmentResult(result) {
  return {
    ok: result.ok === true,
    mode: result.mode,
    missingKeys: [...(result.missingKeys ?? [])].sort(),
    invalidKeys: [...(result.invalidKeys ?? [])].sort(),
    emptyOverrideKeys: [...(result.emptyOverrideKeys ?? [])].sort(),
  };
}

export function buildReleaseManifest(options, dependencies = {}) {
  const { repoRoot, game, expectedSourceRevision } = options;
  if (!repoRoot || !GAME_NAME.test(game ?? '')) throw new Error('valid repoRoot and game are required');
  if (!REVISION.test(expectedSourceRevision ?? '')) throw new Error('expected source revision must be a full SHA');
  const root = path.resolve(repoRoot);
  const sourceRevision = git(root, ['rev-parse', 'HEAD']);
  if (sourceRevision !== expectedSourceRevision) throw new Error('source revision does not match approved revision');
  if (git(root, ['status', '--porcelain'])) throw new Error('release source worktree is dirty');

  const gameRoot = path.join(root, 'games', game);
  const shellPath = path.join(gameRoot, 'native-resources', 'ios', 'shell-manifest.json');
  const shell = JSON.parse(fs.readFileSync(shellPath, 'utf8'));
  const bundleId = shell?.ios?.bundleId;
  if (typeof bundleId !== 'string' || !bundleId || bundleId === shell.capacitorAppId || /(?:^|\.)dev(?:\.|$)/.test(bundleId)) {
    throw new Error('production bundle ID resolves to a development identity');
  }

  const validateEnvironment = dependencies.validateEnvironment ?? ((args) =>
    validateGameEnvironment({ ...args, policy: getGamePolicy(game), environment: {} }));
  const environment = safeEnvironmentResult(validateEnvironment({ gameRoot, mode: 'ios' }));
  if (!environment.ok) throw new Error('iOS environment validation failed');

  const validateGeneratedShell = dependencies.validateGeneratedShell ?? validateNativeShell;
  const nativeResult = validateGeneratedShell({ repoRoot: root, game, allowMissingFirebase: false });
  if (nativeResult.issues?.length) throw new Error('native shell validation failed');

  return {
    ok: true,
    game,
    platform: 'ios',
    bundleId,
    sourceRevision,
    environment,
    nativeShell: {
      ok: true,
      generatedPresent: nativeResult.generatedPresent === true,
      skAdNetworkCount: nativeResult.skAdNetworkCount ?? 0,
    },
  };
}
