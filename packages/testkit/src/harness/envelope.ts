/**
 * Snapshot envelope — stamp a game's inner `snapshot()` fingerprint with the
 * metadata that makes a capture self-describing and misattribution-proof.
 *
 * The `packageId` + `buildVersion` stamps are the WRONG-PACKAGE guard: the
 * 2026-07-06 near-miss (`docs/retros/insitu-testing-capability-notes.md`) was a
 * capture silently attributed to the wrong installed variant. Stamping the
 * package/build BY CONSTRUCTION means an envelope always carries the identity of
 * the build it came from.
 */
import type { SnapshotEnvelope } from './contract.ts';

/**
 * Monotonic clock: `performance.now()` where available (never runs backwards on
 * a wall-clock adjustment), falling back to `Date.now()`. Isolated so tests can
 * inject a deterministic clock via {@link wrapSnapshot}'s `now` option.
 */
export function monotonicNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export interface WrapSnapshotOptions {
  /** Build version string, carried onto the envelope. */
  buildVersion: string;
  /** Package / app id — the wrong-package guard. */
  packageId: string;
  /** Injected clock; defaults to {@link monotonicNow}. */
  now?: () => number;
}

/**
 * Wrap an inner fingerprint in the stamped {@link SnapshotEnvelope}. The
 * fingerprint is whatever the game's `snapshot()` returns (marble_run returns a
 * plain object); this helper does not interpret it, only stamps it.
 */
export function wrapSnapshot<Fingerprint>(
  fingerprint: Fingerprint,
  options: WrapSnapshotOptions,
): SnapshotEnvelope<Fingerprint> {
  const now = options.now ?? monotonicNow;
  return {
    fingerprint,
    ts: now(),
    buildVersion: options.buildVersion,
    packageId: options.packageId,
  };
}
