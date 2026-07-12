import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  OBSERVATION_SCHEMA_VERSION,
  OBSERVATION_HASH_ALGORITHM,
  OBSERVATION_ACCEPTED_RUN_KIND,
  observationInputRoots,
  hashGameInputs,
  buildObservation,
  writeObservation,
  tryWriteObservation,
  parseObservation,
  validateObservation,
  acceptObservationForGate,
} from '../src/observation.mjs';

const GAME = 'shell_proof_grapes';
const STATES = ['menu', 'level', 'shop', 'settings', 'pause', 'win', 'fail'];

let repo;

// Minimal repo with all four canonical input roots plus a capture dir. Every
// test builds a fresh tree so byte mutations are isolated.
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-observation-'));
  const write = (rel, content) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  write(`games/${GAME}/src/main.ts`, 'export const main = 1;\n');
  write(`games/${GAME}/src/shell/template-shell.css`, '.a{color:red}\n');
  write(`games/${GAME}/design/tokens.css`, ':root{--x:1px}\n');
  write(`games/${GAME}/refs/manifest.yaml`, 'game: shell_proof_grapes\n');
  write('packages/ui/src/ui.css', '.fab{display:grid}\n');
  write('experiments/design-frontends/protocol.json', `${JSON.stringify({
    contract: { states: STATES },
    lanes: [{ game: `games/${GAME}` }],
  })}\n`);
  // A vite cache under packages/ui/node_modules must be excluded from the hash.
  write('packages/ui/node_modules/.vite/dep.json', 'CACHE-NONDETERMINISTIC\n');
  // Capture stand-ins (any bytes — only presence + path are recorded).
  const captureFilesByState = {};
  for (const state of STATES) {
    const rel = `docs/evidence/2026-07-12-device-verify/raw-captures/${state}.png`;
    write(rel, `png-${state}`);
    captureFilesByState[state] = path.join(dir, rel);
  }
  return { dir, captureFilesByState };
}

function gatedCaptureByState() {
  return Object.fromEntries(STATES.map((s) => [s, { gated: true }]));
}

function buildValidObservation(repoDir, captureFilesByState, overrides = {}) {
  return buildObservation({
    repoRoot: repoDir,
    game: GAME,
    lane: 'device',
    provenance: 'live-device',
    platform: 'android',
    deviceLabel: 'Pixel test via adb',
    generatedAt: '2026-07-12T00:00:00.000Z',
    runKind: OBSERVATION_ACCEPTED_RUN_KIND,
    hardIntegrity: [],
    captureFailure: null,
    requiredStates: STATES,
    captureByState: gatedCaptureByState(),
    captureFilesByState,
    ...overrides,
  });
}

beforeEach(() => {
  repo = makeRepo();
});

afterEach(() => {
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

describe('canonical input hash', () => {
  it('is deterministic and versioned across repeated computations', () => {
    const a = hashGameInputs({ repoRoot: repo.dir, game: GAME });
    const b = hashGameInputs({ repoRoot: repo.dir, game: GAME });
    expect(a.sha256).toBe(b.sha256);
    expect(a.algorithm).toBe(OBSERVATION_HASH_ALGORITHM);
    expect(a.roots).toEqual(observationInputRoots(GAME));
    expect(a.fileCount).toBe(5); // 5 source files across the roots; node_modules + captures excluded
  });

  it('excludes node_modules / build caches so a host cache cannot diverge the hash', () => {
    const before = hashGameInputs({ repoRoot: repo.dir, game: GAME }).sha256;
    fs.writeFileSync(
      path.join(repo.dir, 'packages/ui/node_modules/.vite/dep.json'),
      'CHANGED-CACHE\n',
    );
    const after = hashGameInputs({ repoRoot: repo.dir, game: GAME }).sha256;
    expect(after).toBe(before);
  });

  it('also excludes a package-manager symlink at an excluded directory name', () => {
    const before = hashGameInputs({ repoRoot: repo.dir, game: GAME }).sha256;
    const cache = path.join(repo.dir, 'host-cache');
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, 'dep.json'), 'HOST-LOCAL\n');
    fs.rmSync(path.join(repo.dir, 'packages/ui/node_modules'), { recursive: true, force: true });
    fs.symlinkSync(cache, path.join(repo.dir, 'packages/ui/node_modules'));
    expect(hashGameInputs({ repoRoot: repo.dir, game: GAME }).sha256).toBe(before);
  });

  it('flips on a one-byte mutation under any of the four roots', () => {
    const base = hashGameInputs({ repoRoot: repo.dir, game: GAME }).sha256;
    const rootFiles = {
      src: `games/${GAME}/src/main.ts`,
      design: `games/${GAME}/design/tokens.css`,
      refs: `games/${GAME}/refs/manifest.yaml`,
      'packages/ui': 'packages/ui/src/ui.css',
    };
    for (const [label, rel] of Object.entries(rootFiles)) {
      const abs = path.join(repo.dir, rel);
      const original = fs.readFileSync(abs);
      fs.writeFileSync(abs, Buffer.concat([original, Buffer.from('X')]));
      const mutated = hashGameInputs({ repoRoot: repo.dir, game: GAME }).sha256;
      expect(mutated, `mutation under ${label} must flip the hash`).not.toBe(base);
      fs.writeFileSync(abs, original);
    }
    // Restored to the original bytes → back to the original hash.
    expect(hashGameInputs({ repoRoot: repo.dir, game: GAME }).sha256).toBe(base);
  });

  it('flips when a new file is added under a root (path/root sensitivity)', () => {
    const base = hashGameInputs({ repoRoot: repo.dir, game: GAME }).sha256;
    fs.writeFileSync(path.join(repo.dir, `games/${GAME}/src/added.ts`), 'x');
    expect(hashGameInputs({ repoRoot: repo.dir, game: GAME }).sha256).not.toBe(base);
  });

  it('throws (fail closed) when a root is missing', () => {
    fs.rmSync(path.join(repo.dir, 'packages/ui'), { recursive: true, force: true });
    expect(() => hashGameInputs({ repoRoot: repo.dir, game: GAME })).toThrow(/root missing/);
  });

  it('throws (fail closed) when a symlink is found inside a root', () => {
    fs.symlinkSync(
      path.join(repo.dir, `games/${GAME}/src/main.ts`),
      path.join(repo.dir, `games/${GAME}/src/link.ts`),
    );
    expect(() => hashGameInputs({ repoRoot: repo.dir, game: GAME })).toThrow(/symlink/);
  });
});

