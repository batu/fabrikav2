// Git diff plumbing for the gate: the set of files changed vs the merge-base
// with origin/main (per the card). Falls back gracefully — origin/main may not
// be fetched in a fresh worktree, so we try origin/main, then main, then plain
// `git diff HEAD` (uncommitted only). `run` is injected so it is testable and
// always scoped to the project dir.

/**
 * @param {(cmd:string)=>{ok:boolean, stdout:string}} run command runner
 * @returns {{ok:true, ref:string}|{ok:false, error:string}} the resolved base ref
 */
export function resolveBaseRef(run) {
  for (const ref of ['origin/main', 'main']) {
    if (run(`git rev-parse --verify --quiet ${ref}`).ok) return { ok: true, ref };
  }
  return {
    ok: false,
    error: 'could not resolve origin/main or main; refusing to infer a diff base',
  };
}

function lines(res) {
  return res.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Files changed between the merge-base with origin/main (or main) and the
 * working tree — includes committed, staged, and unstaged changes, PLUS
 * untracked files (a brand-new visual file is exactly the kind of change a
 * done-claim covers, and `git diff` alone omits untracked files).
 * @param {(cmd:string)=>{ok:boolean, stdout:string}} run
 * @returns {{ok:true, files:string[]}|{ok:false, error:string}}
 */
export function changedFilesVsMain(run) {
  const base = resolveBaseRef(run);
  if (!base.ok) return base;

  const mb = run(`git merge-base ${base.ref} HEAD`);
  if (!mb.ok || !mb.stdout.trim()) {
    return {
      ok: false,
      error: `could not resolve merge-base between ${base.ref} and HEAD`,
    };
  }
  const point = mb.stdout.trim();

  const diff = run(`git diff --name-only ${point}`);
  if (!diff.ok) {
    return {
      ok: false,
      error: `git diff --name-only ${point} failed`,
    };
  }
  // `git diff --name-only <point>` = <point>-tree vs working tree (tracked).
  const tracked = lines(diff);
  // Untracked, non-ignored files (new game/ui files not yet added).
  const ls = run('git ls-files --others --exclude-standard');
  if (!ls.ok) {
    return {
      ok: false,
      error: 'git ls-files --others --exclude-standard failed',
    };
  }
  const untracked = lines(ls);
  return { ok: true, files: [...new Set([...tracked, ...untracked])] };
}
