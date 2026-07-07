// Atomic merge+cleanup landing guard (card MjiISWBg). Before the conductor
// removes a card's worktree or deletes its branch, HARD-VERIFY the branch's
// work actually landed on the integration branch (main). The failure this
// prevents is real and observed: a card branch deleted BEFORE the merge was
// confirmed on main — recoverable only from the dangling sha. So this guard
// fails LOUD and fails CLOSED, and the conductor must call it BEFORE any
// `git worktree remove` / `git branch -d|-D`.
//
// Two checks, both device-independent (pure git — no build, no device):
//   1. Ancestry (always): the branch tip commit must be an ancestor of the
//      integration ref. If it is, EVERY commit — and therefore every file the
//      branch added — is provably on main, so cleanup is safe. If it is NOT,
//      the merge did not land and deleting the branch would strand the sha.
//   2. Key artifacts (optional): each explicitly named path must exist in the
//      integration ref's tree — the literal "is the card's key artifact on
//      main" ls-check the card asks for, for when a caller wants belt-and-
//      suspenders on a specific file.
//
// All git access goes through an injected `run(cmd) -> {ok, stdout}` runner
// (ok === exit 0), so the decision logic is unit-testable without a real repo.

/**
 * Resolve a ref to its commit sha, or null when it does not resolve.
 * `^{commit}` peels tags/annotated refs to the commit so a branch, tag, or raw
 * sha all normalise identically.
 * @param {(cmd:string)=>{ok:boolean, stdout:string}} run
 * @param {string} ref
 * @returns {string|null}
 */
