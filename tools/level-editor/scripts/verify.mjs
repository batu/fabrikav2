import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const toolRoot = fileURLToPath(new URL('../', import.meta.url));

// Keep tool discovery, never the operator's provider credentials or game roots.
export function verificationEnvironment(source, output) {
  const env = {};
  for (const key of ['PATH', 'HOME', 'SystemRoot', 'COMSPEC', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH']) {
    if (source[key]) env[key] = source[key];
  }
  return {
    ...env,
    CI: 'true',
    PYTHON_DOTENV_DISABLED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    LITELLM_LOCAL_MODEL_COST_MAP: 'True',
    UV_CACHE_DIR: source.UV_CACHE_DIR || path.join(output, 'uv-cache'),
    UV_PROJECT_ENVIRONMENT: path.join(output, 'venv'),
    UV_LINK_MODE: 'copy',
    EDITOR2_VERIFY_DIR: output,
    SMOKE_SHOT_DIR: path.join(output, 'screenshots'),
    TMPDIR: path.join(output, 'tmp'),
    MERCEKA_COST_LEDGER: path.join(output, 'costs.jsonl'),
  };
}

export function verificationSteps(output) {
  return [
    { name: 'dependencies', command: process.execPath, args: ['scripts/install-ci-dependencies.mjs'] },
    { name: 'dependency-correction', command: 'uv', args: ['run', '--no-sync', 'python', 'scripts/prepare-dependency.py'] },
    { name: 'backend', command: 'uv', args: ['run', '--no-sync', 'pytest', 'tests', '-q', '--junitxml', path.join(output, 'backend.xml')] },
    { name: 'typecheck', command: 'npm', args: ['run', 'typecheck'] },
    { name: 'browser', command: 'npm', args: ['run', 'test:smoke-all', '-w', '@fabrikav2/level-editor'] },
    { name: 'build', command: 'npm', args: ['run', 'build', '-w', '@fabrikav2/level-editor', '--', '--outDir', path.join(output, 'ui-dist')] },
  ];
}

export function runVerification({ source = process.env, run = spawnSync, log = console.log } = {}) {
  const output = source.EDITOR2_VERIFY_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'editor2-verify-'));
  for (const dir of [output, path.join(output, 'tmp'), path.join(output, 'screenshots')]) fs.mkdirSync(dir, { recursive: true });
  const env = verificationEnvironment(source, output);
  const results = [];
  for (const step of verificationSteps(output)) {
    const logfile = path.join(output, `${step.name}.log`);
    const fd = fs.openSync(logfile, 'w');
    let result;
    try {
      result = run(step.command, step.args, { cwd: toolRoot, env, stdio: ['ignore', fd, fd] });
    } finally {
      fs.closeSync(fd);
    }
    const status = result.status ?? 1;
    results.push({ name: step.name, status, logfile, ...(result.error ? { error: result.error.message } : {}) });
    log(`editor2 ${step.name}: ${status === 0 ? 'PASS' : 'FAIL'} — ${logfile}`);
    // Fail closed, including a terminated process or missing executable.
    if (status !== 0) break;
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  return results.length === verificationSteps(output).length && results.every((result) => result.status === 0) ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = runVerification();
