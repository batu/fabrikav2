import { spawnSync } from 'node:child_process';

export function requireTool(name) {
  const result = spawnSync(name, ['-version'], { stdio: 'ignore' });
  if (result.error && result.error.code === 'ENOENT') {
    throw new Error(`required executable not found on PATH: ${name}`);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`required executable failed to run: ${name}`);
  }
}

export function runFile(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
  if (result.error && result.error.code === 'ENOENT') {
    throw new Error(`required executable not found on PATH: ${command}`);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr || '';
    throw new Error(`${command} failed: ${stderr.trim() || `exit ${result.status}`}`);
  }
  return result;
}
