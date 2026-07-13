// Shared test helpers: resolve repo-anchored paths independent of the cwd the
// unit runner is invoked from.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Absolute path to the repository root (three levels above this test dir). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Resolve a repo-relative path to an absolute one. */
export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

/** Read + JSON-parse a repo-relative file. */
export function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(repoPath(...segments), 'utf8'));
}
