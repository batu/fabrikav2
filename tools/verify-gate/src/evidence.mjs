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
