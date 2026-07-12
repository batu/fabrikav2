// U1 freeze-record verifier (card qWCv9tUo freeze tail). The executable,
// unit-tested check that the dual-design-frontends comparison baseline is
// honestly SEALED: a non-null, present, in-history baseline commit plus a
// deterministic, NON-CIRCULAR SHA-256 over the frozen protocol payload,
// fences.json, and every baseline/* file. It rejects a null commit, a commit
// not present or not an ancestor of HEAD, a hash mismatch, or a missing/extra
// frozen file.
//
// NON-CIRCULAR rule: protocol.json is hashed over the SHA-256 of its parsed
// JSON with the top-level `freeze` key removed and remaining keys recursively
// sorted, then serialized compactly. Because the `freeze` block that STORES
// these hashes is excluded from its own input, sealing the record never changes
// the recorded protocol hash. fences.json and every baseline/* file are hashed
// over their exact on-disk bytes.
//
// This module is PURE: all IO (file reads, hashing of bytes, git queries) is
// done by the caller (freeze-gate.mjs) and passed in, so every rejection path
// is unit-testable without spawning git or touching the filesystem.

import { createHash } from 'node:crypto';

export const HASH_ALGORITHM = 'sha256';
export const PROTOCOL_FILE = 'protocol.json';
export const FENCES_FILE = 'fences.json';
export const BASELINE_DIR = 'baseline';
/** The two frozen files that must always exist alongside the baseline/* set. */
export const REQUIRED_FILES = [PROTOCOL_FILE, FENCES_FILE];
/** A sealed baseline commit is a full 40-hex object name — never abbreviated. */
export const COMMIT_RE = /^[0-9a-f]{40}$/;

/**
 * Recursively sort object keys so serialization is order-independent. Arrays
 * keep their order (semantically significant); scalars pass through.
 */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/** SHA-256 hex of a string or Buffer. */
export function sha256Hex(input) {
  return createHash(HASH_ALGORITHM).update(input).digest('hex');
}

/**
 * Non-circular protocol payload hash: parse, drop the top-level `freeze` key,
 * canonicalize the remainder, hash the compact JSON. Throws on invalid JSON —
 * a gate that cannot read the protocol must not silently pass.
 * @param {string} protocolText raw protocol.json contents
 * @returns {string} sha256 hex of the freeze-excluded canonical payload
 */
export function hashProtocolPayload(protocolText) {
  const obj = JSON.parse(protocolText);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('protocol.json must be a JSON object');
  }
  const payload = { ...obj };
  delete payload.freeze;
  return sha256Hex(Buffer.from(JSON.stringify(canonicalize(payload)), 'utf8'));
}

/** Exact-bytes hash for fences.json and every baseline/* file. */
export function hashBytes(buffer) {
  return sha256Hex(buffer);
}

/**
 * Verify a gathered freeze record. Pure orchestration of the rejection rules.
 *
 * @param {object} args
 * @param {any} args.freeze  the protocol.json `freeze` block (as parsed)
 * @param {Record<string,string>} args.actualHashes  recomputed hash keyed by
 *   frozen relative path actually present on disk (protocol.json → payload
 *   hash; fences.json and baseline/* → byte hash)
 * @param {{present:boolean, inHistory:boolean}|null} args.commit  git facts for
 *   freeze.baselineCommit; may be null when the commit string is invalid
 * @returns {{ok:boolean, errors:string[]}}
 */
export function verifyFreeze({ freeze, actualHashes, commit }) {
  const errors = [];

  if (!freeze || typeof freeze !== 'object') {
    return { ok: false, errors: ['protocol.freeze block is missing or not an object'] };
  }

  // 1. Baseline commit: non-null, well-formed, present, and in HEAD's history.
  const sha = freeze.baselineCommit;
  if (sha === null || sha === undefined) {
    errors.push('freeze.baselineCommit is null — the baseline is NOT sealed');
  } else if (typeof sha !== 'string' || !COMMIT_RE.test(sha)) {
    errors.push(`freeze.baselineCommit is not a 40-hex commit SHA: ${JSON.stringify(sha)}`);
  } else if (!commit || !commit.present) {
    errors.push(`freeze.baselineCommit ${sha} is not present in the repository`);
  } else if (!commit.inHistory) {
    errors.push(`freeze.baselineCommit ${sha} is not an ancestor of HEAD — inappropriate baseline`);
  }

  // 2. Hash record shape.
  const recorded = freeze.hashes;
  if (!recorded || typeof recorded !== 'object' || Array.isArray(recorded)) {
    errors.push('freeze.hashes is missing or not an object');
    return { ok: false, errors };
  }
  if (freeze.hashAlgorithm !== HASH_ALGORITHM) {
    errors.push(`freeze.hashAlgorithm must be "${HASH_ALGORITHM}" (got ${JSON.stringify(freeze.hashAlgorithm)})`);
  }

  const recordedPaths = new Set(Object.keys(recorded));
  const actualPaths = new Set(Object.keys(actualHashes));

  // 3. Required files must exist on disk.
  for (const req of REQUIRED_FILES) {
    if (!actualPaths.has(req)) errors.push(`required frozen file ${req} is missing on disk`);
  }

  // 4. Coverage: no recorded-but-missing file, no on-disk-but-unrecorded file.
  for (const p of recordedPaths) {
    if (!actualPaths.has(p)) errors.push(`freeze.hashes names ${p} but it is missing on disk`);
  }
  for (const p of actualPaths) {
    if (!recordedPaths.has(p)) errors.push(`${p} is present on disk but not covered by freeze.hashes`);
  }

  // 5. Exact hash match for every path present in both sets.
  for (const p of recordedPaths) {
    if (!actualPaths.has(p)) continue;
    if (recorded[p] !== actualHashes[p]) {
      errors.push(`hash mismatch for ${p}: recorded ${recorded[p]} != actual ${actualHashes[p]}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
