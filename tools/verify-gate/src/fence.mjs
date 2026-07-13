// Executable lane-fence logic (card qWCv9tUo items 5 + round-3 hardening). The
// dual-design-frontends experiment forks into two lanes (grapes, phaser). After
// the fork each lane may write ONLY inside its own `writable` fence in
// experiments/design-frontends/fences.json; a shared surface, a non-target, or
// the OTHER lane's files are off-limits and must fail closed.
//
// Lane ownership is measured from the TRUSTED LANE BASE — the merge-base of the
// lane HEAD and the conductor-owned canonical integration ref — NOT from
// freeze.baselineCommit. The seal commit necessarily follows the functional
// baseline, so a baselineCommit..HEAD diff would misattribute the seal/protocol
// bytes to every lane. The base is computed by the CLI, printed/ledgered, and
// must descend from the recorded functional baseline; the inherited
// integration/seal commits before it are ignored as starting state because the
// diff range is base-exclusive (`base..HEAD`).
//
// CANONICAL POLICY (round-3, comment 43): the fence policy the CLI evaluates
// against is loaded from the trusted BASE COMMIT (`git show base:fences.json`),
// NEVER from the lane's working-tree bytes. A lane cannot widen its own writable
// set, redirect the integration branch, or delete the policy to escape the
// fence: the working-tree policy must byte-equal the canonical one at the base
// (see `policyMutationReason`), and a diverged branch may not silently skip the
// fence with no lane declared (see `decideNoLaneAction`).
//
// The changed-path set is read from `git diff --raw -z -M -C --find-copies-harder`
// (NUL-terminated name-status + file modes), so a weird filename (embedded
// newline, quote, or space) cannot split a record or hide a write. For a
// rename/copy BOTH the source and destination paths are evaluated, so escaping a
// fence by renaming/copying a forbidden file to an allowed name (or vice versa)
// still fails — `--find-copies-harder` exposes a pure copy from an UNCHANGED
// forbidden source that plain `-C` would report as a bare add. A changed tracked
// symlink (git mode 120000) is rejected even when its path is inside the writable
// glob — a symlink can point anywhere and is not an in-fence edit.
//
// This module is PURE: git IO lives in the caller (fence-gate.mjs) so every
// rejection path is unit-testable without spawning git.

/** Git's tree mode for a symbolic link; a changed one is always rejected. */
export const GIT_SYMLINK_MODE = '120000';

/**
 * Translate a fences.json glob to an anchored RegExp. Supports `**` (any depth,
 * crosses `/`), `*` (one path segment), and literal segments. A pattern with no
 * wildcard matches its path exactly.
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**` crosses any character INCLUDING `/` and newlines (`.` would not
        // match a newline, letting a newline-named path dodge its fence glob).
        re += '[\\s\\S]*';
        i += 1;
      } else {
        re += '[^/]*';
      }
    } else if ('.+^${}()|[]\\/'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** True when `path` matches any glob in `patterns`. */
export function matchesAny(path, patterns) {
  return (patterns || []).some((pattern) => globToRegExp(pattern).test(path));
}

/**
 * Classify one changed path for a lane. A path is ALLOWED only when it matches
 * the lane's own `writable` set. Otherwise it is a violation, tagged by what it
 * DID match so the failure message is actionable.
 * @returns {{path:string, kind:string, allowed:boolean}}
 */
export function classifyChange(path, laneId, fences) {
  const lane = fences && fences.lanes && fences.lanes[laneId];
  if (!lane) return { path, kind: 'unknown-lane', allowed: false };
  if (matchesAny(path, lane.writable)) return { path, kind: 'writable', allowed: true };
  if (matchesAny(path, lane.forbidden)) return { path, kind: 'forbidden', allowed: false };
  if (matchesAny(path, fences.nonTargets && fences.nonTargets.paths)) {
    return { path, kind: 'non-target', allowed: false };
  }
  if (matchesAny(path, fences.sharedSurfaces && fences.sharedSurfaces.paths)) {
    return { path, kind: 'shared-surface', allowed: false };
  }
  for (const [otherId, other] of Object.entries(fences.lanes)) {
    if (otherId === laneId) continue;
    if (matchesAny(path, other.writable)) return { path, kind: 'cross-lane', allowed: false };
  }
  return { path, kind: 'out-of-fence', allowed: false };
}

