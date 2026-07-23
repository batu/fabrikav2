// Filesystem plumbing for evidence freshness: the newest mtime among a set of
// changed files, and the mtimes of all verify-device panel.json artifacts. The
// pure freshness comparison lives in classify.evidenceIsFresh; this module only
// gathers the numbers.
import fs from 'node:fs';
import path from 'node:path';

/** Panel-artifact globs (card-specified): the device-verify evidence dirs under
 *  docs/evidence, plus per-game evidence dirs. */
export const PANEL_GLOBS = [
  'docs/evidence/*device-verify*/panel.json',
  'games/*/evidence/**/panel.json',
];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/** Newest mtime (ms) among the given repo-relative files, or null if none stat. */
export function newestMtimeMs(files, projectDir, fsImpl = fs) {
  let newest = null;
  for (const f of files || []) {
    try {
      const t = fsImpl.statSync(path.join(projectDir, f)).mtimeMs;
      if (newest === null || t > newest) newest = t;
    } catch {
      // deleted/absent file — skip; it can't carry a rendered artifact.
    }
  }
  return newest;
}

function gitCommitTimeMs(run, file) {
  const res = run(`git log -1 --format=%ct -- ${shellQuote(file)}`);
  const seconds = Number(res.ok ? res.stdout.trim() : NaN);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** Set of repo-relative dirty paths (staged/unstaged/untracked), or null when
 *  git status cannot run (fail-soft: callers then treat every file as dirty,
 *  i.e. the pre-existing mtime behavior). */
function gitDirtyPathSet(run) {
  const status = run('git status --porcelain --untracked-files=all');
  if (!status.ok) return null;
  const set = new Set();
  for (const line of status.stdout.split('\n')) {
    if (line.trim() === '') continue;
    let file = line.slice(3);
    if (file.includes(' -> ')) file = file.split(' -> ').pop();
    set.add(file.trim().replace(/^"|"$/g, ''));
  }
  return set;
}

/**
 * Newest observed change time for a set of changed visual files.
 *
 * Files that are CLEAN in git (no uncommitted modification) use their
 * last-commit timestamp (`git log -1 --format=%ct`): a fresh linked worktree
 * stamps every checkout file with "now", so raw mtimes would make every
 * committed panel look stale and the gate would always fail there. Dirty or
 * untracked files keep filesystem mtime — a real uncommitted edit IS newer
 * than any evidence. Deleted/unstat-able files fall back to the git-log
 * timestamp when a runner is supplied, which catches committed deletions at
 * landing time. Missing files are still reported so the classifier can fail
 * closed when no structured evidence covers them. Without a runner, or when
 * any git call fails, behavior degrades to pure mtimes (fail-soft).
 * @param {string[]} files repo-relative changed visual files
 * @param {string} projectDir repo root
 * @param {{fsImpl?: typeof fs, run?: (cmd:string)=>{ok:boolean, stdout:string}}} opts
 * @returns {{newestChangeMs:number|null, missingFiles:string[]}}
 */
export function newestVisualChangeMs(files, projectDir, { fsImpl = fs, run } = {}) {
  let newestChangeMs = null;
  const missingFiles = [];
  const dirtySet = run ? gitDirtyPathSet(run) : null;
  for (const f of files || []) {
    let statMs = null;
    try {
      statMs = fsImpl.statSync(path.join(projectDir, f)).mtimeMs;
    } catch {
      missingFiles.push(f);
    }
    let t = null;
    if (statMs !== null) {
      if (run && dirtySet !== null && !dirtySet.has(String(f))) {
        // Clean in git: the checkout mtime is a lie in fresh worktrees — trust
        // the last commit time; fall back to mtime if git has no record.
        const commitMs = gitCommitTimeMs(run, f);
        t = commitMs !== null ? commitMs : statMs;
      } else {
        t = statMs; // dirty/untracked (or no git signal): mtime is the truth
      }
    } else if (run) {
      t = gitCommitTimeMs(run, f);
    }
    if (t !== null && (newestChangeMs === null || t > newestChangeMs)) newestChangeMs = t;
  }
  return { newestChangeMs, missingFiles };
}

/** Mtimes (ms) of every panel.json matched by PANEL_GLOBS under projectDir. */
export function panelMtimesMs(projectDir, fsImpl = fs) {
  const times = [];
  for (const pattern of PANEL_GLOBS) {
    let matches = [];
    try {
      matches = fsImpl.globSync(pattern, { cwd: projectDir });
    } catch {
      matches = [];
    }
    for (const m of matches) {
      try {
        times.push(fsImpl.statSync(path.join(projectDir, m)).mtimeMs);
      } catch {
        // race: matched then removed — ignore.
      }
    }
  }
  return times;
}

function panelPaths(projectDir, fsImpl = fs) {
  const paths = [];
  for (const pattern of PANEL_GLOBS) {
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

function parseGeneratedAt(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse verify-device panel artifacts into the structured proof shape the gate
 * trusts. Corrupt or legacy panels are returned as invalid records, not thrown:
 * one bad panel should not hide a different good panel, but it also must never
 * satisfy the landing gate.
 *
 * @returns {Array<{path:string, valid:boolean, game?:string, lane?:string,
 *   generatedAtMs?:number|null, verdictPass?:boolean, verdictScore?:number,
 *   verdictSummary?:string, error?:string}>}
 */
export function readPanelEvidence(projectDir, fsImpl = fs) {
  return panelPaths(projectDir, fsImpl).map((rel) => {
    const abs = path.join(projectDir, rel);
    let raw;
    try {
      raw = fsImpl.readFileSync(abs, 'utf8');
    } catch (err) {
      return { path: rel, valid: false, error: `cannot read panel: ${err.message}` };
    }
    let panel;
    try {
      panel = JSON.parse(raw);
    } catch (err) {
      return { path: rel, valid: false, error: `panel is not valid JSON: ${err.message}` };
    }
    const game = typeof panel.game === 'string' ? panel.game : null;
    const lane = typeof panel.lane === 'string' ? panel.lane : null;
    const generatedAtMs = parseGeneratedAt(panel.generatedAt);
    const verdict = panel.verdict && typeof panel.verdict === 'object' ? panel.verdict : null;
    const verdictPass = verdict && verdict.pass === true;
    const missing = [];
    if (!game) missing.push('game');
    if (!lane) missing.push('lane');
    if (generatedAtMs === null) missing.push('generatedAt');
    if (!verdict || typeof verdict.pass !== 'boolean') missing.push('verdict.pass');
    if (missing.length) {
      return { path: rel, valid: false, error: `missing/invalid metadata: ${missing.join(', ')}` };
    }
    const record = { path: rel, valid: true, game, lane, generatedAtMs, verdictPass };
    if (Number.isFinite(verdict.score)) record.verdictScore = verdict.score;
    if (typeof verdict.summary === 'string') record.verdictSummary = verdict.summary;
    return record;
  });
}
