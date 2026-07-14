// Filesystem plumbing for live-device OBSERVATION evidence (card qWCv9tUo), the
// sibling of evidence.mjs's panel plumbing. It reads every observation.json under
// the project and returns, per artifact, the gate acceptance decision computed
// against the CURRENT checkout.
//
// The schema, the canonical input hash, and the accept rules all live in the
// producer module (tools/verify-device/src/observation.mjs) and are imported here
// — this file adds ONLY the glob + read + fail-soft wrapping, so the gate never
// duplicates schema or hash logic. A corrupt or stale artifact becomes a rejected
// record, never a throw: one bad observation must not hide a good one and must
// never satisfy the gate.
import fs from 'node:fs';
import path from 'node:path';
import { parseObservation, acceptObservationForGate } from '../../verify-device/src/observation.mjs';

/** Observation-artifact globs — mirror evidence.PANEL_GLOBS so both evidence
 *  kinds are discovered in the same evidence dirs. */
export const OBSERVATION_GLOBS = [
  'docs/evidence/*device-verify*/observation.json',
  'games/*/evidence/**/observation.json',
];

function observationPaths(projectDir, fsImpl = fs) {
  const paths = [];
  for (const pattern of OBSERVATION_GLOBS) {
    let matches = [];
    try {
      matches = fsImpl.globSync(pattern, { cwd: projectDir });
    } catch {
      matches = [];
    }
    paths.push(...matches);
  }
  return [...new Set(paths)].sort();
}

/**
 * Read + accept every observation.json under `projectDir`. Each record carries
 * the acceptance decision (structural validation + exact input-hash recomputation
 * against the checkout) from the producer module.
 *
 * @returns {Array<{path:string, accepted:boolean, game:string|null, reason:string}>}
 */
export function readObservationEvidence(projectDir, fsImpl = fs) {
  return observationPaths(projectDir, fsImpl).map((rel) => {
    const abs = path.join(projectDir, rel);
    let raw;
    try {
      raw = fsImpl.readFileSync(abs, 'utf8');
    } catch (err) {
      return { path: rel, accepted: false, game: null, reason: `cannot read observation: ${err.message}` };
    }
    let observation;
    try {
      observation = parseObservation(raw);
    } catch (err) {
      return { path: rel, accepted: false, game: null, reason: `observation is not valid JSON: ${err.message}` };
    }
    const decision = acceptObservationForGate({ observation, repoRoot: projectDir, fsImpl });
    return { path: rel, accepted: decision.accepted, game: decision.game, reason: decision.reason };
  });
}
