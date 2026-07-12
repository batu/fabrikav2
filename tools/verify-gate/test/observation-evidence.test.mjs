import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readObservationEvidence } from '../src/observation-evidence.mjs';
import { decideMerge, decideStop } from '../src/classify.mjs';
import {
  buildObservation,
  writeObservation,
  OBSERVATION_ACCEPTED_RUN_KIND,
} from '../../verify-device/src/observation.mjs';

const GAME = 'shell_proof_grapes';
const STATES = ['menu', 'level', 'shop', 'settings', 'pause', 'win', 'fail'];
const EVIDENCE_DIR = 'docs/evidence/2026-07-12-device-verify';

let repo;

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-observation-'));
  const write = (rel, content) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  write(`games/${GAME}/src/main.ts`, 'export const main = 1;\n');
  write(`games/${GAME}/design/tokens.css`, ':root{--x:1px}\n');
  write(`games/${GAME}/refs/manifest.yaml`, 'game: shell_proof_grapes\n');
  write('packages/ui/src/ui.css', '.fab{display:grid}\n');
  write('experiments/design-frontends/protocol.json', `${JSON.stringify({
    contract: { states: STATES },
    lanes: [{ game: `games/${GAME}` }],
  })}\n`);
  const captureFilesByState = {};
  for (const state of STATES) {
    const rel = `${EVIDENCE_DIR}/raw-captures/${state}.png`;
    write(rel, `png-${state}`);
    captureFilesByState[state] = path.join(dir, rel);
  }
  return { dir, captureFilesByState, write };
}

function makeObservation(overrides = {}) {
  return buildObservation({
    repoRoot: repo.dir,
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
    captureByState: Object.fromEntries(STATES.map((s) => [s, { gated: true }])),
    captureFilesByState: repo.captureFilesByState,
    ...overrides,
  });
}

function writeObs(observation) {
  return writeObservation(path.join(repo.dir, EVIDENCE_DIR), observation);
}

const MERGE_BASE = {
  changedFiles: [`games/${GAME}/src/main.ts`],
  newestVisualMtimeMs: 1000,
  panelEvidence: [],
  ledgerEntryCount: 0,
  worktreeDirtyFiles: [],
  toolPresent: true,
  gamesDirPresent: true,
};

beforeEach(() => {
  repo = makeRepo();
});

afterEach(() => {
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

describe('readObservationEvidence against the real checkout', () => {
  it('accepts a producer-written no-reference live-device observation with zero adaptation', () => {
    writeObs(makeObservation());
    const records = readObservationEvidence(repo.dir);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ accepted: true, game: GAME });
  });

  it('rejects once the source drifts from the recorded hash', () => {
    writeObs(makeObservation());
    fs.writeFileSync(path.join(repo.dir, 'packages/ui/src/ui.css'), '.fab{display:flex}\n');
    const [record] = readObservationEvidence(repo.dir);
    expect(record.accepted).toBe(false);
    expect(record.reason).toMatch(/hash mismatch/);
  });

  it('rejects when the committed capture bytes no longer match the observation', () => {
    writeObs(makeObservation());
    fs.writeFileSync(repo.captureFilesByState.shop, 'tampered-capture');
    const [record] = readObservationEvidence(repo.dir);
    expect(record.accepted).toBe(false);
    expect(record.reason).toMatch(/capture hash mismatch/);
  });

  it('rejects corrupt JSON without throwing', () => {
    fs.mkdirSync(path.join(repo.dir, EVIDENCE_DIR), { recursive: true });
    fs.writeFileSync(path.join(repo.dir, EVIDENCE_DIR, 'observation.json'), '{ not json');
    const [record] = readObservationEvidence(repo.dir);
    expect(record.accepted).toBe(false);
    expect(record.reason).toMatch(/not valid JSON/);
  });

  it('rejects an unknown schema version', () => {
    const obs = makeObservation();
    obs.schemaVersion = 'legacy/0';
    writeObs(obs);
    expect(readObservationEvidence(repo.dir)[0].accepted).toBe(false);
  });

  it('rejects an artifact that self-declares only one protocol state', () => {
    const obs = makeObservation();
    obs.requiredStates = ['menu'];
    obs.captures = obs.captures.filter((capture) => capture.state === 'menu');
    writeObs(obs);
    const [record] = readObservationEvidence(repo.dir);
    expect(record.accepted).toBe(false);
    expect(record.reason).toMatch(/protocol contract\.states/);
  });

  it.each([
    ['browser lane', { lane: 'browser', provenance: 'browser' }],
    ['provided-captures', { lane: 'provided-captures', provenance: 'provided-captures' }],
    ['detached xcresult', { lane: 'device', provenance: 'detached-xcresult' }],
    ['verified-pass run', { runKind: 'verified-pass' }],
    ['unverified run', { runKind: 'unverified' }],
    ['capture failure', { captureFailure: 'android capture failures: shop' }],
    ['nonempty hard integrity', { hardIntegrity: ['blind (ungated) captures: shop'] }],
  ])('rejects %s', (_label, overrides) => {
    writeObs(makeObservation(overrides));
    expect(readObservationEvidence(repo.dir)[0].accepted).toBe(false);
  });

  it('rejects when a required state capture is missing/ungated', () => {
    const obs = makeObservation();
    obs.captures.find((c) => c.state === 'shop').gated = false;
    writeObs(obs);
    expect(readObservationEvidence(repo.dir)[0].accepted).toBe(false);
  });
});

