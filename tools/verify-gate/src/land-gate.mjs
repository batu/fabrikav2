import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function parseLandGateArgs(argv) {
  const out = {
    branch: null,
    shortid: null,
    onto: 'HEAD',
    skipProject: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--branch') out.branch = argv[++i];
    else if (arg === '--shortid') out.shortid = argv[++i];
    else if (arg === '--onto') out.onto = argv[++i];
    else if (arg === '--skip-project') out.skipProject = true;
    else if (arg === '--skip-merge') { /* removed with the visual verify gate; tolerated for old callers */ }
    else throw new Error(`unexpected argument: ${arg}`);
  }
  if (out.branch && out.shortid) {
    throw new Error('pass EITHER --branch or --shortid, not both');
  }
  return out;
}

export function buildLandGateSteps({ scriptDir, args }) {
  const steps = [];
  const node = process.execPath;
  if (!args.skipProject) {
    steps.push({
      name: 'project-gate',
      command: node,
      args: [path.join(scriptDir, 'project-gate.mjs')],
      env: { PROJECT_GATE_DIR: null },
    });
  }
  if (args.branch || args.shortid) {
    const landedArgs = [];
    if (args.branch) landedArgs.push(args.branch);
    else landedArgs.push('--shortid', args.shortid);
    landedArgs.push('--onto', args.onto);
    steps.push({
      name: 'verify-landed-gate',
      command: node,
      args: [path.join(scriptDir, 'landed-gate.mjs'), ...landedArgs],
      env: { LANDED_GATE_PROJECT_DIR: null },
    });
  }
  return steps;
}

export function runLandGate({
  projectDir,
  scriptDir,
  args,
  spawnImpl = spawnSync,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  const steps = buildLandGateSteps({ scriptDir, args });
  if (steps.length === 0) throw new Error('land-gate resolved zero steps');

  for (const step of steps) {
    stdout.write(`land-gate: running ${step.name}\n`);
    const env = { ...process.env };
    for (const [key, value] of Object.entries(step.env || {})) {
      env[key] = value === null ? projectDir : value;
    }
    const res = spawnImpl(step.command, step.args, {
      cwd: projectDir,
      env,
      stdio: 'inherit',
    });
    if (res.error) {
      stderr.write(`land-gate: ${step.name} ERROR — ${res.error.message}\n`);
      return { ok: false, failed: step.name, code: 1 };
    }
    if (res.status !== 0) {
      const code = typeof res.status === 'number' ? res.status : 1;
      stderr.write(`land-gate: ${step.name} FAIL — exit ${code}\n`);
      return { ok: false, failed: step.name, code };
    }
  }
  stdout.write(`land-gate: PASS — ${steps.length} step(s) green\n`);
  return { ok: true, steps };
}
