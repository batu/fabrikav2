import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameManifest } from '../../refcap-compare/src/run.mjs';

// Subprocess tests around the REAL cli.mjs process boundary. A verdict-only unit
// test cannot prove the CLI actually returns the typed verdict's exit code, so we
// observe the child process exit + emitted labels for every early-exit class
// (R16). These use only the --skip-device / --captures / --help paths, so no
// device, toolchain, or panel network call is required.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '..', 'cli.mjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GAME = 'marble_run';

function runCli(args) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status ?? 1, stdout: String(err.stdout || ''), stderr: String(err.stderr || '') };
  }
}

describe('cli.mjs --help (proof contract in operator guidance)', () => {
  const { status, stdout } = runCli(['--help']);

  it('exits 0', () => {
    expect(status).toBe(0);
  });

  it('states missing primary panel is strict-nonzero and phash is advisory-only', () => {
    expect(stdout).toContain('--strict');
    expect(stdout).toMatch(/phash is ADVISORY only and can never\s+be a verified pass/);
    expect(stdout).toContain('UNVERIFIED');
  });

  it('marks detached --xcresult provenance as unverified pending attestation', () => {
    expect(stdout).toMatch(/Detached artifact: provenance is UNVERIFIED/);
    expect(stdout).toContain('AUDIT #7');
  });

  it('describes --panel-threshold as a primary strict fidelity gate, not advisory', () => {
    const paragraph = stdout.slice(stdout.indexOf('--panel-threshold'), stdout.indexOf('--skip-panel'));
    expect(paragraph).toContain('primary fidelity gate under --strict');
    expect(paragraph).not.toContain('advisory');
  });

  it('names the typed run-verdict kinds including verified-pass as the only strict exit 0', () => {
    expect(stdout).toContain('verified-pass');
    expect(stdout).toContain('no-applicable-evidence');
  });
});

describe('cli.mjs graceful-skip early exit routes through the typed verdict', () => {
  it('exploratory --skip-device exits 0 with EXPLORATORY + SKIPPED + UNVERIFIED', () => {
    const { status, stdout } = runCli(['--game', GAME, '--skip-device']);
    expect(status).toBe(0);
    expect(stdout).toContain('SKIPPED');
    expect(stdout).toContain('UNVERIFIED');
    expect(stdout).toMatch(/run verdict: SKIPPED \[EXPLORATORY\]/);
  });

  it('strict --skip-device exits NONZERO with STRICT + SKIPPED (the reported bug)', () => {
    const { status, stdout } = runCli(['--game', GAME, '--skip-device', '--strict']);
    expect(status).toBe(1);
    expect(stdout).toMatch(/run verdict: SKIPPED \[STRICT\]/);
    expect(stdout).toContain('exit nonzero');
  });
});

describe('cli.mjs top-level fatal rejection exits nonzero', () => {
  it('an unknown argument exits nonzero', () => {
    expect(runCli(['--game', GAME, '--bogus']).status).not.toBe(0);
  });

  it('a missing --game exits nonzero', () => {
    expect(runCli([]).status).not.toBe(0);
  });

  it('an unknown game exits nonzero (top-level throw is caught → exit 1)', () => {
    expect(runCli(['--game', 'no_such_game_xyz', '--skip-device']).status).not.toBe(0);
  });
});

