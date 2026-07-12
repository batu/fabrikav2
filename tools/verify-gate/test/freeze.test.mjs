import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  HASH_ALGORITHM,
  canonicalize,
  hashBytes,
  hashProtocolPayload,
  sha256Hex,
  verifyFreeze,
} from '../src/freeze.mjs';
import { gatherActualHashes, gitCommitFacts } from '../freeze-gate.mjs';

// The sealed U1 baseline lives two levels up from this workspace.
const EXPERIMENT_ROOT = resolve(process.cwd(), '../../experiments/design-frontends');

const OK_COMMIT = { present: true, inHistory: true };
const GOOD_HASHES = {
  'protocol.json': 'aa',
  'fences.json': 'bb',
  'baseline/behavior-hashes.json': 'cc',
};
function goodFreeze(overrides = {}) {
  return {
    baselineCommit: '0'.repeat(40),
    hashAlgorithm: HASH_ALGORITHM,
    hashes: { ...GOOD_HASHES },
    ...overrides,
  };
}

describe('canonicalize', () => {
  it('sorts object keys recursively and is order-independent', () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it('preserves array order (semantically significant)', () => {
    expect(JSON.stringify(canonicalize({ s: ['menu', 'level', 'shop'] }))).toBe(
      '{"s":["menu","level","shop"]}',
    );
  });
});

describe('hashProtocolPayload — non-circular', () => {
  it('ignores the freeze block entirely', () => {
    const unsealed = JSON.stringify({ contract: { states: ['menu'] }, freeze: { baselineCommit: null } });
    const sealed = JSON.stringify({
      contract: { states: ['menu'] },
      freeze: { baselineCommit: 'a'.repeat(40), hashes: { 'protocol.json': 'x' } },
    });
    expect(hashProtocolPayload(sealed)).toBe(hashProtocolPayload(unsealed));
  });
  it('is independent of top-level key order outside freeze', () => {
    const one = JSON.stringify({ a: 1, b: 2, freeze: {} });
    const two = JSON.stringify({ b: 2, a: 1, freeze: { note: 'x' } });
    expect(hashProtocolPayload(one)).toBe(hashProtocolPayload(two));
  });
  it('changes when a non-freeze field changes', () => {
    const base = JSON.stringify({ contract: { states: ['menu'] }, freeze: {} });
    const drifted = JSON.stringify({ contract: { states: ['menu', 'shop'] }, freeze: {} });
    expect(hashProtocolPayload(base)).not.toBe(hashProtocolPayload(drifted));
  });
  it('throws on invalid JSON rather than passing silently', () => {
    expect(() => hashProtocolPayload('{not json')).toThrow();
  });
});

describe('hashBytes / sha256Hex', () => {
  it('matches a known SHA-256 vector', () => {
    // echo -n "" | sha256sum
    expect(sha256Hex(Buffer.from(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
  it('is byte-exact', () => {
    expect(hashBytes(Buffer.from('a'))).not.toBe(hashBytes(Buffer.from('a\n')));
  });
});

describe('verifyFreeze', () => {
  it('passes a well-formed sealed record', () => {
    expect(
      verifyFreeze({ freeze: goodFreeze(), actualHashes: { ...GOOD_HASHES }, commit: OK_COMMIT }),
    ).toEqual({ ok: true, errors: [] });
  });

  it('rejects a null baseline commit', () => {
    const r = verifyFreeze({
      freeze: goodFreeze({ baselineCommit: null }),
      actualHashes: { ...GOOD_HASHES },
      commit: null,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/baselineCommit is null/);
  });

  it('rejects a malformed (abbreviated) commit SHA', () => {
    const r = verifyFreeze({
      freeze: goodFreeze({ baselineCommit: '9428c06' }),
      actualHashes: { ...GOOD_HASHES },
      commit: null,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/not a 40-hex commit SHA/);
  });

  it('rejects a commit that is not present in the repository', () => {
    const r = verifyFreeze({
      freeze: goodFreeze(),
      actualHashes: { ...GOOD_HASHES },
      commit: { present: false, inHistory: false },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/not present in the repository/);
  });

  it('rejects a commit that is not an ancestor of HEAD', () => {
    const r = verifyFreeze({
      freeze: goodFreeze(),
      actualHashes: { ...GOOD_HASHES },
      commit: { present: true, inHistory: false },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/not an ancestor of HEAD/);
  });

  it('rejects a hash mismatch', () => {
    const r = verifyFreeze({
      freeze: goodFreeze(),
      actualHashes: { ...GOOD_HASHES, 'fences.json': 'TAMPERED' },
      commit: OK_COMMIT,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/hash mismatch for fences\.json/);
  });

  it('rejects a recorded file missing from disk', () => {
    const actual = { ...GOOD_HASHES };
    delete actual['baseline/behavior-hashes.json'];
    const r = verifyFreeze({ freeze: goodFreeze(), actualHashes: actual, commit: OK_COMMIT });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/names baseline\/behavior-hashes\.json but it is missing on disk/);
  });

  it('rejects an extra on-disk file not covered by the record', () => {
    const r = verifyFreeze({
      freeze: goodFreeze(),
      actualHashes: { ...GOOD_HASHES, 'baseline/new-file.json': 'zz' },
      commit: OK_COMMIT,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/baseline\/new-file\.json is present on disk but not covered/);
  });

  it('rejects when a required frozen file is absent from disk', () => {
    const actual = { ...GOOD_HASHES };
    delete actual['fences.json'];
    const freeze = goodFreeze();
    delete freeze.hashes['fences.json'];
    const r = verifyFreeze({ freeze, actualHashes: actual, commit: OK_COMMIT });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/required frozen file fences\.json is missing on disk/);
  });

  it('rejects a wrong hash algorithm', () => {
    const r = verifyFreeze({
      freeze: goodFreeze({ hashAlgorithm: 'md5' }),
      actualHashes: { ...GOOD_HASHES },
      commit: OK_COMMIT,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/hashAlgorithm must be "sha256"/);
  });

  it('rejects a missing freeze block', () => {
    expect(verifyFreeze({ freeze: null, actualHashes: {}, commit: null }).ok).toBe(false);
  });

  it('rejects a missing hashes object', () => {
    const r = verifyFreeze({
      freeze: { baselineCommit: '0'.repeat(40), hashAlgorithm: HASH_ALGORITHM },
      actualHashes: { ...GOOD_HASHES },
      commit: OK_COMMIT,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/freeze\.hashes is missing/);
  });
});

describe('gitCommitFacts', () => {
  it('returns null for a malformed SHA without querying git', () => {
    let called = false;
    const run = () => {
      called = true;
      return { ok: true };
    };
    expect(gitCommitFacts(run, 'abc')).toBeNull();
    expect(called).toBe(false);
  });
  it('reports present + inHistory when both git checks pass', () => {
    const run = (cmd) => ({ ok: cmd.includes('cat-file') || cmd.includes('is-ancestor') });
    expect(gitCommitFacts(run, 'a'.repeat(40))).toEqual({ present: true, inHistory: true });
  });
  it('does not claim history when the object is absent', () => {
    const run = () => ({ ok: false });
    expect(gitCommitFacts(run, 'a'.repeat(40))).toEqual({ present: false, inHistory: false });
  });
});

// Integration: the committed U1 seal must be internally consistent. Skips on
// branches without the experiment baseline (e.g. main) — the same
// self-disabling contract as the gate CLI.
const protocolPath = resolve(EXPERIMENT_ROOT, 'protocol.json');
const hasBaseline = existsSync(protocolPath);
describe('sealed U1 freeze record (real repo)', () => {
  (hasBaseline ? it : it.skip)('recomputes to exactly the recorded hashes', () => {
    const freeze = JSON.parse(readFileSync(protocolPath, 'utf8')).freeze;
    const actual = gatherActualHashes(EXPERIMENT_ROOT);
    expect(verifyFreeze({ freeze, actualHashes: actual, commit: OK_COMMIT })).toEqual({
      ok: true,
      errors: [],
    });
    expect(freeze.baselineCommit).toMatch(/^[0-9a-f]{40}$/);
  });
});
