import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv) {
  const options = { allowMissingFirebase: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--game') options.game = argv[++index];
    else if (arg === '--repo-root') options.repoRoot = path.resolve(argv[++index]);
    else if (arg === '--allow-missing') options.allowMissingFirebase = true;
    else if (arg === '--require-firebase') options.allowMissingFirebase = false;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.game) throw new Error('usage: --game <game_name> [--repo-root <path>] [--allow-missing|--require-firebase]');
  options.repoRoot ??= path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  return options;
}
