// Path guards for the provenance leg (P6 §6, R13/R32). The protocol operates
// ONLY on an explicit, unique scratch OUTSIDE the landing worktree (the mutable
// worktree is never edited — card comments 2/4) and emits its scrubbed evidence
// to an explicit path that also defaults OUTSIDE the repo. These are pure,
// GUI-free checks so they can be unit-tested without an editor.
import { lstatSync, realpathSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Repository root (four levels above this module: `tools/phaser-shell/src/session`). */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export class PathBlocked extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PathBlocked';
  }
}

/** True when `candidate` resolves to `root` or anything beneath it. */
export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export interface ScratchLayout {
  /** The scratch root (outside the repo). */
  scratch: string;
  /** The editor project inside the scratch (`<scratch>/phaser-editor`). */
  project: string;
  /** The allowlisted editor plugins inside the scratch (`<scratch>/editor-plugins`). */
  plugins: string;
  /** The curated catalog copied by reset (`<scratch>/catalog`). */
  catalog: string;
}

/** Reject symlinks, special files, and realpath escapes anywhere in a consumed tree. */
function assertSolidTree(dir: string, realRoot: string, realRepo: string, label: string): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new PathBlocked('scratch-incomplete', `cannot read ${label}/`);
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(realRoot, abs).split(path.sep).join('/');
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) {
      throw new PathBlocked('scratch-symlink', `${rel} must not be a symlink`);
    }
    const resolved = realpathSync(abs);
    if (!isInside(realRoot, resolved) || isInside(realRepo, resolved)) {
      throw new PathBlocked('scratch-symlink', `${rel} escapes the scratch root`);
    }
    if (stat.isDirectory()) {
      assertSolidTree(abs, realRoot, realRepo, label);
    } else if (!stat.isFile()) {
      throw new PathBlocked('scratch-incomplete', `${rel} is not a regular file`);
    }
  }
}

/**
 * Resolve + validate an explicit scratch root: it must be an existing directory
 * OUTSIDE the repo carrying the copied `phaser-editor` project and `editor-plugins`
 * (both minted by `reset`). Blocks (never silently proceeds) otherwise.
 */
export function resolveScratch(scratch: string | undefined): ScratchLayout {
  if (!scratch || !scratch.trim()) {
    throw new PathBlocked('scratch-missing', 'an explicit scratch root is required (run `reset` first)');
  }
  const requestedRoot = path.resolve(scratch);
  if (isInside(REPO_ROOT, requestedRoot)) {
    throw new PathBlocked('scratch-in-repo', 'the scratch must be OUTSIDE the landing worktree');
  }
  let stat;
  try {
    stat = lstatSync(requestedRoot);
  } catch {
    throw new PathBlocked('scratch-missing', 'the scratch root does not exist');
  }
  if (stat.isSymbolicLink()) {
    throw new PathBlocked('scratch-symlink', 'the scratch root must not be a symlink');
  }
  if (!stat.isDirectory()) {
    throw new PathBlocked('scratch-not-dir', 'the scratch root is not a directory');
  }
  const root = requestedRoot;
  const realRoot = realpathSync(requestedRoot);
  const realRepo = realpathSync(REPO_ROOT);
  if (isInside(realRepo, realRoot)) {
    throw new PathBlocked('scratch-in-repo', 'the scratch must be OUTSIDE the landing worktree');
  }
  const project = path.join(root, 'phaser-editor');
  const plugins = path.join(root, 'editor-plugins');
  const catalog = path.join(root, 'catalog');
  for (const [label, dir] of [
    ['phaser-editor', project],
    ['editor-plugins', plugins],
    ['catalog', catalog],
  ] as const) {
    try {
      const childStat = lstatSync(dir);
      if (childStat.isSymbolicLink()) {
        throw new PathBlocked('scratch-symlink', `${label}/ must not be a symlink`);
      }
      if (!childStat.isDirectory()) throw new Error('not-dir');
      const realChild = realpathSync(dir);
      if (!isInside(realRoot, realChild) || isInside(realRepo, realChild)) {
        throw new PathBlocked('scratch-symlink', `${label}/ escapes the scratch root`);
      }
      assertSolidTree(dir, realRoot, realRepo, label);
    } catch (error) {
      if (error instanceof PathBlocked) throw error;
      throw new PathBlocked('scratch-incomplete', `the scratch is missing ${label}/ (re-run \`reset\`)`);
    }
  }
  return { scratch: root, project, plugins, catalog };
}

/**
 * Resolve the evidence output path. When omitted it defaults to a unique file
 * INSIDE the scratch (i.e. outside the repo). An explicit path is honored; the
 * emitted record is hash-only + scrubbed so it is safe wherever it lands.
 */
export function resolveOutput(output: string | undefined, scratch: string, runId: string): string {
  if (output && output.trim()) return path.resolve(output);
  return path.join(scratch, 'evidence', `provenance-${runId}.json`);
}
