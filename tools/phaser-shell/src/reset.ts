// Rehearsal clean-P0 scratch reset (U5, KTD-J). Copies the committed authoring
// project (the clean P0) to a UNIQUE scratch location OUTSIDE the landing
// worktree and records the starting Phaser-specific P0 project hash. The human
// editor session (P6) opens the scratch copy — the mutable landing worktree is
// NEVER edited (card comments 2, 4). Unscored rehearsal only.
import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AUTHORING = path.join(REPO_ROOT, 'games', 'shell_proof_phaser', 'authoring');

export interface ScratchResult {
  scratch: string;
  project: string;
  /** The allowlisted editor plugins copied into the scratch (the provenance leg's `-plugins` path). */
  plugins: string;
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

/** Match the licensed Editor's deterministic JSON save form in the scratch. */
async function normalizeSceneBytes(projectDir: string): Promise<void> {
  const scenesDir = path.join(projectDir, 'src', 'scenes');
  for (const entry of await readdir(scenesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.scene')) continue;
    const file = path.join(scenesDir, entry.name);
    const bytes = await readFile(file, 'utf8');
    const normalized = bytes.replace(/[\r\n]+$/, '');
    if (normalized !== bytes) await writeFile(file, normalized, 'utf8');
  }
}

/**
 * Copy the clean P0 to a unique scratch dir outside the worktree and return the
 * scratch path + the recorded Phaser-specific P0 hash. `dest` overrides the
 * scratch root (used by tests); default is an OS temp dir.
 */
export async function resetToScratch(dest?: string): Promise<ScratchResult> {
  const scratchRoot = dest ?? (await mkdtemp(path.join(os.tmpdir(), 'u5-scratch-')));
  const projectDir = path.join(scratchRoot, 'phaser-editor');
  const pluginsDir = path.join(scratchRoot, 'editor-plugins');
  await cp(path.join(AUTHORING, 'phaser-editor'), projectDir, { recursive: true });
  await normalizeSceneBytes(projectDir);
  await cp(path.join(AUTHORING, 'catalog'), path.join(scratchRoot, 'catalog'), { recursive: true });
  // The allowlisted editor plugins ride with the scratch so the provenance leg
  // can start the server with a scratch-local `-plugins` path (§10), never one
  // inside the landing worktree.
  await cp(path.join(AUTHORING, 'editor-plugins'), pluginsDir, { recursive: true });
  const p0Hash = `sha256-${(await projectHash(projectDir)).toString('hex')}`;
  return { scratch: scratchRoot, project: projectDir, plugins: pluginsDir, p0Hash };
}