/**
 * Verify a lane's changed paths against its fence. Pure orchestration.
 * @param {object} args
 * @param {string} args.laneId
 * @param {string[]} args.changedPaths  paths from the base-exclusive `base..HEAD`
 *   diff (inherited integration/seal commits are already excluded upstream); for
 *   a rename/copy this includes BOTH the source and destination path
 * @param {string[]} [args.symlinkPaths]  changed paths whose src or dst git mode
 *   is a symlink (120000); each is rejected even if it also matches a writable
 *   glob — a symlink is never a legal in-fence edit
 * @param {object} args.fences  parsed fences.json
 * @returns {{ok:boolean, violations:Array<{path:string,kind:string,allowed:boolean}>}}
 */
export function verifyLaneChanges({ laneId, changedPaths, symlinkPaths = [], fences }) {
  const violations = [];
  const symlinks = new Set(symlinkPaths);
  for (const path of changedPaths) {
    if (symlinks.has(path)) {
      // A changed tracked symlink is rejected outright, before any writable
      // allowance — the writable glob only sanctions ordinary in-fence files.
      violations.push({ path, kind: 'symlink', allowed: false });
      continue;
    }
    const change = classifyChange(path, laneId, fences);
    if (!change.allowed) violations.push(change);
  }
  return { ok: violations.length === 0, violations };
}

/** The base-exclusive diff range a lane is measured over. */
export function laneDiffRange(base) {
  return `${base}..HEAD`;
}

/**
 * Parse `git diff --raw -z` output into structured records. The `-z` form is
 * NUL-terminated with pathnames emitted verbatim, so bytes that would break a
 * line-oriented parser (newlines, quotes, spaces) cannot split or hide a record.
 *
 * Each raw record is `:<srcMode> <dstMode> <srcSha> <dstSha> <status>` followed
 * by a NUL, then one path (add/modify/delete/type-change) or — for a rename (R)
 * or copy (C) — two paths (source then destination), each NUL-terminated.
 *
 * @param {string} z  raw `git diff --raw -z <range>` stdout
 * @returns {Array<{status:string, srcMode:string, dstMode:string, paths:string[]}>}
 * @throws if a record is malformed — a diff we cannot fully parse must never
 *   silently pass the fence.
 */
export function parseRawNameStatusZ(z) {
  const tokens = typeof z === 'string' ? z.split('\0') : [];
  const records = [];
  let i = 0;
  while (i < tokens.length) {
    const meta = tokens[i];
    if (meta === '') {
      i += 1; // the trailing NUL leaves an empty final token
      continue;
    }
    if (meta[0] !== ':') {
      throw new Error(`unexpected git raw record (no ':' metainfo): ${JSON.stringify(meta)}`);
    }
    const fields = meta.slice(1).split(' ');
    if (fields.length < 5) {
      throw new Error(`malformed git raw metainfo: ${JSON.stringify(meta)}`);
    }
    const srcMode = fields[0];
    const dstMode = fields[1];
    const status = fields[4];
    const twoPaths = status[0] === 'R' || status[0] === 'C';
    const srcPath = tokens[i + 1];
    if (srcPath === undefined) {
      throw new Error(`git raw record is missing its path for status ${status}`);
    }
    const paths = [srcPath];
    if (twoPaths) {
      const dstPath = tokens[i + 2];
      if (dstPath === undefined) {
        throw new Error(`git raw record is missing its destination path for status ${status}`);
      }
      paths.push(dstPath);
    }
    records.push({ status, srcMode, dstMode, paths });
    i += twoPaths ? 3 : 2;
  }
  return records;
}

