import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const toolRoot = fileURLToPath(new URL('../', import.meta.url));
export const coreRevision = 'ccba881b3b1367fbb72ec1119a1bc553e09cc848';

// Export authoritative lock versions, replacing only the unavailable external
// sibling. The normal developer pyproject and editable dependency stay intact.
export function ciRequirements(lockedRequirements) {
  const activeLines = lockedRequirements.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (activeLines.some((line) => line.startsWith('-e ') || line.includes('merceka-core') || line.includes('file:'))) {
    throw new Error('CI export unexpectedly retained an editable/local dependency');
  }
  return `${lockedRequirements.trimEnd()}\nmerceka-core @ git+https://github.com/batu/merceka-core.git@${coreRevision}\n`;
}

function run(args, options = {}) {
  const result = spawnSync('uv', args, { cwd: toolRoot, stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`uv ${args[0]} failed (${result.status ?? result.error?.message})`);
  return result;
}

export function install() {
  const output = process.env.EDITOR2_VERIFY_DIR;
  if (!output || process.env.UV_PROJECT_ENVIRONMENT !== path.join(output, 'venv')) {
    throw new Error('Run through editor2:ci with a dedicated verification environment');
  }
  const requirements = path.join(output, 'requirements.txt');
  const exported = run(['export', '--frozen', '--no-emit-project', '--no-emit-package', 'merceka-core', '--no-emit-package', 'ftd-editor', '--no-hashes'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  fs.writeFileSync(requirements, ciRequirements(exported.stdout));
  const python = path.join(output, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) run(['venv', '--python', '3.12', path.join(output, 'venv')]);
  run(['pip', 'sync', '--python', python, requirements]);
  run(['pip', 'install', '--python', python, '--no-deps', '-e', toolRoot, '-e', path.resolve(toolRoot, '../ftd-level-editor')]);
  run(['pip', 'check', '--python', python]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) install();
