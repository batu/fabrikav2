// Vendor-neutral live-device OBSERVATION contract (card qWCv9tUo). The producer
// half of a deterministic authority seam: verify-device writes an observation.json
// that PROVES a live-device run captured every required state, and the merge/stop
// gate re-derives the same canonical source hash from the landing checkout to
// decide whether that proof still describes the code being landed.
//
// This module is the SINGLE OWNER of the schema constants, the canonical input
// hash, the artifact build/write, and the parse/validate/accept logic. Both
// tools/verify-device (write side) and tools/verify-gate (accept side) import it
// so the schema and the hash are defined exactly once — no divergent copy can
// drift (the exact failure that motivated this card: two tools computing the
// "same" thing differently). It deliberately has ZERO dependencies beyond the
// node stdlib so the gate can import it without pulling in the capture toolchain.
//
// An observation is NOT a fidelity pass. It records only that observation
// happened on the real device for a run that has NO trusted reference to score
// against (runKind === 'no-applicable-evidence'). A game that owns a real
// reference is never covered by this path — it still needs the vision panel.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Bump when the artifact shape changes. An unknown value fails closed at the gate. */
export const OBSERVATION_SCHEMA_VERSION = 'fabrikav2.verify-device.observation/1';

/** Bump when the canonical input hash framing changes. Unknown → fails closed. */
export const OBSERVATION_HASH_ALGORITHM = 'canonical-input-sha256/1';

/** The only lane whose observation the gate trusts. */
export const OBSERVATION_LANE = 'device';

/** The only capture provenance the gate trusts (current-invocation live device). */
export const OBSERVATION_PROVENANCE = 'live-device';

/** The ONLY run verdict kind an observation may cover. This restriction is what
 *  keeps `--skip-panel` from waving a game that owns a trusted reference through
 *  the gate: such a game's run is `unverified`, never `no-applicable-evidence`. */
export const OBSERVATION_ACCEPTED_RUN_KIND = 'no-applicable-evidence';

/** U1 observations are accepted only for games named as lanes in this protocol.
 *  Its ordered contract.states list is the authority for capture completeness. */
export const OBSERVATION_PROTOCOL_FILE = 'experiments/design-frontends/protocol.json';

// Build/tooling output directories that live UNDER an input root but are never
// canonical source (packages/ui/node_modules holds a host-local vite cache). They
// are excluded so a capture-host cache cannot make the observed hash diverge from
// the clean landing checkout — the card's "build/evidence/node_modules are
// outside the roots" rule made deterministic and testable.
export const OBSERVATION_EXCLUDED_DIRS = Object.freeze(['node_modules', 'build', 'evidence']);

// Host filesystem cruft, never source. Mirrors the frozen-behavior guard's
// existing .DS_Store skip so a macOS capture host and a Linux landing checkout
// hash the same source set.
export const OBSERVATION_EXCLUDED_FILES = Object.freeze(['.DS_Store']);

/**
 * The four canonical input roots for a game, in fixed order. `refs/**` is in the
 * set on purpose: it holds the per-game manifest and reference gaps, so a
 * capture-host manifest that diverges from the landing checkout invalidates the
 * observation instead of silently covering the wrong thing.
 * @param {string} game
 * @returns {string[]} repo-relative POSIX root paths
 */
export function observationInputRoots(game) {
  return [
    `games/${game}/src`,
    `games/${game}/design`,
    `games/${game}/refs`,
    'packages/ui',
  ];
}

