import fs from 'node:fs';
import { decodePng } from '../../refcap-compare/src/png.mjs';
import {
  distance,
  digest,
  DUP_THRESHOLD,
  signature,
} from '../../refcap-compare/src/phash.mjs';

/**
 * Compare raw state captures against each other and flag different canonical
 * states that produce near-identical perceptual signatures.
 *
 * @param {object} params
 * @param {Record<string,string>} params.captures state -> raw PNG path
 * @param {object} [params.manifest] loaded game manifest
 * @param {number} [params.threshold]
 * @returns {{threshold:number, pairs:Array, blockingPairs:Array, allowedPairs:Array}}
 */
export function detectIndistinguishableStates({
  captures,
  manifest = {},
  threshold = DUP_THRESHOLD,
} = {}) {
  const allow = resolveIndistinguishableStateAllowList(manifest);
  const entries = Object.entries(captures || {})
    .filter(([state, source]) => typeof state === 'string' && source && fs.existsSync(source))
    .map(([state, source]) => {
      const sig = signature(decodePng(fs.readFileSync(source)));
      return { state, source, signature: sig, digest: digest(sig) };
    });

  const pairs = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.state === b.state) continue;
      const dist = distance(a.signature, b.signature);
      if (dist > threshold) continue;
      const allowed = allow.get(statePairKey(a.state, b.state)) || null;
      pairs.push({
        stateA: a.state,
        stateB: b.state,
        states: [a.state, b.state],
        distance: dist,
        threshold,
        digestA: a.digest,
        digestB: b.digest,
        sourceA: a.source,
        sourceB: b.source,
        allowed: Boolean(allowed),
        reason: allowed?.reason || null,
      });
    }
  }

  return {
    threshold,
    pairs,
    blockingPairs: pairs.filter((pair) => !pair.allowed),
    allowedPairs: pairs.filter((pair) => pair.allowed),
  };
}

export function resolveIndistinguishableStateAllowList(manifest = {}) {
  const raw = manifest.verifyDevice?.indistinguishableStates?.allow
    ?? manifest.verifyDevice?.allowIndistinguishableStates
    ?? [];
  const entries = Array.isArray(raw) ? raw : [raw];
  const allow = new Map();
  for (const entry of entries) {
    if (entry == null || entry === false) continue;
    const states = normalizeAllowedStates(entry);
    if (states.length !== 2) {
      throw new Error('verifyDevice.indistinguishableStates.allow entries must name exactly two states');
    }
    const reason = typeof entry === 'object' && !Array.isArray(entry) && typeof entry.reason === 'string'
      ? entry.reason.trim()
      : '';
    allow.set(statePairKey(states[0], states[1]), { states, reason: reason || null });
  }
  return allow;
}

export function formatIndistinguishableStateWarnings(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  if (list.length === 0) return '';
  return [
    `  INDISTINGUISHABLE STATES: ${list.length} near-identical different-state capture pair(s)`,
    ...list.map((pair) =>
      `    ${pair.stateA} == ${pair.stateB} `
      + `(distance ${pair.distance.toFixed(1)} <= ${pair.threshold}; `
      + `sigs ${pair.digestA}/${pair.digestB})`),
  ].join('\n') + '\n';
}

export function formatAllowedIndistinguishableStates(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  if (list.length === 0) return '';
  return [
    `  indistinguishable states allowed by manifest: ${list.length} pair(s)`,
    ...list.map((pair) =>
      `    ${pair.stateA} == ${pair.stateB}`
      + `${pair.reason ? ` - ${pair.reason}` : ''}`),
  ].join('\n') + '\n';
}

export function statePairKey(a, b) {
  return [String(a), String(b)].sort().join('\0');
}

function normalizeAllowedStates(entry) {
  if (Array.isArray(entry)) return entry.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof entry === 'string') return entry.split(',').map((s) => s.trim()).filter(Boolean);
  if (entry && typeof entry === 'object') {
    if (Array.isArray(entry.states)) return entry.states.map(String).map((s) => s.trim()).filter(Boolean);
    if (Array.isArray(entry.pair)) return entry.pair.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof entry.states === 'string') return entry.states.split(',').map((s) => s.trim()).filter(Boolean);
    if (typeof entry.pair === 'string') return entry.pair.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