export function resolveSha(run, ref) {
  const r = run(`git rev-parse --verify --quiet ${ref}^{commit}`);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

/**
 * True when `commitSha` is an ancestor of (or equal to) `ontoRef`.
 * `git merge-base --is-ancestor A B` exits 0 when A is an ancestor of B, 1
 * otherwise — the injected runner maps exit 0 to ok:true. Callers resolve both
 * ends to real commits first, so a non-zero exit here means "not landed", never
 * "bad object".
 * @param {(cmd:string)=>{ok:boolean, stdout:string}} run
 * @param {string} commitSha
 * @param {string} ontoRef
 * @returns {boolean}
 */
export function isAncestorOf(run, commitSha, ontoRef) {
  return run(`git merge-base --is-ancestor ${commitSha} ${ontoRef}`).ok;
}

/**
 * True when `pathStr` exists in `ref`'s tree. `git cat-file -e <ref>:<path>`
 * exits 0 iff the blob/tree is present.
 * @param {(cmd:string)=>{ok:boolean, stdout:string}} run
 * @param {string} ref
 * @param {string} pathStr
 * @returns {boolean}
 */
export function artifactPresent(run, ref, pathStr) {
  return run(`git cat-file -e ${ref}:${pathStr}`).ok;
}

/**
 * Locate the single branch matching `trello-<shortid>-*`, mirroring twf
 * merge-card's locate-never-reconstruct rule: the shortid is the stable key,
 * the slug is lossy and is never rebuilt. Hard result on zero ("cannot locate")
 * or many ("ambiguous").
 * @param {(cmd:string)=>{ok:boolean, stdout:string}} run
 * @param {string} shortid
 * @returns {{ok:true, branch:string}|{ok:false, reason:string, candidates:string[]}}
 */
export function locateBranch(run, shortid) {
  // Both arguments are single-quoted because the runner executes via a shell:
  // an unquoted `*` in the pattern would be glob-expanded before git sees it,
  // and the `()` in the format string is a shell syntax error unquoted. Git
  // itself does the `trello-<shortid>-*` match on branch names.
  const res = run(
    `git branch --list 'trello-${shortid}-*' --format='%(refname:short)'`,
  );
  const names = res.ok
    ? res.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    : [];
  if (names.length === 0) {
    return {
      ok: false,
      candidates: [],
      reason:
        `no branch matches 'trello-${shortid}-*' — cannot locate the card `
        + 'branch. NEVER reconstruct the slug; the branch must already exist.',
    };
  }
  if (names.length > 1) {
    return {
      ok: false,
      candidates: names,
      reason:
        `ambiguous: ${names.length} branches match 'trello-${shortid}-*': `
        + `${names.join(', ')}. Resolve the duplicates before landing.`,
    };
  }
  return { ok: true, branch: names[0] };
}

/**
 * Pure decision over already-gathered facts. Returns `{ok, reason}`; `ok:false`
 * is a HARD refusal — the conductor must not remove the worktree or delete the
 * branch. The branch sha is echoed in every refusal so a stranded branch is
 * always recoverable.
 * @param {{branch:string, branchSha:string|null, ontoRef:string,
 *   isAncestor:boolean, artifacts?:string[], missingArtifacts?:string[]}} facts
 * @returns {{ok:boolean, reason:string}}
 */
export function decideLanded({
  branch,
  branchSha,
  ontoRef,
  isAncestor,
  artifacts = [],
  missingArtifacts = [],
}) {
  if (!branch) return { ok: false, reason: 'no card branch supplied' };
  if (!branchSha) {
    return { ok: false, reason: `cannot resolve the tip commit of '${branch}'` };
  }
  if (!isAncestor) {
    return {
      ok: false,
      reason:
        `'${branch}' (${branchSha}) is NOT an ancestor of ${ontoRef} — the `
        + 'merge has not landed. REFUSING worktree-remove / branch delete; '
        + `recover the work from sha ${branchSha}.`,
    };
  }
  if (missingArtifacts.length > 0) {
    return {
      ok: false,
      reason:
        `'${branch}' (${branchSha}) is on ${ontoRef} but key artifact(s) are `
        + `MISSING from ${ontoRef}: ${missingArtifacts.join(', ')}. REFUSING `
        + `cleanup; recover from sha ${branchSha}.`,
    };
  }
  const extra = artifacts.length
    ? ` with ${artifacts.length} key artifact(s) present`
    : '';
  return {
    ok: true,
    reason: `'${branch}' (${branchSha}) is on ${ontoRef}${extra} — safe to clean up.`,
  };
}

/**
 * Parse the landed-gate CLI argv (already sliced past node + script).
 * Positional (non `--flag`) token is the branch; `--shortid` locates it
 * instead. Kept here (not in the CLI) so it is unit-testable without importing
 * the CLI, whose top-level body runs `main()` on import.
 * @param {string[]} argv
 * @returns {{branch:string|null, shortid:string|null, onto:string, artifacts:string[]}}
 */
export function parseArgs(argv) {
  const out = { branch: null, shortid: null, onto: 'HEAD', artifacts: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--shortid') { out.shortid = argv[++i]; }
    else if (a === '--onto') { out.onto = argv[++i]; }
    else if (a === '--artifact') { out.artifacts.push(argv[++i]); }
    else if (!a.startsWith('--') && out.branch === null) { out.branch = a; }
    else { throw new Error(`unexpected argument: ${a}`); }
  }
  if (out.branch === null && out.shortid === null) {
    throw new Error('supply a card branch (positional) or --shortid <id>');
  }
  if (out.branch !== null && out.shortid !== null) {
    throw new Error('pass EITHER a branch positional OR --shortid, not both');
  }
  return out;
}

/**
 * Gather the facts via the injected runner and decide. `ontoRef` is the branch
 * the card was merged into (default 'HEAD' — at landing time the conductor is
 * on the integration/default branch). `artifacts` is an optional list of paths
 * to additionally confirm on `ontoRef`.
 * @param {{run:(cmd:string)=>{ok:boolean, stdout:string}, branch:string,
 *   ontoRef?:string, artifacts?:string[]}} opts
 * @returns {{ok:boolean, reason:string, branch:string, branchSha:string|null}}
 */
export function evaluateLanded({ run, branch, ontoRef = 'HEAD', artifacts = [] }) {
  const branchSha = resolveSha(run, branch);
  const isAncestor = branchSha ? isAncestorOf(run, branchSha, ontoRef) : false;
  // Only bother resolving artifacts once ancestry holds — a non-landed branch
  // is already a hard fail and the artifact list would just add noise.
  const missingArtifacts =
    branchSha && isAncestor
      ? artifacts.filter((p) => !artifactPresent(run, ontoRef, p))
      : [];
  const decision = decideLanded({
    branch,
    branchSha,
    ontoRef,
    isAncestor,
    artifacts,
    missingArtifacts,
  });
  return { ...decision, branch, branchSha };
}
