// Dedup guard (fixes ledger B2). A capture set is invalid if two captures tagged
// as DIFFERENT canonical states are perceptually identical — that is exactly the
// "near-duplicate captures labeled as distinct states" failure. Hard error naming
// the colliding states, never a silent pass.

import { distance, DUP_THRESHOLD, digest } from './phash.mjs';

export class DuplicateStateError extends Error {
  constructor(a, b, dist) {
    super(
      `dedup guard: captures for states "${a.state}" and "${b.state}" (${a.lane} lane) ` +
      `are perceptually identical (distance ${dist.toFixed(1)} <= ${DUP_THRESHOLD}). ` +
      `A capture labeled as a distinct state must look distinct. ` +
      `${a.state}=${a.source} (sig ${digest(a.signature)}), ` +
      `${b.state}=${b.source} (sig ${digest(b.signature)})`
    );
    this.name = 'DuplicateStateError';
    this.a = a;
    this.b = b;
    this.distance = dist;
  }
}

/**
 * Throw DuplicateStateError if any two captures in the same lane, tagged as
 * different states, are within the perceptual dedup threshold.
 * @param {Array<{state:string, lane:string, source:string, signature:Uint8Array}>} captures
 */
export function assertNoDuplicateStates(captures) {
  for (let i = 0; i < captures.length; i++) {
    for (let j = i + 1; j < captures.length; j++) {
      const a = captures[i];
      const b = captures[j];
      if (a.lane !== b.lane) continue;
      if (a.state === b.state) continue;
      const dist = distance(a.signature, b.signature);
      if (dist <= DUP_THRESHOLD) {
        throw new DuplicateStateError(a, b, dist);
      }
    }
  }
}
