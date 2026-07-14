/**
 * Host-side consumer of the renderer-neutral shell evidence probe.
 *
 * The wire contract is owned by the producer,
 * `packages/testkit/src/harness/evidenceProbe.ts`; this parser must accept a
 * producer snapshot with zero adaptation (round-trip tested in
 * `test/evidenceProbe.test.mjs`). Device lanes read the snapshot from the
 * game's probe window key, validate it here, and only then trust its state,
 * action rectangles, revision, and readiness facts. The visual sentinel is
 * still verified independently from a host screenshot — a runtime echo can
 * never close that gate on its own.
 */

export const SHELL_EVIDENCE_PROBE_VERSION = 1;

const HASH_PATTERN = /^sha256-[a-f0-9]{64}$/;
const RENDERER_PROFILES = new Set(['dom-css', 'phaser-native']);

/** Mirrors testkit's evidenceProbeWindowKeyForGame. */
export function evidenceProbeWindowKeyForGame(gameId) {
  return `__${String(gameId).toUpperCase()}_EVIDENCE_PROBE__`;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Returns a list of problems (empty when the snapshot is valid). Fail-soft
 * shape inspection: callers decide whether problems block their lane.
 */
export function validateShellEvidenceProbeSnapshot(value) {
  const problems = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['snapshot must be an object'];
  }
  if (value.probeVersion !== SHELL_EVIDENCE_PROBE_VERSION) {
    problems.push(`probeVersion must be ${SHELL_EVIDENCE_PROBE_VERSION}`);
  }
  for (const field of ['gameId', 'contractId', 'rendererProfile', 'state']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      problems.push(`${field} must be a non-empty string`);
    }
  }
  if (typeof value.rendererProfile === 'string' && !RENDERER_PROFILES.has(value.rendererProfile)) {
    problems.push(`unknown renderer profile "${value.rendererProfile}"`);
  }
  if (value.revision !== null && (typeof value.revision !== 'string' || !HASH_PATTERN.test(value.revision))) {
    problems.push('revision must be null or a sha256 content id');
  }
  if (value.sentinel !== null && typeof value.sentinel !== 'string') {
    problems.push('sentinel must be null or a string');
  }
  if (typeof value.ready !== 'boolean') problems.push('ready must be boolean');
  const viewport = value.viewport;
  if (typeof viewport !== 'object' || viewport === null) {
    problems.push('viewport must be an object');
  } else {
    for (const field of ['width', 'height', 'devicePixelRatio']) {
      if (!isFiniteNumber(viewport[field])) problems.push(`viewport.${field} must be finite`);
    }
  }
  if (!Array.isArray(value.actions)) {
    problems.push('actions must be an array');
    return problems;
  }
  const seenSortKeys = [];
  value.actions.forEach((action, index) => {
    const path = `actions[${index}]`;
    if (typeof action !== 'object' || action === null) {
      problems.push(`${path} must be an object`);
      return;
    }
    if (typeof action.actionId !== 'string' || action.actionId.length === 0) {
      problems.push(`${path}.actionId must be a non-empty string`);
    }
    if (action.instanceId !== null && typeof action.instanceId !== 'string') {
      problems.push(`${path}.instanceId must be null or a string`);
    }
    for (const field of ['x', 'y', 'width', 'height']) {
      if (!isFiniteNumber(action[field])) problems.push(`${path}.${field} must be finite`);
    }
    for (const field of ['visible', 'disabled']) {
      if (typeof action[field] !== 'boolean') problems.push(`${path}.${field} must be boolean`);
    }
    seenSortKeys.push(`${action.actionId ?? ''}\0${action.instanceId ?? ''}`);
  });
  const sorted = [...seenSortKeys].sort();
  if (seenSortKeys.some((key, index) => key !== sorted[index])) {
    problems.push('actions must be sorted by actionId then instanceId');
  }
  return problems;
}

/** Fail-closed parse: throws with every problem named. */
export function parseShellEvidenceProbeSnapshot(value) {
  const problems = validateShellEvidenceProbeSnapshot(value);
  if (problems.length > 0) {
    throw new TypeError(`Invalid shell evidence probe snapshot:\n- ${problems.join('\n- ')}`);
  }
  return value;
}