function collectFiles(absDir, relDir, out, fsImpl) {
  const entries = fsImpl.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    const rel = `${relDir}/${entry.name}`;
    // Excluded generated/cache directories remain excluded when a package
    // manager represents them as symlinks (for example pnpm node_modules).
    if (OBSERVATION_EXCLUDED_DIRS.includes(entry.name)
      && (entry.isDirectory() || entry.isSymbolicLink())) continue;
    // Symlinks are rejected outright: they are fail-closed ambiguity (a link
    // could point outside the root or at nondeterministic state). Enumeration
    // must not require git, so this is the integrity rule that replaces it.
    if (entry.isSymbolicLink()) {
      throw new Error(`observation input contains a symlink (rejected): ${rel}`);
    }
    if (entry.isDirectory()) {
      collectFiles(abs, rel, out, fsImpl);
      continue;
    }
    if (entry.isFile()) {
      if (OBSERVATION_EXCLUDED_FILES.includes(entry.name)) continue;
      out.push({ rel, abs });
      continue;
    }
    // Sockets / fifos / devices are not regular files — fail closed, never skip.
    throw new Error(`observation input contains a non-regular entry (rejected): ${rel}`);
  }
}

/**
 * Canonical, versioned input hash over a game's four source roots. Deterministic
 * and git-free: enumerate every regular file under the roots, sort bytewise by
 * repo-relative POSIX path, frame each as `path + NUL + sha256(file bytes) + LF`,
 * then SHA-256 the concatenated manifest. One byte / path / root change flips the
 * digest. A missing root, a symlink, or a special file throws (fail closed).
 *
 * @param {{repoRoot:string, game:string, fsImpl?:typeof fs}} params
 * @returns {{algorithm:string, roots:string[], fileCount:number, sha256:string}}
 */
export function hashGameInputs({ repoRoot, game, fsImpl = fs }) {
  const roots = observationInputRoots(game);
  const files = [];
  for (const root of roots) {
    const absRoot = path.join(repoRoot, root);
    let stat;
    try {
      stat = fsImpl.lstatSync(absRoot);
    } catch {
      throw new Error(`observation input root missing: ${root}`);
    }
    if (stat.isSymbolicLink()) throw new Error(`observation input root is a symlink (rejected): ${root}`);
    if (!stat.isDirectory()) throw new Error(`observation input root is not a directory: ${root}`);
    collectFiles(absRoot, root, files, fsImpl);
  }
  files.sort((a, b) => Buffer.compare(Buffer.from(a.rel, 'utf8'), Buffer.from(b.rel, 'utf8')));
  // Framing: `path + NUL + sha256hex(file bytes) + LF`. NUL is the boundary
  // because it can never appear in a path, so no filename can forge a record.
  const framed = [];
  for (const file of files) {
    const fileHash = createHash('sha256').update(fsImpl.readFileSync(file.abs)).digest('hex');
    framed.push(Buffer.from(`${file.rel}\0${fileHash}\n`, 'utf8'));
  }
  const sha256 = createHash('sha256').update(Buffer.concat(framed)).digest('hex');
  return { algorithm: OBSERVATION_HASH_ALGORITHM, roots, fileCount: files.length, sha256 };
}

function toRepoRelative(repoRoot, abs) {
  return path.relative(repoRoot, abs).split(path.sep).join('/');
}

function sha256File(fsImpl, abs) {
  return createHash('sha256').update(fsImpl.readFileSync(abs)).digest('hex');
}

/**
 * Build the observation artifact from already-resolved run facts. `runKind` and
 * `hardIntegrity` are COPIED from the one typed run verdict — this module never
 * recomputes a verdict of its own. `lane`/`provenance` are the run's resolved
 * values (so a browser or provided-captures run records what it actually was and
 * the gate rejects it), not hardcoded to the trusted values.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.game
 * @param {string} params.lane resolved lane ('device'|'browser'|'provided-captures')
 * @param {string} params.provenance resolved provenance
 * @param {string|null} [params.platform]
 * @param {string|null} [params.deviceLabel]
 * @param {string} [params.generatedAt] ISO timestamp (defaults to now)
 * @param {string} params.runKind runVerdict.kind
 * @param {string[]} [params.hardIntegrity] runVerdict.hardIntegrity
 * @param {string|null} [params.captureFailure]
 * @param {string[]} params.requiredStates manifest-order state names
 * @param {Record<string,{gated:boolean}>} [params.captureByState]
 * @param {Record<string,string>} [params.captureFilesByState] state -> abs capture path
 * @param {typeof fs} [params.fsImpl]
 * @returns {object} the observation artifact
 */
