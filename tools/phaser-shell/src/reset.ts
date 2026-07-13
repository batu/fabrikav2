// Rehearsal clean-P0 scratch reset (U5, KTD-J). Copies the committed authoring
// project (the clean P0) to a UNIQUE scratch location OUTSIDE the landing
// worktree and records the starting Phaser-specific P0 project hash. The human
// editor session (P6) opens the scratch copy — the mutable landing worktree is
// NEVER edited (card comments 2, 4). Unscored rehearsal only.
import { cp, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AUTHORING = path.join(REPO_ROOT, 'games', 'shell_proof_phaser', 'authoring');

export interface ScratchResult {
  scratch: string;
  project: string;
  p0Hash: string;
}

/** Deterministic hash over the authoring project's editor sources (the P0 hash). */
async function projectHash(dir: string, rel = ''): Promise<Buffer> {
  const hash = createHash('sha256');
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    // Publications are derived output, not P0 source — exclude them from the hash.
    if (relPath === 'publications') continue;
    if (entry.isDirectory()) hash.update(await projectHash(abs, relPath));
    else hash.update(`${relPath}\0`).update(await readFile(abs));
  }
  return hash.digest();
}

/**
 * Copy the clean P0 to a unique scratch dir outside the worktree and return the
 * scratch path + the recorded Phaser-specific P0 hash. `dest` overrides the
 * scratch root (used by tests); default is an OS temp dir.
 */
export async function resetToScratch(dest?: string): Promise<ScratchResult> {
  const scratchRoot = dest ?? (await mkdtemp(path.join(os.tmpdir(), 'u5-scratch-')));
  const projectDir = path.join(scratchRoot, 'phaser-editor');
  await cp(path.join(AUTHORING, 'phaser-editor'), projectDir, { recursive: true });
  await cp(path.join(AUTHORING, 'catalog'), path.join(scratchRoot, 'catalog'), { recursive: true });
  const p0Hash = `sha256-${(await projectHash(path.join(AUTHORING, 'phaser-editor'))).toString('hex')}`;
  return { scratch: scratchRoot, project: projectDir, p0Hash };
}