describe('buildObservation + writeObservation round trip', () => {
  it('produces a structurally valid artifact and survives a JSON round trip byte-for-byte', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    expect(observation.schemaVersion).toBe(OBSERVATION_SCHEMA_VERSION);
    expect(observation.inputs.algorithm).toBe(OBSERVATION_HASH_ALGORITHM);
    expect(observation.requiredStates).toEqual(STATES);
    expect(observation.captures.map((c) => c.state)).toEqual(STATES);
    expect(observation.captures.every((c) => c.gated === true && c.present === true)).toBe(true);
    expect(observation.captures.every((c) => /^[a-f0-9]{64}$/.test(c.sha256))).toBe(true);
    expect(validateObservation(observation)).toEqual({ ok: true, reason: expect.any(String) });

    const outDir = path.join(repo.dir, 'docs/evidence/2026-07-12-device-verify');
    const file = writeObservation(outDir, observation);
    const reparsed = parseObservation(fs.readFileSync(file, 'utf8'));
    expect(reparsed).toEqual(observation);
    expect(acceptObservationForGate({ observation: reparsed, repoRoot: repo.dir }).accepted).toBe(true);
  });

  it('records the resolved lane/provenance rather than hardcoding trusted values', () => {
    const browser = buildValidObservation(repo.dir, repo.captureFilesByState, {
      lane: 'browser',
      provenance: 'browser',
    });
    expect(browser.lane).toBe('browser');
    expect(browser.provenance).toBe('browser');
    expect(validateObservation(browser).ok).toBe(false);
  });

  it('keeps a producer failure additive: no artifact, returned error, no throw', () => {
    fs.rmSync(path.join(repo.dir, 'packages/ui'), { recursive: true, force: true });
    const outDir = path.join(repo.dir, 'docs/evidence/2026-07-12-device-verify');
    const result = tryWriteObservation(outDir, {
      repoRoot: repo.dir,
      game: GAME,
      lane: 'device',
      provenance: 'live-device',
      runKind: OBSERVATION_ACCEPTED_RUN_KIND,
      requiredStates: STATES,
      captureByState: gatedCaptureByState(),
      captureFilesByState: repo.captureFilesByState,
    });
    expect(result.observation).toBeNull();
    expect(result.file).toBeNull();
    expect(result.error?.message).toMatch(/input root missing/);
    expect(fs.existsSync(path.join(outDir, 'observation.json'))).toBe(false);
  });
});

describe('validateObservation policy gates', () => {
  const cases = [
    ['unknown schemaVersion', (o) => { o.schemaVersion = 'nope/9'; }],
    ['unknown inputs.algorithm', (o) => { o.inputs.algorithm = 'sha1-hack'; }],
    ['non-device lane', (o) => { o.lane = 'browser'; }],
    ['untrusted provenance', (o) => { o.provenance = 'provided-captures'; }],
    ['runKind verified-pass', (o) => { o.runKind = 'verified-pass'; }],
    ['runKind unverified', (o) => { o.runKind = 'unverified'; }],
    ['runKind verified-fail', (o) => { o.runKind = 'verified-fail'; }],
    ['runKind skipped', (o) => { o.runKind = 'skipped'; }],
    ['non-null captureFailure', (o) => { o.captureFailure = 'android capture failures: menu'; }],
    ['nonempty hardIntegrity', (o) => { o.hardIntegrity = ['blind (ungated) captures: shop']; }],
    ['a required state has no capture', (o) => { o.captures = o.captures.filter((c) => c.state !== 'shop'); }],
    ['a capture is ungated (blind)', (o) => { o.captures.find((c) => c.state === 'win').gated = false; }],
    ['a capture is absent', (o) => { o.captures.find((c) => c.state === 'win').present = false; }],
    ['a capture has no file', (o) => { o.captures.find((c) => c.state === 'win').file = ''; }],
    ['a capture has no hash', (o) => { o.captures.find((c) => c.state === 'win').sha256 = null; }],
    ['capture states are duplicated', (o) => { o.captures[1].state = o.captures[0].state; }],
    ['required states are duplicated', (o) => { o.requiredStates[1] = o.requiredStates[0]; }],
    ['requiredStates empty', (o) => { o.requiredStates = []; }],
  ];
  for (const [label, mutate] of cases) {
    it(`rejects when ${label}`, () => {
      const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
      mutate(observation);
      expect(validateObservation(observation).ok).toBe(false);
    });
  }

  it('accepts a clean no-applicable live-device observation', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    expect(validateObservation(observation).ok).toBe(true);
    expect(observation.runKind).toBe(OBSERVATION_ACCEPTED_RUN_KIND);
  });
});

