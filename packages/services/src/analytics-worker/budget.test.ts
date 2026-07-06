import { describe, expect, it } from 'vitest';
import { analyticsWorkerComputedVolumeBudget, analyticsWorkerSamplingContract } from './budget.ts';

describe('owned analytics worker budget contract', (): void => {
  it('covers DAU, sessions, events, retry multiplier, query volume, and kill switches', (): void => {
    expect(analyticsWorkerComputedVolumeBudget).toMatchObject({
      dailyActiveUsers: 50_000,
      sessionsPerUserPerDay: 2.2,
      eventsPerSession: 24,
      retryMultiplier: 1.15,
      peakQueryRequestsPerDay: 25_000,
      analyticsEngineSampleRate: 1,
      minCohortRowsBeforeDisplay: 25,
    });
    expect(analyticsWorkerComputedVolumeBudget.datapointsPerDay).toBe(3_036_000);
    expect(analyticsWorkerComputedVolumeBudget.killSwitches).toEqual([
      'ANALYTICS_INGEST_ENABLED=false',
      'ANALYTICS_KILL_SWITCH=true',
      'ANALYTICS_STORAGE_MODE=d1',
      'ANALYTICS_AE_SAMPLE_RATE=<0..1>',
    ]);
  });

  it('documents sampling-aware formulas and suppression', (): void => {
    expect(analyticsWorkerSamplingContract.estimatedCountFormula).toContain('observed_count / ANALYTICS_AE_SAMPLE_RATE');
    expect(analyticsWorkerSamplingContract.suppressionRule).toContain('observed rows < minCohortRowsBeforeDisplay');
  });
});
