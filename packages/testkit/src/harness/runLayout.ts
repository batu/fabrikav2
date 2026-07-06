/**
 * The run-directory LAYOUT — the single source of truth for collectRun's dir
 * shape, kept PURE (no filesystem) so it is browser-safe and unit-testable
 * without touching disk.
 *
 * CONDUCTOR decision 3: the browser can't write a run dir, so the harness
 * returns artifacts (blobs) and the runner-side `collectRun`
 * (`../playwright/collectRun.ts`) assembles the dir. This module names the dir
 * and enumerates its files; `collectRun` just writes what this describes. The AC
 * "dir shape" unit test targets this function.
 *
 * The dir name matches the `evidence/<date>-<topic>/` shape
 * (`games/_template/evidence/README.md`).
 */
import type { AnalyticsEventLike, CaptureResult, PerfSample, SnapshotEnvelope } from './contract.ts';

/** The witnessed artifacts a run bundles. All optional — collectRun records
 *  whichever witnesses the harness produced. */
export interface RunArtifacts {
  /** Named PNG captures. */
  readonly screenshots?: ReadonlyArray<{ readonly name: string; readonly capture: CaptureResult }>;
  /** Stamped snapshot envelopes. */
  readonly snapshots?: readonly SnapshotEnvelope[];
  /** Drained analytics event trace. */
  readonly events?: readonly AnalyticsEventLike[];
  /** Perf sample. */
  readonly perf?: PerfSample;
}

/** One file to write into the run dir: a repo-relative-within-dir path and its
 *  bytes. `encoding` tells the writer how to interpret `content`. */
export interface RunFile {
  /** Path relative to the run dir root (forward slashes). */
  readonly path: string;
  /** File body. For `base64` this is the base64 string; for `utf8` it is text. */
  readonly content: string;
  readonly encoding: 'utf8' | 'base64';
}

/** A fully-described run dir: its name + the files that constitute it. */
export interface RunLayout {
  /** Directory name, e.g. `2026-07-06-menu-nav`. */
  readonly dirName: string;
  readonly files: readonly RunFile[];
}

export interface BuildRunLayoutOptions {
  /** ISO date, e.g. `2026-07-06`. Injected (never derived) for deterministic
   *  dir names in tests and reproducible runs. */
  date: string;
  /** Topic slug, e.g. `menu-nav`. */
  topic: string;
  artifacts: RunArtifacts;
}

const MANIFEST_FILE = 'manifest.json';
const SNAPSHOTS_FILE = 'snapshots.json';
const EVENTS_FILE = 'events.json';
const PERF_FILE = 'perf.json';
const SCREENSHOTS_DIR = 'screenshots';

/**
 * Describe the run dir for a set of artifacts. Always emits a `manifest.json`
 * (the index of what the run captured); the per-witness files appear only when
 * that witness produced data, so an empty witness leaves no misleading empty
 * file.
 */
export function buildRunLayout(options: BuildRunLayoutOptions): RunLayout {
  const { date, topic, artifacts } = options;
  const files: RunFile[] = [];

  const screenshots = artifacts.screenshots ?? [];
  const screenshotNames: string[] = [];
  for (const shot of screenshots) {
    const fileName = shot.name.endsWith('.png') ? shot.name : `${shot.name}.png`;
    files.push({
      path: `${SCREENSHOTS_DIR}/${fileName}`,
      content: shot.capture.pngBase64,
      encoding: 'base64',
    });
    screenshotNames.push(`${SCREENSHOTS_DIR}/${fileName}`);
  }

  if (artifacts.snapshots && artifacts.snapshots.length > 0) {
    files.push({ path: SNAPSHOTS_FILE, content: json(artifacts.snapshots), encoding: 'utf8' });
  }
  if (artifacts.events && artifacts.events.length > 0) {
    files.push({ path: EVENTS_FILE, content: json(artifacts.events), encoding: 'utf8' });
  }
  if (artifacts.perf) {
    files.push({ path: PERF_FILE, content: json(artifacts.perf), encoding: 'utf8' });
  }

  const manifest = {
    topic,
    date,
    screenshots: screenshotNames,
    snapshotCount: artifacts.snapshots?.length ?? 0,
    eventCount: artifacts.events?.length ?? 0,
    hasPerf: Boolean(artifacts.perf),
  };
  files.push({ path: MANIFEST_FILE, content: json(manifest), encoding: 'utf8' });

  return { dirName: `${date}-${topic}`, files };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