describe('decideMerge with observation coverage', () => {
  it('lands a src change covered by an accepted observation for that game', () => {
    writeObs(makeObservation());
    const observationEvidence = readObservationEvidence(repo.dir);
    const decision = decideMerge({ ...MERGE_BASE, observationEvidence });
    expect(decision.ok).toBe(true);
    expect(decision.reason).toMatch(/no-reference live-device observation/);
  });

  it('does NOT land when the accepted observation is for a different game', () => {
    const observationEvidence = [{ accepted: true, game: 'other_game', reason: 'x' }];
    const decision = decideMerge({ ...MERGE_BASE, observationEvidence });
    expect(decision.ok).toBe(false);
  });

  it('does NOT land on a rejected observation record', () => {
    const observationEvidence = [{ accepted: false, game: GAME, reason: 'hash mismatch' }];
    const decision = decideMerge({ ...MERGE_BASE, observationEvidence });
    expect(decision.ok).toBe(false);
  });

  it('covers a packages/ui-only diff with any accepted observation', () => {
    const observationEvidence = [{ accepted: true, game: GAME, reason: 'x' }];
    const decision = decideMerge({
      ...MERGE_BASE,
      changedFiles: ['packages/ui/src/ui.css'],
      observationEvidence,
    });
    expect(decision.ok).toBe(true);
  });

  it('still fails ledger-only with no panel and no accepted observation', () => {
    const decision = decideMerge({
      ...MERGE_BASE,
      ledgerEntryCount: 3,
      observationEvidence: [{ accepted: false, game: GAME, reason: 'stale' }],
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/cannot land/);
  });

  it('leaves the panel path unchanged when a fresh device panel already covers', () => {
    const panelEvidence = [{
      path: 'p', valid: true, game: GAME, lane: 'device', generatedAtMs: 5000, verdictPass: true,
    }];
    const decision = decideMerge({ ...MERGE_BASE, panelEvidence, observationEvidence: [] });
    expect(decision.ok).toBe(true);
  });
});

describe('decideStop with observation coverage', () => {
  const STOP_BASE = {
    message: 'Implemented the shop grid and verified it works.',
    changedFiles: [`games/${GAME}/src/main.ts`],
    newestVisualMtimeMs: 1000,
    panelEvidence: [],
    toolPresent: true,
    gamesDirPresent: true,
  };

  it('passes a done-claim covered by an accepted observation', () => {
    const observationEvidence = [{ accepted: true, game: GAME, reason: 'x' }];
    const decision = decideStop({ ...STOP_BASE, observationEvidence });
    expect(decision.action).toBe('pass');
  });

  it('blocks a done-claim with only a rejected observation', () => {
    const observationEvidence = [{ accepted: false, game: GAME, reason: 'stale' }];
    const decision = decideStop({ ...STOP_BASE, observationEvidence });
    expect(decision.action).toBe('block');
  });
});
