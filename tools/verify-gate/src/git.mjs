// Git diff plumbing for the gate: the set of files changed vs the merge-base
// with origin/main (per the card). Falls back gracefully — origin/main may not
// be fetched in a fresh worktree, so we try origin/main, then main, then plain
// `git diff HEAD` (uncommitted only). `run` is injected so it is testable and
// always scoped to the project dir.

/**
 * @param {(cmd:string)=>{ok:boolean, stdout:string}} run command runner
 * @returns {string|null} the base ref that resolves, or null
 */
export function resolveBaseRef(run) {
  for (const ref of ['origin/main', 'main']) {
    if (run(`git rev-parse --verify --quiet ${ref}`).ok) return ref;
  }
  return null;
}

function lines(res) {
  if (!res.ok) return [];
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
 * @returns {string[]}
 */
export function changedFilesVsMain(run) {
  const base = resolveBaseRef(run);
  let point = 'HEAD';
  if (base) {
    const mb = run(`git merge-base ${base} HEAD`);
    point = mb.ok && mb.stdout.trim() ? mb.stdout.trim() : base;
  }
  // `git diff --name-only <point>` = <point>-tree vs working tree (tracked).
  const tracked = lines(run(`git diff --name-only ${point}`));
  // Untracked, non-ignored files (new game/ui files not yet added).
  const untracked = lines(run('git ls-files --others --exclude-standard'));
  return [...new Set([...tracked, ...untracked])];
}
