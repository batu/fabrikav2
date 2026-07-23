// Project quality merge gate (card Lg56R10n). The in-repo, unit-tested consumer
// of the `project_gate` block in agents/config.json: it runs `pre` then `cmds`
// (npm install → typecheck → test:unit → audit for this TS repo) and fails
// closed on the first non-zero command, blocking a land.
//
// The conductor-facing `land-gate` invokes this script as one child process,
// then invokes the merge-evidence gate. Keeping project quality commands in a
// separate block avoids `twf_gate -> land-gate -> project-gate -> twf_gate`
// recursion while preserving a standalone `npm run project-gate` entrypoint.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/** Default config location, relative to the repo root. */
export const CONFIG_PATH = 'agents/config.json';

/**
 * Parse agents/config.json. Throws a clear error if it is missing or invalid —
 * a gate that cannot read its config must not silently pass.
 */
export function readConfig(configFile, fsImpl = fs) {
  let txt;
  try {
    txt = fsImpl.readFileSync(configFile, 'utf8');
  } catch {
    throw new Error(`gate config not found: ${configFile}`);
  }
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error(`gate config is not valid JSON (${configFile}): ${e.message}`);
  }
}

/**
 * Extract the ordered project-quality command list from the `project_gate`
 * block. (The historical `twf_gate` fallback is gone: `twf_gate` now carries
 * the conductor's landing command, a different semantic, and every synced repo
 * defines `project_gate`.) `pre` steps run before `cmds`. Each entry is a
 * shell-string command run as-is. Throws when the block is absent or empty —
 * this repo defines a gate, so a missing block is a misconfiguration, not
 * "nothing to run".
 * @returns {string[]} commands in execution order
 */
export function resolveGateCommands(config) {
  const gate = config && config.project_gate;
  if (!gate || typeof gate !== 'object') {
    throw new Error('no `project_gate` block in gate config — cannot resolve gate commands');
  }
  const pre = Array.isArray(gate.pre) ? gate.pre : [];
  const cmds = Array.isArray(gate.cmds) ? gate.cmds : [];
  const all = [...pre, ...cmds].filter((c) => typeof c === 'string' && c.trim() !== '');
  if (all.length === 0) {
    throw new Error('`project_gate` block resolved to zero commands');
  }
  return all;
}

/** Real command runner: runs `cmd` via the shell in `cwd`, inheriting stdio. */
export function makeRunner(cwd) {
  return (cmd) => {
    try {
      execSync(cmd, { cwd, stdio: 'inherit' });
      return { ok: true };
    } catch (e) {
      return { ok: false, code: typeof e.status === 'number' ? e.status : 1 };
    }
  };
}

/**
 * Run the gate: read config, resolve commands, run each in order, stop on the
 * first failure. Pure orchestration — `runner`/`readConfigImpl`/`log` are
 * injectable so the pass/fail paths are unit-testable without spawning npm.
 * @returns {{ok: boolean, commands: string[], failed?: string, code?: number}}
 */
export function runGate({
  configFile,
  runner,
  readConfigImpl = readConfig,
  log = () => {},
} = {}) {
  const config = readConfigImpl(configFile);
  const commands = resolveGateCommands(config);
  log(`project-gate: ${commands.length} command(s) from ${configFile}`);
  for (const cmd of commands) {
    log(`project-gate: running \`${cmd}\``);
    const res = runner(cmd);
    if (!res.ok) {
      return { ok: false, commands, failed: cmd, code: res.code || 1 };
    }
  }
  return { ok: true, commands };
}

/** Resolve the repo root that holds agents/config.json for a given cwd. */
export function configFileFor(projectDir) {
  return path.join(projectDir, CONFIG_PATH);
}
