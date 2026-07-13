// U1 freeze-record verifier (card qWCv9tUo freeze tail). The executable,
// unit-tested check that the dual-design-frontends comparison baseline is
// honestly SEALED: a non-null, present, in-history baseline commit plus a
// deterministic, NON-CIRCULAR SHA-256 over the frozen protocol payload,
// fences.json, and every baseline/* file. It rejects a null commit, a commit
// not present or not an ancestor of HEAD, a hash mismatch, or a missing/extra
// frozen file.
//
// NON-CIRCULAR rule: the recorded integrity hash of protocol.json is the SHA-256
// of its parsed JSON with ONLY the nested `freeze.hashes` map removed (NOT the
// whole freeze block) and remaining keys recursively sorted, then serialized
// compactly. Because only the map that STORES these hashes is excluded from its
// own input, sealing the record never changes the recorded protocol hash while
// every other freeze field — baselineCommit / sealedStage / hashAlgorithm /
// hashRule / note — stays authenticated (see `hashProtocolForIntegrity`). The
// WHOLE freeze block is stripped only for the separate A-vs-B content-equality
// check (see `hashProtocolStripFreeze`), never for the integrity hash.
// fences.json and every baseline/* file are hashed over their exact on-disk
// bytes.
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

function parseProtocolObject(protocolText) {
  const obj = JSON.parse(protocolText);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('protocol.json must be a JSON object');
  }
  return obj;
}

/**
 * SELF-AUTHENTICATING protocol hash (card qWCv9tUo item 1): parse, drop ONLY the
 * nested `freeze.hashes` key, canonicalize the remainder, hash the compact JSON.
 * Because only the map that STORES the hashes is excluded, everything else —
 * including freeze.baselineCommit / sealedStage / hashAlgorithm / hashRule /
 * note — is authenticated by the recorded protocol hash. Still non-circular: the
 * hash never feeds itself. This is the CURRENT-WORKTREE integrity input. Throws
 * on invalid JSON — a gate that cannot read the protocol must not silently pass.
 * @param {string} protocolText raw protocol.json contents
 * @returns {string} sha256 hex of the (freeze.hashes-excluded) canonical payload
 */
export function hashProtocolForIntegrity(protocolText) {
  const obj = parseProtocolObject(protocolText);
  const payload = { ...obj };
  if (payload.freeze && typeof payload.freeze === 'object') {
    const freeze = { ...payload.freeze };
    delete freeze.hashes;
    payload.freeze = freeze;
  }
  return sha256Hex(Buffer.from(JSON.stringify(canonicalize(payload)), 'utf8'));
}

/**
 * Whole-freeze-stripped protocol hash: drop the ENTIRE top-level `freeze` block,
 * canonicalize, hash. Used ONLY for the A-vs-B content-equality check, so the
 * functional baseline commit A (whose freeze block predates the seal) and the
 * freeze-only commit B compare equal on their non-freeze payload. An older
 * ancestor with a different payload fails this check.
 * @param {string} protocolText raw protocol.json contents
 * @returns {string} sha256 hex of the (whole-freeze-excluded) canonical payload
 */
export function hashProtocolStripFreeze(protocolText) {
  const obj = parseProtocolObject(protocolText);
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

/**
 * A-vs-B content equality (comment 36 topology): prove the recorded baseline
 * commit A actually CONTAINS the sealed bytes — not merely that its SHA is an
 * ancestor. The freeze-only commit B differs from A ONLY in the top-level freeze
 * block, so with that block stripped their protocol payloads must be identical,
 * and fences.json + every baseline/* file must be byte-equal. A stale ancestor
 * (older functional baseline, or a substituted commit) fails here even though
 * its SHA is a valid ancestor and the current-worktree hashes still match.
 *
 * @param {object} args
 * @param {string} args.protocolA  protocol.json bytes AT commit A (text)
 * @param {string} args.protocolB  protocol.json bytes at HEAD/worktree B (text)
 * @param {Buffer} args.fencesA    fences.json bytes at A
 * @param {Buffer} args.fencesB    fences.json bytes at B
 * @param {Record<string,Buffer>} args.baselineA  baseline/* bytes at A (rel key)
 * @param {Record<string,Buffer>} args.baselineB  baseline/* bytes at B (rel key)
 * @returns {{ok:boolean, errors:string[]}}
 */
export function verifyBaselineContent({ protocolA, protocolB, fencesA, fencesB, baselineA, baselineB }) {
  const errors = [];
  if (hashProtocolStripFreeze(protocolA) !== hashProtocolStripFreeze(protocolB)) {
    errors.push('non-freeze protocol payload at the baseline commit differs from HEAD');
  }
  if (hashBytes(fencesA) !== hashBytes(fencesB)) {
    errors.push('fences.json at the baseline commit differs from HEAD');
  }
  const aKeys = Object.keys(baselineA).sort();
  const bKeys = Object.keys(baselineB).sort();
  if (aKeys.join('\n') !== bKeys.join('\n')) {
    errors.push(`baseline/* file set at the baseline commit differs from HEAD`);
  } else {
    for (const key of aKeys) {
      if (hashBytes(baselineA[key]) !== hashBytes(baselineB[key])) {
        errors.push(`baseline/${key} at the baseline commit differs from HEAD`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
