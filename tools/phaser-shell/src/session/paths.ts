// Path guards for the provenance leg (P6 §6, R13/R32). The protocol operates
// ONLY on an explicit, unique scratch OUTSIDE the landing worktree (the mutable
// worktree is never edited — card comments 2/4) and emits its scrubbed evidence
// to an explicit path that also defaults OUTSIDE the repo. These are pure,
// GUI-free checks so they can be unit-tested without an editor.
import { statSync } from 'node:fs';
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
  const root = path.resolve(scratch);
  if (isInside(REPO_ROOT, root)) {
    throw new PathBlocked('scratch-in-repo', 'the scratch must be OUTSIDE the landing worktree');
  }
  let stat;
  try {
    stat = statSync(root);
  } catch {
    throw new PathBlocked('scratch-missing', 'the scratch root does not exist');
  }
  if (!stat.isDirectory()) {
    throw new PathBlocked('scratch-not-dir', 'the scratch root is not a directory');
  }
  const project = path.join(root, 'phaser-editor');
  const plugins = path.join(root, 'editor-plugins');
  for (const [label, dir] of [['phaser-editor', project], ['editor-plugins', plugins]] as const) {
    try {
      if (!statSync(dir).isDirectory()) throw new Error('not-dir');
    } catch {
      throw new PathBlocked('scratch-incomplete', `the scratch is missing ${label}/ (re-run \`reset\`)`);
    }
  }
  return { scratch: root, project, plugins };
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
