// Git diff plumbing for the gate: the set of files changed vs the merge-base
// with origin/main (per the card). Falls back gracefully — origin/main may not
// be fetched in a fresh worktree, so we try origin/main, then main, then plain
// `git diff HEAD` (uncommitted only). `run` is injected so it is testable and
// always scoped to the project dir.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * The one shared command runner for every gate CLI (was reimplemented per-CLI
 * with silent drift). Captures stderr so a fail-closed gate can say WHY a git
 * or npm call failed instead of a bare "command failed".
 * @param {string} cwd
 * @param {{trim?: boolean}} [opts] trim stdout (release-provenance behavior)
 * @returns {(cmd:string)=>{ok:boolean, stdout:string, stderr:string}}
 */
export function makeRunner(cwd, { trim = false } = {}) {
  return (cmd) => {
    try {
      const stdout = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { ok: true, stdout: trim ? stdout.trim() : stdout, stderr: '' };
    } catch (e) {
      const stdout = e && e.stdout ? String(e.stdout) : '';
      const stderr = e && e.stderr ? String(e.stderr) : '';
      return { ok: false, stdout: trim ? stdout.trim() : stdout, stderr };
    }
  };
}

/** Append the last stderr line (when present) to a gate error message. */
function withStderr(msg, res) {
  const line = String((res && res.stderr) || '').trim().split('\n').filter(Boolean).pop();
  return line ? `${msg}: ${line}` : msg;
}

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

function porcelainPath(line) {
  let file = String(line || '').slice(3);
  if (file.includes(' -> ')) {
    const parts = file.split(' -> ');
    file = parts[parts.length - 1];
  }
  return file.trim().replace(/^"|"$/g, '');
}

/**
 * Dirty paths in the current worktree, including staged, unstaged, and
 * untracked files. Landing gates are fail-closed: if git status cannot run,
 * callers should treat that as a red gate.
 * @param {(cmd:string)=>{ok:boolean, stdout:string}} run
 * @returns {{ok:true, files:string[]}|{ok:false, error:string}}
 */
export function dirtyFiles(run) {
  const status = run('git status --porcelain --untracked-files=all');
  if (!status.ok) {
    return { ok: false, error: withStderr('git status --porcelain --untracked-files=all failed', status) };
  }
  const rawLines = status.stdout.split('\n').filter((line) => line.trim() !== '');
  return { ok: true, files: [...new Set(rawLines.map(porcelainPath))] };
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
      error: withStderr(`git diff --name-only ${point} failed`, diff),
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

/**
 * The visual-toolchain self-disable predicate, shared by the Stop hook and the
 * merge gate (was duplicated per-CLI): the gate is active only when the
 * verify-device tool and a games/ dir both exist.
 * @returns {{toolPresent:boolean, gamesDirPresent:boolean}}
 */
export function visualToolchainPresent(projectDir, fsImpl = fs) {
  const toolPresent = fsImpl.existsSync(path.join(projectDir, 'tools/verify-device/cli.mjs'));
  let gamesDirPresent = false;
  try {
    gamesDirPresent = fsImpl.statSync(path.join(projectDir, 'games')).isDirectory();
  } catch {
    gamesDirPresent = false;
  }
  return { toolPresent, gamesDirPresent };
}
