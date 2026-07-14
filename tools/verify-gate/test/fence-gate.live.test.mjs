// LIVE fence-gate regression (card qWCv9tUo comments 38 + 40). Drives the real
// fence-gate.mjs CLI against a real temp git repo — the "first live run is part
// of the build" contract. Proves the base==HEAD / integration-ref==HEAD / stale
// -base false-pass exploits are closed, that renames (both sides), deletions,
// newline-named paths, and symlinks are caught NUL-safely, and that a clean lane
// measured from the true integration merge-base passes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '..', 'fence-gate.mjs');
const EXP = 'experiments/design-frontends';
const INTEGRATION_BRANCH = 'integ-main';

let dir;
let C0; // functional baseline commit
let C1; // seal commit == integration branch tip == the normal fork point

function git(args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}
function sha(ref) {
  return git(['rev-parse', ref]).trim();
}
function write(rel, text) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function symlink(rel, target) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(target, file);
}
function commitAll(msg) {
  git(['add', '-A']);
  git(['commit', '-q', '-m', msg]);
  return sha('HEAD');
}
function runGate(env = {}) {
  // Hermetic: strip any ambient FENCE_GATE_* so a parent gate's environment
  // (e.g. a conductor running project-gate with FENCE_GATE_ALLOW_INTEGRATION or
  // FENCE_GATE_LANE set) cannot leak in and change a case's expected outcome.
  // Each test then supplies EXACTLY its own FENCE_GATE_* via `env`.
  const base = { ...process.env };
  for (const key of Object.keys(base)) {
    if (key.startsWith('FENCE_GATE_')) delete base[key];
  }
  return spawnSync(process.execPath, [CLI], {
    cwd: dir,
    env: { ...base, FENCE_GATE_PROJECT_DIR: dir, ...env },
    encoding: 'utf8',
  });
}

const TEST_FENCES = {
  fencesId: 'test',
  integration: { branch: INTEGRATION_BRANCH, remote: 'origin' },
  sharedSurfaces: {
    paths: [`${EXP}/protocol.json`, `${EXP}/fences.json`, 'package-lock.json'],
  },
  nonTargets: { paths: ['games/_template/**'] },
  lanes: {
    grapes: {
      writable: ['games/shell_proof_grapes/evidence/**', 'games/shell_proof_grapes/src/main.ts'],
      forbidden: ['games/shell_proof_phaser/**'],
    },
    phaser: {
      writable: ['games/shell_proof_phaser/evidence/**'],
      forbidden: ['games/shell_proof_grapes/**'],
    },
  },
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fence-gate-live-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'a@b.c']);
  git(['config', 'user.name', 'test']);
  git(['config', 'commit.gpgsign', 'false']);

  // C0 — the functional baseline. Also seed the files the lanes will rename/
  // delete so rename detection has real blobs to match.
  write(`${EXP}/fences.json`, JSON.stringify(TEST_FENCES, null, 2));
  write(`${EXP}/protocol.json`, JSON.stringify({ freeze: { baselineCommit: '0'.repeat(40) } }, null, 2));
  write('package-lock.json', '{ "lockfileVersion": 3 }\n');
  write('games/shell_proof_phaser/keep.txt', 'phaser content that stays stable for rename matching\n');
  write('games/shell_proof_grapes/src/main.ts', 'export const main = () => 1;\n');
  C0 = commitAll('C0 functional baseline');

  // C1 — the freeze-only seal that records C0 as the functional baseline.
  write(`${EXP}/protocol.json`, JSON.stringify({ freeze: { baselineCommit: C0 } }, null, 2));
  C1 = commitAll('C1 seal');

  // The conductor-owned canonical integration branch points at the sealed tip.
  git(['branch', INTEGRATION_BRANCH, C1]);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Fork a fresh lane branch from the sealed integration tip (C1). */
function forkLane(name) {
  git(['checkout', '-q', '-b', name, C1]);
}

