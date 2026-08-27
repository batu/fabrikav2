import { createDefaultDifficultyDraft, type DifficultyDraft } from '../../../games/marble_run/src/levels/difficulty-contract.ts';
import { LEVELS } from '../../../games/marble_run/src/levels/levels.generated.ts';

import { GenerationCoordinator } from '../src/generation/coordinator.ts';

export const U2_FULL_CAMPAIGN_BASELINE_MS = 34_523.76;
export const U2_COMPUTE_TOLERANCE = 0.1;

export interface FullCampaignPerformanceResult {
  readonly acceptedCount: number;
  readonly ascending: boolean;
  readonly exactShippedBoards: boolean;
  readonly workerComputeMs: number;
  readonly workerWithinBaseline: boolean;
  readonly maxMainThreadTaskMs: number;
  readonly longTaskObserverSupported: boolean;
  readonly inputToPaintP95Ms: number;
  readonly latestStartLatencyMs: number | null;
  readonly staleResultCount: number;
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

/** Real-browser proof used by the U4-U6 performance gate, intentionally outside unit tests. */
export function runFullCampaignPerformance(draft: DifficultyDraft = createDefaultDifficultyDraft()): Promise<FullCampaignPerformanceResult> {
  return new Promise((resolve, reject) => {
    const acceptedResults: { readonly id: number; readonly levelJson: string }[] = [];
    const paints: number[] = [];
    const longTasks: number[] = [];
    const input = document.createElement('input');
    input.addEventListener('input', () => {
      const started = performance.now();
      requestAnimationFrame(() => paints.push(performance.now() - started));
    });
    document.body.append(input);
    const observer = typeof PerformanceObserver === 'undefined' ? null : new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    try { observer?.observe({ type: 'longtask', buffered: false }); } catch { /* Not every browser exposes long-task entries. */ }
    const paintSampler = window.setInterval(() => input.dispatchEvent(new Event('input')), 50);
    const timeout = window.setTimeout(() => {
      coordinator.dispose();
      cleanup();
      reject(new Error('Full-campaign worker performance run exceeded 120 seconds.'));
    }, 120_000);
    const cleanup = (): void => {
      window.clearInterval(paintSampler);
      window.clearTimeout(timeout);
      observer?.disconnect();
      input.remove();
    };
    const coordinator = new GenerationCoordinator({
      started: () => undefined,
      accepted: (_revision, result) => acceptedResults.push({ id: result.level.id, levelJson: JSON.stringify(result.level) }),
      failed: (_revision, levelId, reason) => {
        coordinator.dispose();
        cleanup();
        reject(new Error(`Level ${levelId} failed during the performance run: ${reason}`));
      },
      completed: (_revision, workerComputeMs) => {
        const metrics = coordinator.metrics();
        cleanup();
        coordinator.dispose();
        const upper = U2_FULL_CAMPAIGN_BASELINE_MS * (1 + U2_COMPUTE_TOLERANCE);
        resolve({
          acceptedCount: acceptedResults.length,
          ascending: acceptedResults.every(({ id }, index) => id === index + 1),
          exactShippedBoards: acceptedResults.every(({ levelJson }, index) => levelJson === JSON.stringify(LEVELS[index])),
          workerComputeMs,
          workerWithinBaseline: workerComputeMs <= upper,
          maxMainThreadTaskMs: Math.max(0, ...longTasks),
          longTaskObserverSupported: PerformanceObserver.supportedEntryTypes.includes('longtask'),
          inputToPaintP95Ms: percentile(paints, 0.95),
          latestStartLatencyMs: metrics.latestStartLatencyMs,
          staleResultCount: metrics.staleResultCount,
        });
      },
    });
    coordinator.schedule(draft, Array.from({ length: 110 }, (_, index) => index + 1), []);
  });
}
