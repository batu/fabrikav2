/**
 * collectRun() — the RUNNER side of run collection. The browser can't write a
 * run dir (CONDUCTOR decision 3), so the harness returns artifacts (blobs) and
 * this writes them to disk in the `evidence/<date>-<topic>/` shape. The dir
 * layout itself is defined PURELY in `../harness/runLayout.ts` (browser-safe,
 * unit-tested there and here); this module is only the filesystem writer.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { buildRunLayout, type RunArtifacts } from '../harness/runLayout.ts';

export interface CollectRunOptions {
  /** Parent dir the run dir is created under (e.g. a game's `evidence/`). */
  outDir: string;
  /** Topic slug for the run dir name. */
  topic: string;
  /** ISO date for the run dir name. Injected for deterministic naming. */
  date: string;
  /** The witnessed artifacts (from the harness `capture`/`snapshot`/etc.). */
  artifacts: RunArtifacts;
}

export interface CollectRunResult {
  /** Absolute path of the created run dir. */
  dir: string;
  /** Absolute paths of every file written, in layout order. */
  files: string[];
}

/**
 * Write a run bundle to `<outDir>/<date>-<topic>/`. Base64 artifacts
 * (screenshots) are written as binary; JSON witnesses as UTF-8 text. Nested
 * dirs (e.g. `screenshots/`) are created as needed. Returns the created dir and
 * the files written.
 */
export function collectRun(options: CollectRunOptions): CollectRunResult {
  const layout = buildRunLayout({
    date: options.date,
    topic: options.topic,
    artifacts: options.artifacts,
  });

  const dir = join(options.outDir, layout.dirName);
  mkdirSync(dir, { recursive: true });

  const files: string[] = [];
  for (const file of layout.files) {
    const absolute = join(dir, file.path);
    mkdirSync(dirname(absolute), { recursive: true });
    if (file.encoding === 'base64') {
      writeFileSync(absolute, Buffer.from(file.content, 'base64'));
    } else {
      writeFileSync(absolute, file.content, 'utf8');
    }
    files.push(absolute);
  }

  return { dir, files };
}