describe('fence-gate live — trusted integration merge-base', () => {
  it('SKIPs (exit 0) with no lane on the integration tip (base == HEAD, not diverged)', () => {
    // HEAD is the integration tip after beforeEach — the integration branch's own
    // gate run owns no lane and legitimately self-disables.
    const r = runGate(); // no FENCE_GATE_LANE
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/SKIP/);
    expect(r.stdout).toMatch(/diverged=false/);
  });

  it('PASSES a clean lane measured from the true merge-base', () => {
    forkLane('lane-clean');
    write('games/shell_proof_grapes/evidence/2026/menu.png', 'png');
    write('games/shell_proof_grapes/src/main.ts', 'export const main = () => 2;\n');
    commitAll('in-fence lane work');
    const r = runGate({ FENCE_GATE_LANE: 'grapes' });
    expect(r.stdout, r.stderr).toMatch(/PASS/);
    expect(r.status).toBe(0);
    // Ledgers the canonical integration ref + trusted base.
    expect(r.stdout).toMatch(new RegExp(`integration-ref=refs/heads/${INTEGRATION_BRANCH}`));
    expect(r.stdout).toMatch(new RegExp(`trusted-base=${C1}`));
  });

  it('detects a real out-of-fence write from the true merge-base', () => {
    forkLane('lane-dirty');
    write('games/shell_proof_phaser/evil.txt', 'grapes reaching into the phaser lane\n');
    commitAll('out-of-fence write');
    const r = runGate({ FENCE_GATE_LANE: 'grapes' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/forbidden/);
  });
});

describe('fence-gate live — no base/ref override may collapse the base into HEAD', () => {
  function divergentLane() {
    forkLane('lane-exploit');
    write('games/shell_proof_phaser/evil.txt', 'hidden out-of-fence write\n');
    commitAll('divergent out-of-fence commit');
  }

  it('REJECTS explicit FENCE_GATE_BASE=HEAD (the base==HEAD false-pass)', () => {
    divergentLane();
    const r = runGate({ FENCE_GATE_LANE: 'grapes', FENCE_GATE_BASE: 'HEAD' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/is not the trusted integration merge-base/);
  });

  it('REJECTS the full HEAD SHA as an explicit base', () => {
    divergentLane();
    const headSha = sha('HEAD');
    const r = runGate({ FENCE_GATE_LANE: 'grapes', FENCE_GATE_BASE: headSha });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/is not the trusted integration merge-base/);
  });

  it('REJECTS a stale/unrelated explicit base (an older ancestor, not the merge-base)', () => {
    divergentLane();
    const r = runGate({ FENCE_GATE_LANE: 'grapes', FENCE_GATE_BASE: C0 });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/is not the trusted integration merge-base/);
  });

  it('REJECTS FENCE_GATE_INTEGRATION_REF=HEAD before computing any merge-base', () => {
    divergentLane();
    const r = runGate({ FENCE_GATE_LANE: 'grapes', FENCE_GATE_INTEGRATION_REF: 'HEAD' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/is not the conductor-owned/);
  });

  it('ACCEPTS FENCE_GATE_INTEGRATION_REF naming the canonical branch, still catching the divergence', () => {
    divergentLane();
    const r = runGate({ FENCE_GATE_LANE: 'grapes', FENCE_GATE_INTEGRATION_REF: INTEGRATION_BRANCH });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/forbidden/); // resolves canonically, then catches the real write
  });
});