describe('acceptObservationForGate recomputation', () => {
  it('accepts when the recomputed source hash matches', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    const decision = acceptObservationForGate({ observation, repoRoot: repo.dir });
    expect(decision).toMatchObject({ accepted: true, game: GAME });
  });

  it('rejects on a hash mismatch (source changed after capture)', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    fs.writeFileSync(path.join(repo.dir, 'packages/ui/src/ui.css'), '.fab{display:flex}\n');
    const decision = acceptObservationForGate({ observation, repoRoot: repo.dir });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toMatch(/hash mismatch/);
  });

  it('rejects on a fileCount tamper even if sha256 is copied', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    observation.inputs.fileCount += 1;
    expect(acceptObservationForGate({ observation, repoRoot: repo.dir }).accepted).toBe(false);
  });

  it('rejects on a roots tamper', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    observation.inputs.roots = observation.inputs.roots.slice(0, 3);
    expect(acceptObservationForGate({ observation, repoRoot: repo.dir }).accepted).toBe(false);
  });

  it('rejects a self-declared subset of the protocol states', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    observation.requiredStates = ['menu'];
    observation.captures = observation.captures.filter((capture) => capture.state === 'menu');
    const decision = acceptObservationForGate({ observation, repoRoot: repo.dir });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toMatch(/protocol contract\.states/);
  });

  it('rejects a self-declared extra state beyond the protocol', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    observation.requiredStates.push('bonus');
    observation.captures.push({
      ...observation.captures[0],
      state: 'bonus',
    });
    const decision = acceptObservationForGate({ observation, repoRoot: repo.dir });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toMatch(/protocol contract\.states/);
  });

  it('rejects the complete protocol states in the wrong order', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    observation.requiredStates = [...observation.requiredStates].reverse();
    observation.captures = [...observation.captures].reverse();
    const decision = acceptObservationForGate({ observation, repoRoot: repo.dir });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toMatch(/protocol contract\.states/);
  });

  it('rejects a game that is not named as an observation protocol lane', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    const protocolFile = path.join(repo.dir, 'experiments/design-frontends/protocol.json');
    fs.writeFileSync(protocolFile, JSON.stringify({ contract: { states: STATES }, lanes: [] }));
    const decision = acceptObservationForGate({ observation, repoRoot: repo.dir });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toMatch(/not an observation protocol lane/);
  });

  it('rejects when a recorded capture file is missing', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    fs.rmSync(repo.captureFilesByState.shop);
    const decision = acceptObservationForGate({ observation, repoRoot: repo.dir });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toMatch(/capture file.*missing/);
  });

  it('rejects when captured bytes drift after the observation is written', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    fs.writeFileSync(repo.captureFilesByState.shop, 'different-png-bytes');
    const decision = acceptObservationForGate({ observation, repoRoot: repo.dir });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toMatch(/capture hash mismatch/);
  });

  it('rejects when a capture is replaced by a symlink', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    const target = repo.captureFilesByState.menu;
    fs.rmSync(repo.captureFilesByState.shop);
    fs.symlinkSync(target, repo.captureFilesByState.shop);
    const decision = acceptObservationForGate({ observation, repoRoot: repo.dir });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toMatch(/capture file.*missing/);
  });

  it('rejects a capture path outside the committed evidence roots', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    observation.captures[0].file = `games/${GAME}/src/main.ts`;
    observation.captures[0].sha256 = hashGameInputs({ repoRoot: repo.dir, game: GAME }).sha256;
    const decision = acceptObservationForGate({ observation, repoRoot: repo.dir });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toMatch(/invalid evidence path/);
  });

  it('rejects (never throws) when a root goes missing at recompute time', () => {
    const observation = buildValidObservation(repo.dir, repo.captureFilesByState);
    fs.rmSync(path.join(repo.dir, `games/${GAME}/refs`), { recursive: true, force: true });
    const decision = acceptObservationForGate({ observation, repoRoot: repo.dir });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toMatch(/recomputation failed/);
  });
});
