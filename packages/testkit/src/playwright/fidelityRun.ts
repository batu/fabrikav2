/**
 * writeFidelityGrid() — the RUNNER side of the fidelity grid (card KEghp3x4
 * friction #1/#2). Given a run dir that already holds `screenshots/<name>.png`
 * candidate captures and a directory of `<name>.png` reference images, it copies
 * the matched references into the run dir and writes a self-contained
 * `fidelity-grid.html` (built by the pure `buildFidelityGrid`).
 *
 * It reports which states PAIRED and which are MISSING (and why) instead of
 * silently dropping them — the earlier hand-written spec detected a missing pair
 * only by an ad-hoc `existsSync` filter, so a reference with no candidate could
 * vanish from the grid unnoticed. Here the gap is returned data the caller can
 * assert on.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildFidelityGrid, type FidelityGridOptions } from '../harness/fidelityGrid.ts';

export interface FidelityState {
  /** State name; also the candidate/reference file stem (`<name>.png`). */
  readonly name: string;
  /** Optional strictness-axes caption for the grid row. */
  readonly axes?: string;
}

export interface WriteFidelityGridOptions {
  /** The run dir (already created by `collectRun`). */
  readonly dir: string;
  /** Source dir holding the reference PNGs as `<name>.png`. */
  readonly refDir: string;
  /** States to pair, in grid order. */
  readonly states: readonly FidelityState[];
  /** Candidate screenshots subdir within `dir` (default `screenshots`). */
  readonly screenshotsSubdir?: string;
  /** Subdir the references are copied into within `dir` (default `refs`). */
  readonly refsSubdir?: string;
  /** Grid file name within `dir` (default `fidelity-grid.html`). */
  readonly gridFileName?: string;
  /** Passed through to `buildFidelityGrid`. */
  readonly grid?: FidelityGridOptions;
}

export interface WriteFidelityGridResult {
  /** Absolute path of the written grid file. */
  readonly gridPath: string;
  /** State names that had BOTH a reference and a candidate. */
  readonly paired: string[];
  /** States dropped from the grid, with which side was absent. */
  readonly missing: Array<{ readonly name: string; readonly reason: 'ref' | 'candidate' | 'both' }>;
}

/**
 * Copy matched references into `<dir>/<refsSubdir>/` and write the grid. Only
 * states with both sides present are rendered; the rest are reported in
 * `missing`. The reference images must exist under `refDir`; the candidates must
 * already be in `<dir>/<screenshotsSubdir>/` (written by `collectRun`).
 */
export function writeFidelityGrid(options: WriteFidelityGridOptions): WriteFidelityGridResult {
  const screenshotsSubdir = options.screenshotsSubdir ?? 'screenshots';
  const refsSubdir = options.refsSubdir ?? 'refs';
  const gridFileName = options.gridFileName ?? 'fidelity-grid.html';

  const refsOut = join(options.dir, refsSubdir);
  const paired: string[] = [];
  const missing: WriteFidelityGridResult['missing'] = [];
  const pairs = [];

  for (const state of options.states) {
    const refFile = join(options.refDir, `${state.name}.png`);
    const candidateFile = join(options.dir, screenshotsSubdir, `${state.name}.png`);
    const hasRef = existsSync(refFile);
    const hasCandidate = existsSync(candidateFile);
    if (!hasRef || !hasCandidate) {
      missing.push({ name: state.name, reason: !hasRef && !hasCandidate ? 'both' : !hasRef ? 'ref' : 'candidate' });
      continue;
    }
    mkdirSync(refsOut, { recursive: true });
    copyFileSync(refFile, join(refsOut, `${state.name}.png`));
    paired.push(state.name);
    pairs.push({
      name: state.name,
      refSrc: `${refsSubdir}/${state.name}.png`,
      candidateSrc: `${screenshotsSubdir}/${state.name}.png`,
      axes: state.axes,
    });
  }

  const gridPath = join(options.dir, gridFileName);
  writeFileSync(gridPath, buildFidelityGrid(pairs, options.grid), 'utf8');

  return { gridPath, paired, missing };
}

/**
 * Resolve where a run bundle should land, honoring the `.work`-vs-`evidence`
 * promotion convention (`games/_template/.work/README.md`). By default a run is
 * side-effect-free (writes to the gitignored `workDir`); set `PROMOTE_EVIDENCE=1`
 * (or pass `promote: true`) to write the COMMITTED `evidenceDir` artifact.
 *
 * Centralizes the `process.env.PROMOTE_EVIDENCE === '1'` check that every
 * evidence spec was copy-pasting (card KEghp3x4 friction #3).
 */
export function resolveEvidenceOutDir(options: {
  readonly evidenceDir: string;
  readonly workDir: string;
  readonly promote?: boolean;
  readonly env?: Record<string, string | undefined>;
}): string {
  const env = options.env ?? process.env;
  const promote = options.promote ?? env.PROMOTE_EVIDENCE === '1';
  return promote ? options.evidenceDir : options.workDir;
}
