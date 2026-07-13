#!/usr/bin/env node
// Executable lane-fence gate CLI (card qWCv9tUo item 5). Verifies that a lane
// branch changed ONLY files inside its own writable fence, measured from the
// TRUSTED integration merge-base — never from freeze.baselineCommit and never
// from a caller-supplied base that could hide a divergent lane's commits.
//
//   FENCE_GATE_LANE=grapes node tools/verify-gate/fence-gate.mjs
//
// TRUSTED BASE (card qWCv9tUo conductor P0, comments 38 + 40): the base is
// ALWAYS `git merge-base HEAD <canonicalIntegrationRef>` — the synchronized
// integration point from which the lane forked. The integration branch identity
// is CONDUCTOR-OWNED in fences.json (`integration.branch`), never a free-form
// env value: FENCE_GATE_INTEGRATION_REF=HEAD would collapse the merge-base into
// HEAD and false-pass just like an explicit base=HEAD. We resolve ONLY that
// canonical local branch or its origin-tracking twin. The computed base must
// exist, be an ancestor of HEAD, and descend from the recorded functional
// baseline. An explicit FENCE_GATE_BASE is a convenience ONLY: it must resolve
// to the SAME commit as the trusted base — an arbitrary descendant, most
// dangerously HEAD itself (which empties the `base..HEAD` diff into a false
// PASS), is rejected. This closes the base==HEAD / ref==HEAD exploits where a
// divergent lane hides its out-of-fence writes.
//
// CANONICAL POLICY (round-3, comment 43): the fence policy evaluated against is
// loaded from the TRUSTED BASE COMMIT (`git show base:fences.json`), never from
// the lane's working-tree bytes. The working-tree fences.json is used ONLY to
// bootstrap a candidate integration-branch name; the policy that JUDGES the diff
// is the conductor-owned one at the base. The working tree must byte-equal that
// canonical policy (a lane may not widen `writable`, redirect `integration.branch`,
// or delete the file), a missing policy on an experiment branch is FATAL, a
// changed forbidden source is exposed with `--find-copies-harder`, and a diverged
// branch may not silently skip the fence with no lane declared.
//
// SELF-DISABLING: exits 0 with a SKIP note when there is no
// experiments/design-frontends/ experiment root (non-experiment branches such as
// main) OR when HEAD is the integration tip / an acknowledged integration card
// (see below). It is NOT self-disabling on a diverged branch with no lane — that
// is the default-invocation false-pass and now fails closed.
//
// FAIL-CLOSED: any unexpected error exits 1. Env knobs:
//   FENCE_GATE_LANE               lane id (grapes|phaser); enforces that lane's fence
//   FENCE_GATE_ALLOW_INTEGRATION  conscious conductor override: SKIP a diverged
//                                 integration card (shared-surface changes are
//                                 conductor-reviewed, not lane-fenced). Never the
//                                 default — a bare diverged no-lane run fails closed.
//   FENCE_GATE_BASE               optional override; MUST equal the trusted merge-base
//   FENCE_GATE_INTEGRATION_REF    optional; MUST name the canonical integration
//                                 branch from fences.json (or its origin twin)
//   FENCE_GATE_PROJECT_DIR        checkout to gate (default cwd)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  verifyLaneChanges,
  laneDiffRange,
  parseRawNameStatusZ,
  collectChangedPaths,
  decideNoLaneAction,
  policyMutationReason,
} from './src/fence.mjs';

export const EXPERIMENT_ROOT = 'experiments/design-frontends';
export const FENCES_FILE = 'fences.json';
export const PROTOCOL_FILE = 'protocol.json';
const COMMIT_RE = /^[0-9a-f]{7,40}$/;

/** git command runner scoped to `cwd`; returns trimmed stdout, or null on error. */
function makeRunner(cwd) {
  return (cmd) => {
    try {
      return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return null;
    }
  };
}

/**
 * git runner that returns RAW (untrimmed) stdout — required for `git diff -z`,
 * whose NUL-terminated payload must not be whitespace-trimmed. null on error.
 */
