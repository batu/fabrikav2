// Shared loader for game-local CLI tools. Import and call this module from the
// same Node process that consumes the environment; executing it cannot mutate a
// parent shell.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGameEnv as loadFromRoot } from './src/env.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_NAME = /^[a-z0-9_]+$/;

export function loadGameEnv({ game, environment = process.env }) {
  if (!GAME_NAME.test(game)) throw new Error('game must use lowercase letters, digits, or underscores');
  return loadFromRoot({ gameRoot: path.join(REPO_ROOT, 'games', game), environment });
}