export function buildObservation({
  repoRoot,
  game,
  lane,
  provenance,
  platform = null,
  deviceLabel = null,
  generatedAt,
  runKind,
  hardIntegrity = [],
  captureFailure = null,
  requiredStates = [],
  captureByState = {},
  captureFilesByState = {},
  fsImpl = fs,
}) {
  const inputs = hashGameInputs({ repoRoot, game, fsImpl });
  const captures = requiredStates.map((state) => {
    const abs = captureFilesByState[state];
    const meta = captureByState[state];
    const present = Boolean(abs) && regularFileExists(fsImpl, abs);
    return {
      state,
      gated: meta && typeof meta.gated === 'boolean' ? meta.gated : false,
      file: abs ? toRepoRelative(repoRoot, abs) : null,
      present,
      sha256: present ? sha256File(fsImpl, abs) : null,
    };
  });
  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    game,
    lane,
    platform,
    provenance,
    generatedAt: generatedAt || new Date().toISOString(),
    device: deviceLabel,
    runKind: String(runKind),
    captureFailure: captureFailure || null,
    hardIntegrity: Array.isArray(hardIntegrity) ? [...hardIntegrity] : [],
    requiredStates: [...requiredStates],
    captures,
    inputs,
  };
}

function regularFileExists(fsImpl, abs) {
  try {
    return fsImpl.lstatSync(abs).isFile();
  } catch {
    return false;
  }
}

/** Write observation.json beside summary.json. Returns the written path. */
export function writeObservation(outDir, observation, fsImpl = fs) {
  const file = path.join(outDir, 'observation.json');
  fsImpl.writeFileSync(file, `${JSON.stringify(observation, null, 2)}\n`);
  return file;
}

/**
 * Best-effort producer wrapper. Observation evidence is an additive landing
 * proof, not the owner of the run verdict: if hashing/writing fails, return the
 * error and no artifact so the merge gate still fails closed while the already
 * completed capture run keeps its truthful exit code.
 */
export function tryWriteObservation(outDir, params) {
  try {
    const observation = buildObservation(params);
    const file = writeObservation(outDir, observation, params.fsImpl || fs);
    return { observation, file, error: null };
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    return { observation: null, file: null, error: normalized };
  }
}