function makeRawRunner(cwd) {
  return (cmd) => {
    try {
      return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
    } catch {
      return null;
    }
  };
}

/**
 * Read the exact BYTES of a repo-relative blob at a commit (`git show sha:path`),
 * as a Buffer. Returns null when the path is absent at that commit — used to load
 * the CANONICAL fence policy from the trusted base and to byte-compare it against
 * the working tree. Scoped to `cwd`.
 */
function makeShowBytes(cwd) {
  return (sha, relPath) => {
    try {
      return execSync(`git show ${sha}:${relPath}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  };
}

/** Truthy env flag: 1/true/yes/on (case-insensitive). Anything else is false. */
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
function envTruthy(value) {
  return typeof value === 'string' && TRUTHY.has(value.trim().toLowerCase());
}

/**
 * Resolve the CONDUCTOR-OWNED canonical integration ref (card qWCv9tUo comment
 * 40). The branch identity lives in fences.json (`integration.branch`, optional
 * `integration.remote`), never in a free-form env var — a caller-supplied ref
 * of HEAD would collapse the merge-base into HEAD and defeat the fence. We
 * resolve ONLY the canonical local branch or its origin-tracking twin. When an
 * override is supplied it must name that exact canonical branch (bare,
 * `refs/heads/…`, `<remote>/…`, or `refs/remotes/<remote>/…` form); anything
 * else — most dangerously HEAD — is rejected before any git resolution.
 *
 * `run` returns trimmed stdout on a zero-exit git command and null on non-zero.
 * @returns {{ok:boolean, ref?:string, sha?:string, error?:string}}
 */
export function resolveIntegrationRef(run, { canonicalBranch, remote = 'origin', overrideRef }) {
  if (!canonicalBranch || typeof canonicalBranch !== 'string') {
    return {
      ok: false,
      error: 'fences.json has no conductor-owned integration.branch; cannot resolve the integration ref',
    };
  }
  const localRef = `refs/heads/${canonicalBranch}`;
  const remoteRef = `refs/remotes/${remote}/${canonicalBranch}`;
  if (overrideRef !== undefined && overrideRef !== null && overrideRef !== '') {
    const allowed = new Set([canonicalBranch, localRef, `${remote}/${canonicalBranch}`, remoteRef]);
    if (!allowed.has(overrideRef)) {
      return {
        ok: false,
        error:
          `integration-ref override ${JSON.stringify(overrideRef)} is not the conductor-owned `
          + `integration branch "${canonicalBranch}" (or its ${remote} twin); refusing to trust it`,
      };
    }
  }
  // Resolve the canonical local branch first, then its origin-tracking twin.
  const localSha = run(`git rev-parse --verify --quiet ${localRef}^{commit}`);
  if (localSha && COMMIT_RE.test(localSha)) return { ok: true, ref: localRef, sha: localSha };
  const remoteSha = run(`git rev-parse --verify --quiet ${remoteRef}^{commit}`);
  if (remoteSha && COMMIT_RE.test(remoteSha)) return { ok: true, ref: remoteRef, sha: remoteSha };
  return {
    ok: false,
    error: `canonical integration branch "${canonicalBranch}" is not present as ${localRef} or ${remoteRef}`,
  };
}

/**
 * Resolve the lane base as the TRUSTED integration merge-base and validate it.
 *
 * The base is ALWAYS `git merge-base HEAD <integrationRef>` — the synchronized
 * integration point from which the lane forked. It must exist, be an ancestor of
 * HEAD (a merge-base always is; asserted fail-closed), and descend from (or
 * equal) the recorded functional baseline so inherited integration/seal commits
 * are excluded from the `base..HEAD` range.
 *
 * An explicit FENCE_GATE_BASE is a convenience ONLY: it must resolve to the SAME
 * commit as the trusted base. An arbitrary descendant of the functional baseline
 * — most dangerously HEAD itself, which would empty the diff into a false PASS —
 * is rejected. This is the base==HEAD exploit the acceptance matrix forbids.
 *
 * `run` returns trimmed stdout on a zero-exit git command and null on non-zero.
 * @returns {{ok:boolean, base?:string, integrationRef?:string, error?:string}}
 */
export function resolveLaneBase(run, { explicitBase, integrationRef, functionalBaseline }) {
  if (!integrationRef) {
    return { ok: false, error: 'no integration ref configured; cannot compute the trusted lane base' };
  }
  // 1. The trusted base is the merge-base of HEAD and the integration ref.
  const trustedBase = run(`git merge-base HEAD ${integrationRef}`);
  if (!trustedBase) {
    return { ok: false, error: `cannot compute merge-base HEAD..${integrationRef} (is ${integrationRef} fetched?)` };
  }
  if (!COMMIT_RE.test(trustedBase)) {
    return { ok: false, error: `trusted lane base is not a commit SHA: ${trustedBase}` };
  }
  // 2. It must be a present commit object.
  const present = run(`git cat-file -e ${trustedBase}^{commit}`) !== null;
  if (!present) {
    return { ok: false, error: `trusted lane base ${trustedBase} is not present in the repository` };
  }
  // 3. It must be an ancestor of HEAD (a merge-base always is — assert anyway).
  const ancestorOfHead = run(`git merge-base --is-ancestor ${trustedBase} HEAD`) !== null;
  if (!ancestorOfHead) {
    return { ok: false, error: `trusted lane base ${trustedBase} is not an ancestor of HEAD` };
  }
  // 4. It must descend from (or equal) the recorded functional baseline so the
  //    inherited integration/seal commits before the fork are excluded.
  if (functionalBaseline) {
    const descends = run(`git merge-base --is-ancestor ${functionalBaseline} ${trustedBase}`) !== null;
    if (!descends) {
      return {
        ok: false,
        error: `trusted lane base ${trustedBase} does not descend from the functional baseline ${functionalBaseline}`,
      };
    }
  }
  // 5. An explicit base is a convenience, not an escape hatch: it must resolve to
  //    the SAME commit as the trusted base. Rejects base==HEAD on a divergent
  //    lane (the forbidden false-pass) and any stale/unrelated override, in any
  //    abbreviation or ref form.
  if (explicitBase !== undefined && explicitBase !== null && explicitBase !== '') {
    const resolvedExplicit = run(`git rev-parse --verify --quiet ${explicitBase}^{commit}`);
    if (!resolvedExplicit) {
      return { ok: false, error: `explicit lane base ${explicitBase} is not a resolvable commit` };
    }
    if (resolvedExplicit !== trustedBase) {
      return {
        ok: false,
        error: `explicit lane base ${explicitBase} (${resolvedExplicit}) is not the trusted integration merge-base ${trustedBase}`,
      };
    }
  }
  return { ok: true, base: trustedBase, integrationRef };
}

const FENCES_REL = `${EXPERIMENT_ROOT}/${FENCES_FILE}`;

function fail(msg) {
  process.stderr.write(`fence-gate: FAIL — ${msg}\n`);
  return 1;
}

function main() {
  const projectDir = process.env.FENCE_GATE_PROJECT_DIR || process.cwd();
  const root = path.join(projectDir, EXPERIMENT_ROOT);
  const fencesPath = path.join(root, FENCES_FILE);

  // A missing experiment ROOT means this is not an experiment branch (main,
  // etc.) — the historical self-disable. But once the experiment root exists, a
  // MISSING policy file is tampering, not "nothing to check": a lane cannot
  // delete fences.json to make the gate skip (comment 43 exploit 3).
  if (!fs.existsSync(root)) {
    process.stdout.write(`fence-gate: SKIP — no ${EXPERIMENT_ROOT}/ experiment root (not a lane branch)\n`);
    return 0;
  }
  if (!fs.existsSync(fencesPath)) {
    return fail(`experiment root exists but ${FENCES_REL} is missing (deleted?) — cannot verify the fence`);
  }

  const laneId = process.env.FENCE_GATE_LANE;
  const allowIntegration = envTruthy(process.env.FENCE_GATE_ALLOW_INTEGRATION);

  // Bootstrap ONLY the candidate integration-branch name from the working tree.
  // The policy that JUDGES the diff is loaded from the trusted base commit below.
  const workingFencesBytes = fs.readFileSync(fencesPath);
  let workingFences;
  try {
    workingFences = JSON.parse(workingFencesBytes.toString('utf8'));
  } catch (err) {
    return fail(`${FENCES_REL} is not valid JSON: ${err && err.message}`);
  }
  const integration =
    workingFences.integration && typeof workingFences.integration === 'object' ? workingFences.integration : null;
  if (!integration || !integration.branch) {
    return fail(`${FENCES_REL} has no conductor-owned integration.branch; cannot compute the trusted lane base`);
  }

  const run = makeRunner(projectDir);
  const runRaw = makeRawRunner(projectDir);
  const showBytes = makeShowBytes(projectDir);

  const headSha = run('git rev-parse HEAD');
  if (!headSha || !COMMIT_RE.test(headSha)) {
    return fail('cannot resolve HEAD to a commit SHA');
  }

  // 1. Resolve the conductor-owned canonical integration ref (fences.json).
  const refResolved = resolveIntegrationRef(run, {
    canonicalBranch: integration.branch,
    remote: integration.remote || 'origin',
    overrideRef: process.env.FENCE_GATE_INTEGRATION_REF,
  });
  if (!refResolved.ok) return fail(refResolved.error);

  // 2. The trusted base is the merge-base of HEAD and that canonical ref. It is
  //    computed directly here so the no-lane decision — which evaluates NO diff —
  //    does not depend on the lane-mode base validations below. (The U1
  //    integration card's own base is the OLD integration tip, which necessarily
  //    predates the functional baseline it introduces, so the descends-from check
  //    is a lane-only concern.)
  const base = run(`git merge-base HEAD ${refResolved.sha}`);
  if (!base || !COMMIT_RE.test(base)) {
    process.stderr.write(
      `fence-gate: FAIL — cannot compute merge-base HEAD..${refResolved.ref} (is it fetched?)\n`,
    );
    process.stderr.write(`  integration-ref=${refResolved.ref} (${refResolved.sha})\n`);
    return 1;
  }
  const diverged = base !== headSha;

  // 3. No-lane handling. The integration tip (not diverged) skips; a diverged
  //    branch must EXPLICITLY declare a lane or a conductor integration card —
  //    a silent no-lane skip on a diverged branch is the default-invocation
  //    false-pass (comment 43) and fails closed.
  if (!laneId) {
    const decision = decideNoLaneAction({ diverged, allowIntegration });
    process.stdout.write(
      `fence-gate: integration-ref=${refResolved.ref} (${refResolved.sha}) trusted-base=${base} `
      + `diverged=${diverged}\n`,
    );
    if (decision.skip) {
      process.stdout.write(`fence-gate: SKIP — ${decision.reason}\n`);
      return 0;
    }
    return fail(decision.reason);
  }

  // 4. Lane mode. Validate the trusted base strictly: it must descend from the
  //    recorded functional baseline (so inherited integration/seal commits are
  //    excluded), and any explicit FENCE_GATE_BASE override must equal the trusted
  //    merge-base (no base==HEAD widening). The functional baseline is read from
  //    the working-tree protocol.json (a shared surface — a lane edit to it is
  //    caught by the fence eval below).
  const protocolPath = path.join(root, PROTOCOL_FILE);
  const functionalBaseline = fs.existsSync(protocolPath)
    ? (JSON.parse(fs.readFileSync(protocolPath, 'utf8')).freeze || {}).baselineCommit
    : undefined;
  const resolved = resolveLaneBase(run, {
    explicitBase: process.env.FENCE_GATE_BASE,
    integrationRef: refResolved.sha,
    functionalBaseline,
  });
  if (!resolved.ok) {
    process.stderr.write(`fence-gate: FAIL — ${resolved.error}\n`);
    process.stderr.write(`  integration-ref=${refResolved.ref} (${refResolved.sha})\n`);
    return 1;
  }
  if (resolved.base !== base) {
    return fail(`internal: lane base ${resolved.base} disagrees with the merge-base ${base}`);
  }

  // The trusted base must be a PROPER ancestor of HEAD: if the integration ref
  // resolved to HEAD (e.g. integration.branch rewritten to the lane's own branch)
  // the merge-base collapses to HEAD and the diff is empty — the base==HEAD
  // false-pass (comment 43 exploit 1). Refuse it.
  if (!diverged) {
    return fail(
      `trusted base collapsed to HEAD (integration ref ${refResolved.ref} resolves to the lane HEAD) — `
      + 'refusing the base==HEAD false-pass',
    );
  }

  // 5. Load the CANONICAL policy from the trusted base commit — NEVER the lane's
  //    working-tree bytes. A missing/invalid policy at the base is fatal.
  const canonicalBytes = showBytes(base, FENCES_REL);
  if (canonicalBytes === null) {
    return fail(`cannot read the canonical ${FENCES_REL} at the trusted base ${base}`);
  }
  let canonicalFences;
  try {
    canonicalFences = JSON.parse(canonicalBytes.toString('utf8'));
  } catch (err) {
    return fail(`canonical ${FENCES_REL} at base ${base} is not valid JSON: ${err && err.message}`);
  }
  if (!canonicalFences.lanes || !canonicalFences.lanes[laneId]) {
    return fail(`unknown lane "${laneId}" (not in the canonical policy at base ${base})`);
  }

  // 6. Reject policy mutation: the working-tree fences.json must byte-equal the
  //    canonical policy at the base (comment 43 exploits 1+2). A lane cannot
  //    widen its own `writable` or redirect `integration.branch`.
  const mutation = policyMutationReason({
    bytesEqual: Buffer.compare(workingFencesBytes, canonicalBytes) === 0,
    workingBranch: integration.branch,
    canonicalBranch: canonicalFences.integration && canonicalFences.integration.branch,
  });
  if (mutation) return fail(mutation);

  // Ledger the integration ref + trusted base so the measurement is auditable and
  // the base can never be silently widened (e.g. to HEAD) to hide lane writes.
  process.stdout.write(
    `fence-gate: integration-ref=${refResolved.ref} (${refResolved.sha}) trusted-base=${base}\n`,
  );

  // 7. Read the changed paths NUL-safely with file modes so weird filenames
  //    cannot split/hide a record and changed symlinks are detectable.
  //    `--find-copies-harder` exposes a pure copy from an UNCHANGED forbidden
  //    source (comment 43 exploit 4) that plain `-C` reports as a bare add.
  const range = laneDiffRange(base);
  const rawZ = runRaw(`git diff --raw -z -M -C --find-copies-harder ${range}`);
  if (rawZ === null) {
    return fail(`cannot diff ${range}`);
  }
  let changedPaths;
  let symlinkPaths;
  try {
    ({ changedPaths, symlinkPaths } = collectChangedPaths(parseRawNameStatusZ(rawZ)));
  } catch (err) {
    return fail(`cannot parse the ${range} diff: ${err && err.message}`);
  }

  process.stdout.write(
    `fence-gate: lane=${laneId} base=${base} range=${range} `
    + `changed=${changedPaths.length} symlinks=${symlinkPaths.length}\n`,
  );

  // Judge the diff against the CANONICAL policy (from the base), not the working tree.
  const result = verifyLaneChanges({ laneId, changedPaths, symlinkPaths, fences: canonicalFences });
  if (result.ok) {
    process.stdout.write(`fence-gate: PASS — all ${changedPaths.length} change(s) inside lane "${laneId}"\n`);
    return 0;
  }
  process.stderr.write(`fence-gate: FAIL — lane "${laneId}" wrote outside its fence:\n`);
  for (const v of result.violations) process.stderr.write(`  - ${v.kind}: ${v.path}\n`);
  return 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exit(main());
  } catch (err) {
    process.stderr.write(`fence-gate: ERROR — ${err && err.message}\n`);
    process.exit(1);
  }
}