describe('fence-gate live — NUL-safe name-status: renames, deletion, newline, symlink', () => {
  it('catches a rename from a FORBIDDEN path to an allowed path (source side)', () => {
    forkLane('lane-rename-in');
    fs.mkdirSync(path.join(dir, 'games/shell_proof_grapes/evidence'), { recursive: true });
    git(['mv', 'games/shell_proof_phaser/keep.txt', 'games/shell_proof_grapes/evidence/stolen.txt']);
    commitAll('rename forbidden -> allowed');
    const r = runGate({ FENCE_GATE_LANE: 'grapes' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/forbidden/);
  });

  it('catches a rename from an allowed path to a FORBIDDEN path (destination side)', () => {
    forkLane('lane-rename-out');
    git(['mv', 'games/shell_proof_grapes/src/main.ts', 'games/shell_proof_phaser/grabbed.ts']);
    commitAll('rename allowed -> forbidden');
    const r = runGate({ FENCE_GATE_LANE: 'grapes' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/forbidden/);
  });

  it('catches a deletion of a shared-surface file', () => {
    forkLane('lane-delete');
    git(['rm', '-q', 'package-lock.json']);
    commitAll('delete a shared surface');
    const r = runGate({ FENCE_GATE_LANE: 'grapes' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/shared-surface/);
  });

  it('cannot be hidden by a newline in the filename', () => {
    forkLane('lane-newline');
    write('games/shell_proof_phaser/ev\nil.txt', 'out-of-fence write with a newline name\n');
    commitAll('newline-named forbidden write');
    const r = runGate({ FENCE_GATE_LANE: 'grapes' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/forbidden/);
  });

  it('REJECTS a changed tracked symlink even at an allowed path (symlink escape)', () => {
    forkLane('lane-symlink');
    symlink('games/shell_proof_grapes/evidence/link', '/etc/passwd');
    commitAll('allowed-path symlink escape');
    const r = runGate({ FENCE_GATE_LANE: 'grapes' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/symlink/);
  });
});

// The four exploits an independent adversarial audit reproduced against fcb92784
// (card qWCv9tUo comment 43). Each edits the LANE's working tree — the fence
// policy, or a copy — plus a forbidden write, and must now fail closed. The
// policy that JUDGES the diff is loaded from the trusted base commit, never these
// working-tree bytes.
describe('fence-gate live — comment 43 round-3 exploits fail closed', () => {
  const FENCES = `${EXP}/fences.json`;
  function readFences() {
    return JSON.parse(fs.readFileSync(path.join(dir, FENCES), 'utf8'));
  }

  it('EXPLOIT 1: rewriting integration.branch to the lane branch does not collapse the base to HEAD', () => {
    forkLane('lane-exploit-1');
    // Point the conductor-owned integration branch at THIS lane branch so the
    // merge-base would resolve to HEAD (empty diff, false PASS) ...
    const f = readFences();
    f.integration.branch = 'lane-exploit-1';
    write(FENCES, JSON.stringify(f, null, 2));
    // ... alongside a real forbidden write the empty diff would hide.
    write('games/shell_proof_phaser/evil.txt', 'reaching into the phaser lane\n');
    commitAll('exploit 1: self-pointing integration.branch + forbidden write');
    const r = runGate({ FENCE_GATE_LANE: 'grapes' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/collapsed to HEAD|base==HEAD false-pass/);
  });

  it('EXPLOIT 2: widening the lane writable set to ** is rejected as a policy mutation', () => {
    forkLane('lane-exploit-2');
    const f = readFences();
    f.lanes.grapes.writable = ['**']; // "everything is mine now"
    write(FENCES, JSON.stringify(f, null, 2));
    write('games/shell_proof_phaser/evil.txt', 'now allegedly allowed by **\n');
    commitAll('exploit 2: writable=** + forbidden write');
    const r = runGate({ FENCE_GATE_LANE: 'grapes' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/differs from the conductor-owned canonical policy|not lane-writable/);
  });

  it('EXPLOIT 3: deleting fences.json is fatal, not a SKIP', () => {
    forkLane('lane-exploit-3');
    git(['rm', '-q', FENCES]);
    write('games/shell_proof_phaser/evil.txt', 'gate should have skipped\n');
    commitAll('exploit 3: delete the policy + forbidden write');
    const r = runGate({ FENCE_GATE_LANE: 'grapes' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/is missing \(deleted\?\)/);
  });

  it('EXPLOIT 4: a pure copy from an UNCHANGED forbidden source into an allowed path is caught', () => {
    forkLane('lane-exploit-4');
    // Byte-identical copy of the forbidden file (unchanged at its source) into the
    // allowed evidence dir — plain `-C` would report only a bare add of the dest.
    const forbidden = fs.readFileSync(path.join(dir, 'games/shell_proof_phaser/keep.txt'), 'utf8');
    write('games/shell_proof_grapes/evidence/2026/stolen.txt', forbidden);
    commitAll('exploit 4: pure copy of a forbidden source into an allowed path');
    const r = runGate({ FENCE_GATE_LANE: 'grapes' });
    expect(r.status).toBe(1);
    // The forbidden SOURCE side of the copy is what fails, via --find-copies-harder.
    expect(r.stderr).toMatch(/forbidden/);
    expect(r.stderr).toMatch(/shell_proof_phaser\/keep\.txt/);
  });
});

// The default (no-lane) invocation must not silently skip the fence on a diverged
// branch (card qWCv9tUo comment 43): a lane worker running the bare project gate
// cannot get a green fence by simply omitting FENCE_GATE_LANE.
describe('fence-gate live — no-lane default invocation is lane-explicit / fail-closed', () => {
  it('REJECTS the bare `npm run fence-gate` (no lane) on a diverged lane branch', () => {
    forkLane('lane-default');
    write('games/shell_proof_phaser/evil.txt', 'no lane declared, hoping for a skip\n');
    commitAll('diverged branch, no lane');
    const r = runGate(); // the default invocation: no FENCE_GATE_LANE
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing to silently skip|no FENCE_GATE_LANE/);
  });

  it('SKIPs a diverged branch ONLY with the conscious conductor integration acknowledgement', () => {
    forkLane('lane-ack');
    write('games/shell_proof_grapes/evidence/2026/menu.png', 'png');
    commitAll('diverged branch, conductor integration card');
    const r = runGate({ FENCE_GATE_ALLOW_INTEGRATION: '1' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/SKIP/);
    expect(r.stdout).toMatch(/acknowledged/);
  });
});