/**
 * Decide the action when NO lane is declared (round-3, comment 43 default
 * invocation). The integration branch's own gate run — HEAD not diverged from
 * the trusted integration tip (base == HEAD) — legitimately SKIPs because the
 * integration branch owns no lane. A DIVERGED branch, however, must EXPLICITLY
 * declare its intent: a lane (FENCE_GATE_LANE) so the fence is enforced, or a
 * conscious conductor integration-card acknowledgement
 * (FENCE_GATE_ALLOW_INTEGRATION) whose shared-surface changes are conductor
 * -reviewed rather than lane-fenced. A silent no-lane skip on a diverged branch
 * is the default-invocation false-pass and is refused.
 * @param {{diverged:boolean, allowIntegration:boolean}} args
 * @returns {{skip:boolean, reason:string}}
 */
export function decideNoLaneAction({ diverged, allowIntegration }) {
  if (!diverged) {
    return { skip: true, reason: 'integration tip (base == HEAD); the integration branch owns no lane fence' };
  }
  if (allowIntegration) {
    return {
      skip: true,
      reason:
        'diverged integration card acknowledged via FENCE_GATE_ALLOW_INTEGRATION; '
        + 'shared-surface changes are conductor-reviewed, not lane-fenced',
    };
  }
  return {
    skip: false,
    reason:
      'diverged branch with no FENCE_GATE_LANE — refusing to silently skip the fence. '
      + 'Set FENCE_GATE_LANE=<lane> for lane work, or FENCE_GATE_ALLOW_INTEGRATION=1 for a conductor integration card',
  };
}

/**
 * Report why a lane's working-tree fence policy is a MUTATION of the canonical
 * conductor-owned policy loaded from the trusted base commit, or null when the
 * policy is untouched (round-3, comment 43 "reject policy mutation before using
 * it"). The policy is not lane-writable: a lane may not change fences.json
 * between the base and its HEAD, so widening `writable`, redirecting
 * `integration.branch`, or otherwise editing the bytes is rejected before the
 * policy is trusted.
 * @param {object} args
 * @param {boolean} args.bytesEqual  exact-byte equality of the working-tree and
 *   canonical (base-commit) fences.json blobs
 * @param {string} [args.workingBranch]   integration.branch declared in the working tree
 * @param {string} [args.canonicalBranch] integration.branch declared by the canonical policy
 * @returns {string|null}
 */
export function policyMutationReason({ bytesEqual, workingBranch, canonicalBranch }) {
  if (!bytesEqual) {
    return 'working-tree fences.json differs from the conductor-owned canonical policy at the trusted '
      + 'base — the fence policy is not lane-writable';
  }
  if (workingBranch !== canonicalBranch) {
    return `integration.branch was redirected: working tree names ${JSON.stringify(workingBranch)} but the `
      + `canonical policy names ${JSON.stringify(canonicalBranch)}`;
  }
  return null;
}

/**
 * Flatten parsed raw records into the fence inputs: every touched tracked path
 * (both source and destination for renames/copies, the deleted path for a
 * delete) and the subset of those paths that are symlinks (either side is git
 * mode 120000). Paths are de-duplicated but order-stable.
 * @param {Array<{status:string, srcMode:string, dstMode:string, paths:string[]}>} records
 * @returns {{changedPaths:string[], symlinkPaths:string[]}}
 */
export function collectChangedPaths(records) {
  const changedPaths = [];
  const seen = new Set();
  const symlinks = new Set();
  for (const record of records) {
    const isSymlink =
      record.srcMode === GIT_SYMLINK_MODE || record.dstMode === GIT_SYMLINK_MODE;
    for (const p of record.paths) {
      if (!p) continue;
      if (!seen.has(p)) {
        seen.add(p);
        changedPaths.push(p);
      }
      if (isSymlink) symlinks.add(p);
    }
  }
  return { changedPaths, symlinkPaths: [...symlinks] };
}
