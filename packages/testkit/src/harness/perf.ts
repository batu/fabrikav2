/**
 * perf() — fps buckets + worst-frame. Precedent: FTD `recordRevealFrame` (v1,
 * read-only, cited only). A game feeds each frame's duration to a recorder; the
 * harness's `perf()` returns the bucketed {@link PerfSample}.
 */
import type { PerfBucket, PerfSample } from './contract.ts';

/** Bucket thresholds in fps, high→low. A frame lands in the first bucket whose
 *  fps threshold it meets; anything below the last threshold is the tail. */
const FPS_THRESHOLDS = [60, 30, 20] as const;

function bucketLabelForFrame(frameMs: number): string {
  if (frameMs <= 0) return '>=60';
  const fps = 1000 / frameMs;
  for (const threshold of FPS_THRESHOLDS) {
    if (fps >= threshold) return `>=${threshold}`;
  }
  return `<${FPS_THRESHOLDS[FPS_THRESHOLDS.length - 1]}`;
}

export interface PerfRecorder {
  /** Record one frame's duration in milliseconds. */
  record(frameMs: number): void;
  /** The current bucketed sample. Safe to call repeatedly. */
  sample(): PerfSample;
  /** Discard all recorded frames. */
  reset(): void;
}

/**
 * A frame-time recorder that buckets by fps and tracks the worst single frame.
 * Bounded by construction — it keeps only counts + the max, never the full
 * frame series — so it is safe to leave running for a long session.
 */
export function createPerfRecorder(): PerfRecorder {
  const counts = new Map<string, number>();
  let worstFrameMs = 0;
  let frameCount = 0;

  return {
    record(frameMs: number): void {
      const label = bucketLabelForFrame(frameMs);
      counts.set(label, (counts.get(label) ?? 0) + 1);
      if (frameMs > worstFrameMs) worstFrameMs = frameMs;
      frameCount += 1;
    },
    sample(): PerfSample {
      // Stable bucket order (best→worst), only including non-empty buckets.
      const order = ['>=60', '>=30', '>=20', '<20'];
      const buckets: PerfBucket[] = [];
      for (const label of order) {
        const count = counts.get(label);
        if (count !== undefined) buckets.push({ label, count });
      }
      return { buckets, worstFrameMs, frameCount };
    },
    reset(): void {
      counts.clear();
      worstFrameMs = 0;
      frameCount = 0;
    },
  };
}