// Full non-skip path: a provided-captures run cannot be a verified pass because its
// provenance is unverified. This proves the process exit derives from the typed
// verdict on the artifact-building path — not only in the skip early return.
describe('cli.mjs provided-captures run derives exit from the typed verdict', () => {
  let capturesDir;
  let outDir;
  let hasCaptures = false;

  beforeAll(() => {
    const manifest = loadGameManifest(GAME, REPO_ROOT);
    capturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-device-cli-caps-'));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-device-cli-out-'));
    let made = 0;
    for (const state of manifest.states) {
      const offline = state.reference && state.reference.offline;
      if (!offline || offline === 'committed') continue;
      const abs = path.join(manifest.gameDir, offline);
      if (fs.existsSync(abs)) {
        fs.copyFileSync(abs, path.join(capturesDir, `${state.name}.png`));
        made += 1;
      }
    }
    hasCaptures = made > 0;
  });

  afterAll(() => {
    for (const dir of [capturesDir, outDir]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 in exploratory mode but writes an unverified run verdict', () => {
    if (!hasCaptures) return; // no committed reference PNGs to stand in as captures
    const { status, stdout } = runCli(['--game', GAME, '--captures', capturesDir, '--skip-panel', '--out', outDir]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/run verdict: UNVERIFIED \[EXPLORATORY\]/);
    const summary = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8'));
    expect(summary.__run).toMatchObject({ kind: 'unverified', exitCode: 0 });
  });

  it('exits nonzero under --strict with the same unverified evidence kind', () => {
    if (!hasCaptures) return;
    const { status, stdout } = runCli(['--game', GAME, '--captures', capturesDir, '--skip-panel', '--strict', '--out', outDir]);
    expect(status).toBe(1);
    expect(stdout).toMatch(/run verdict: UNVERIFIED \[STRICT\]/);
    const summary = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8'));
    expect(summary.__run).toMatchObject({ kind: 'unverified', exitCode: 1 });
  });
});

// A hard-integrity failure (here: two different states with byte-identical
// captures -> indistinguishable-state blocking pair) is a PROCESS GATE that must
// force a nonzero exit in BOTH strict and exploratory modes. This proves cli.mjs
// actually wires its hard-integrity inputs into classifyRunVerdict at the process
// boundary — a verdict-only unit test cannot show the wiring — and specifically
// that the gate OVERRIDES the exploratory exit-0 degrade the sibling test above
// relies on for the same provided-captures lane (handoff P2; R11/R16, KTD5).
describe('cli.mjs hard-integrity wiring forces nonzero exit in both modes', () => {
  let capturesDir;
  let outDir;
  let hasRef = false;

  beforeAll(() => {
    const manifest = loadGameManifest(GAME, REPO_ROOT);
    capturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-device-cli-hi-caps-'));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-device-cli-hi-out-'));
    // Find any committed reference PNG and stamp it onto TWO distinct manifest
    // states so their captures are byte-identical -> a blocking indistinguishable pair.
    const named = manifest.states.map((s) => s.name);
    const [a, b] = [named[0], named[1]];
    let ref = null;
    for (const state of manifest.states) {
      const offline = state.reference && state.reference.offline;
      if (!offline || offline === 'committed') continue;
      const abs = path.join(manifest.gameDir, offline);
      if (fs.existsSync(abs)) { ref = abs; break; }
    }
    if (ref && a && b) {
      fs.copyFileSync(ref, path.join(capturesDir, `${a}.png`));
      fs.copyFileSync(ref, path.join(capturesDir, `${b}.png`));
      hasRef = true;
    }
  });

  afterAll(() => {
    for (const dir of [capturesDir, outDir]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exploratory run exits NONZERO when a hard-integrity gate fires (overrides the exit-0 degrade)', () => {
    if (!hasRef) return;
    const { status, stdout } = runCli(['--game', GAME, '--captures', capturesDir, '--skip-panel', '--out', outDir]);
    expect(status).toBe(1);
    expect(stdout).toMatch(/run verdict: \w+ \[EXPLORATORY\]/);
    expect(stdout).toMatch(/hard integrity: indistinguishable states/);
    const summary = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8'));
    expect(summary.__run).toMatchObject({ enforcement: 'exploratory', exitCode: 1 });
  });

  it('strict run also exits NONZERO with the same hard-integrity gate', () => {
    if (!hasRef) return;
    const { status, stdout } = runCli(['--game', GAME, '--captures', capturesDir, '--skip-panel', '--strict', '--out', outDir]);
    expect(status).toBe(1);
    expect(stdout).toMatch(/hard integrity: indistinguishable states/);
    const summary = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8'));
    expect(summary.__run).toMatchObject({ enforcement: 'strict', exitCode: 1 });
  });
});
