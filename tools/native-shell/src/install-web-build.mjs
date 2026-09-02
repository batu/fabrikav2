import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile } from '../../game-env/src/env.mjs';

export function prepareValidatedIosWebBuildEnvironment({ gameDir, envFile, environment = process.env }) {
  const prepared = { ...environment };
  const localEnvFile = path.join(gameDir, '.env.ios.local');
  if (!fs.existsSync(envFile)) return { environment: prepared, localEnvFile, copied: false };

  fs.copyFileSync(envFile, localEnvFile);
  for (const [key, value] of readEnvFile(envFile).values) prepared[key] = value;
  return { environment: prepared, localEnvFile, copied: true };
}

export function runValidatedIosWebBuild({ run, repoRoot, game, env }) {
  run('game-env validate --mode ios', 'node', [
    path.join(repoRoot, 'tools', 'game-env', 'validate.mjs'),
    '--game', game,
    '--mode', 'ios',
  ], { cwd: repoRoot, env });
  run('vite build --mode ios', 'npx', ['vite', 'build', '--mode', 'ios'], { env });
}
