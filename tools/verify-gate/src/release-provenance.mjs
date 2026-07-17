// Release provenance gate (2026-07 purchase audit, work item 5b).
//
// The shipped FTD 1.0.2 bundle contained code reachable from NO commit — a
// store build was cut from a dirty, unpushed worktree and became untraceable.
// This gate fails any store/release build whose provenance is not durable:
//   1. the working tree must be clean (no uncommitted/untracked changes), and
//   2. HEAD must be an ancestor of at least one remote branch (pushed).
//
// FAIL-CLOSED: any unexpected git error is a failure — a release gate must
// never wave a build through on error.

/** @typedef {{ ok: boolean, failures: string[], sha: string | null }} ProvenanceResult */

/**
 * @param {(cmd: string) => { ok: boolean, stdout: string }} run
 *   Runner executing a git command in the repo, returning trimmed stdout.
 * @returns {ProvenanceResult}
 */
export function checkReleaseProvenance(run) {
  const failures = [];

  const head = run('git rev-parse HEAD');
  if (!head.ok || head.stdout === '') {
    return { ok: false, failures: ['not a git checkout (git rev-parse HEAD failed)'], sha: null };
  }
  const sha = head.stdout;

  const status = run('git status --porcelain');
  if (!status.ok) {
    failures.push('git status failed');
  } else if (status.stdout !== '') {
    failures.push(`working tree is dirty (${status.stdout.split('\n').length} path(s)) — commit or stash before a release build`);
  }

  const remoteBranches = run(`git branch -r --contains ${sha}`);
  if (!remoteBranches.ok) {
    failures.push('git branch -r --contains failed');
  } else if (remoteBranches.stdout === '') {
    failures.push(`HEAD ${sha.slice(0, 10)} is not pushed to any remote branch — push before a release build`);
  }

  return { ok: failures.length === 0, failures, sha };
}