/** Parse observation.json text. Throws on invalid JSON (caller fails closed). */
export function parseObservation(raw) {
  return JSON.parse(raw);
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Structural + policy validation of an observation WITHOUT touching the
 * filesystem. Returns `{ ok, reason }`. Enforces every gate precondition that
 * does not need the checkout: known schema/algorithm, trusted lane/provenance,
 * the mandatory `no-applicable-evidence` run kind, no capture failure, empty
 * hard-integrity, and a gated+present capture file for every required state.
 * The exact-hash recomputation is done separately in {@link acceptObservationForGate}.
 * @param {object} observation
 * @returns {{ok:boolean, reason:string}}
 */
export function validateObservation(observation) {
  if (!isPlainObject(observation)) return reject('observation is not an object');
  if (observation.schemaVersion !== OBSERVATION_SCHEMA_VERSION) {
    return reject(`unknown schemaVersion: ${observation.schemaVersion}`);
  }
  if (typeof observation.game !== 'string' || observation.game.length === 0) {
    return reject('missing game');
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(observation.game)) {
    return reject(`invalid game slug: ${observation.game}`);
  }
  if (observation.lane !== OBSERVATION_LANE) {
    return reject(`lane must be ${OBSERVATION_LANE}, got ${observation.lane}`);
  }
  if (observation.provenance !== OBSERVATION_PROVENANCE) {
    return reject(`provenance must be ${OBSERVATION_PROVENANCE}, got ${observation.provenance}`);
  }
  if (observation.runKind !== OBSERVATION_ACCEPTED_RUN_KIND) {
    return reject(`runKind must be ${OBSERVATION_ACCEPTED_RUN_KIND}, got ${observation.runKind}`);
  }
  if (observation.captureFailure !== null && observation.captureFailure !== undefined) {
    return reject(`captureFailure must be null, got ${observation.captureFailure}`);
  }
  if (!Array.isArray(observation.hardIntegrity) || observation.hardIntegrity.length > 0) {
    return reject('hardIntegrity must be an empty array');
  }
  if (!Array.isArray(observation.requiredStates) || observation.requiredStates.length === 0) {
    return reject('requiredStates must be a non-empty array');
  }
  if (observation.requiredStates.some((state) => typeof state !== 'string' || state.length === 0)) {
    return reject('requiredStates must contain only non-empty strings');
  }
  if (new Set(observation.requiredStates).size !== observation.requiredStates.length) {
    return reject('requiredStates must not contain duplicates');
  }
  const inputs = observation.inputs;
  if (!isPlainObject(inputs)) return reject('missing inputs');
  if (inputs.algorithm !== OBSERVATION_HASH_ALGORITHM) {
    return reject(`unknown inputs.algorithm: ${inputs.algorithm}`);
  }
  if (typeof inputs.sha256 !== 'string' || inputs.sha256.length === 0) {
    return reject('missing inputs.sha256');
  }
  if (!Number.isInteger(inputs.fileCount)) return reject('missing inputs.fileCount');
  if (!Array.isArray(inputs.roots) || inputs.roots.length === 0) return reject('missing inputs.roots');

  if (!Array.isArray(observation.captures)) return reject('captures must be an array');
  if (observation.captures.length !== observation.requiredStates.length) {
    return reject('captures must contain exactly one record per required state');
  }
  const captureByState = new Map();
  for (const capture of observation.captures) {
    if (!isPlainObject(capture) || typeof capture.state !== 'string' || capture.state.length === 0) {
      return reject('each capture must have a non-empty state');
    }
    if (captureByState.has(capture.state)) return reject(`duplicate capture state: ${capture.state}`);
    captureByState.set(capture.state, capture);
  }
  for (const state of observation.requiredStates) {
    const capture = captureByState.get(state);
    if (!capture) return reject(`no capture record for required state ${state}`);
    if (capture.gated !== true) return reject(`capture for ${state} is not gated`);
    if (capture.present !== true) return reject(`capture for ${state} is not present`);
    if (typeof capture.file !== 'string' || capture.file.length === 0) {
      return reject(`capture for ${state} has no file path`);
    }
    if (!/^[a-f0-9]{64}$/.test(capture.sha256 || '')) {
      return reject(`capture for ${state} has no valid sha256`);
    }
  }
  return { ok: true, reason: 'observation is structurally valid' };
}

function reject(reason) {
  return { ok: false, reason };
}

function rootsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function arraysEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length
    && a.every((value, index) => value === b[index]);
}

function protocolStatesForGame({ repoRoot, game, fsImpl }) {
  const protocolFile = path.join(repoRoot, OBSERVATION_PROTOCOL_FILE);
  let protocol;
  try {
    protocol = JSON.parse(fsImpl.readFileSync(protocolFile, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read observation protocol ${OBSERVATION_PROTOCOL_FILE}: ${err.message}`);
  }
  const lanePath = `games/${game}`;
  const lanes = Array.isArray(protocol && protocol.lanes) ? protocol.lanes : [];
  if (!lanes.some((lane) => isPlainObject(lane) && lane.game === lanePath)) {
    throw new Error(`game is not an observation protocol lane: ${lanePath}`);
  }
  const states = protocol && protocol.contract && protocol.contract.states;
  if (!Array.isArray(states) || states.length === 0
    || states.some((state) => typeof state !== 'string' || state.length === 0)
    || new Set(states).size !== states.length) {
    throw new Error('observation protocol contract.states is invalid');
  }
  return states;
}

function capturePathIsAllowed(file, game) {
  if (path.posix.isAbsolute(file) || file.includes('\\')) return false;
  if (path.posix.normalize(file) !== file || file === '..' || file.startsWith('../')) return false;
  if (!file.endsWith('.png') || !file.includes('/raw-captures/')) return false;
  return file.startsWith(`games/${game}/evidence/`) || file.startsWith('docs/evidence/');
}

function validateCaptureFiles({ observation, repoRoot, fsImpl }) {
  for (const capture of observation.captures) {
    if (!capturePathIsAllowed(capture.file, observation.game)) {
      return reject(`capture for ${capture.state} has an invalid evidence path: ${capture.file}`);
    }
    const abs = path.resolve(repoRoot, capture.file);
    const relative = path.relative(repoRoot, abs);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return reject(`capture for ${capture.state} escapes the repository`);
    }
    if (!regularFileExists(fsImpl, abs)) {
      return reject(`capture file for ${capture.state} is missing: ${capture.file}`);
    }
    let actual;
    try {
      actual = sha256File(fsImpl, abs);
    } catch (err) {
      return reject(`capture file for ${capture.state} cannot be read: ${err.message}`);
    }
    if (actual !== capture.sha256) {
      return reject(`capture hash mismatch for ${capture.state}`);
    }
  }
  return { ok: true, reason: 'capture files match the observation' };
}

/**
 * Full gate acceptance decision for ONE observation against the current checkout.
 * Structural validation THEN an exact recomputation of the canonical input hash
 * from `repoRoot`: the observation is accepted only when its recorded hash still
 * describes the source being landed. A recompute that throws (missing root,
 * symlink) is a rejection, never a crash — the caller decides fail-open/closed.
 *
 * @param {{observation:object, repoRoot:string, fsImpl?:typeof fs}} params
 * @returns {{accepted:boolean, game:string|null, reason:string}}
 */
export function acceptObservationForGate({ observation, repoRoot, fsImpl = fs }) {
  const game = isPlainObject(observation) && typeof observation.game === 'string' ? observation.game : null;
  const structural = validateObservation(observation);
  if (!structural.ok) return { accepted: false, game, reason: structural.reason };

  let protocolStates;
  try {
    protocolStates = protocolStatesForGame({ repoRoot, game, fsImpl });
  } catch (err) {
    return { accepted: false, game, reason: `protocol binding failed: ${err.message}` };
  }
  if (!arraysEqual(observation.requiredStates, protocolStates)) {
    return {
      accepted: false,
      game,
      reason: 'requiredStates does not exactly match the ordered observation protocol contract.states',
    };
  }

  const captures = validateCaptureFiles({ observation, repoRoot, fsImpl });
  if (!captures.ok) return { accepted: false, game, reason: captures.reason };

  let recomputed;
  try {
    recomputed = hashGameInputs({ repoRoot, game, fsImpl });
  } catch (err) {
    return { accepted: false, game, reason: `input recomputation failed: ${err.message}` };
  }
  const inputs = observation.inputs;
  if (recomputed.algorithm !== inputs.algorithm) {
    return { accepted: false, game, reason: 'algorithm mismatch on recomputation' };
  }
  if (!rootsEqual(recomputed.roots, inputs.roots)) {
    return { accepted: false, game, reason: 'input roots mismatch on recomputation' };
  }
  if (recomputed.fileCount !== inputs.fileCount) {
    return { accepted: false, game, reason: `input fileCount mismatch (${recomputed.fileCount} vs ${inputs.fileCount})` };
  }
  if (recomputed.sha256 !== inputs.sha256) {
    return { accepted: false, game, reason: 'input hash mismatch — observation is stale or captured on divergent source' };
  }
  return { accepted: true, game, reason: 'live-device observation matches the current checkout source hash' };
}
