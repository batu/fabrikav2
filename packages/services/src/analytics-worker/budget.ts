/**
 * Volume + D1 budget contract. Ported verbatim from FTD (the numbers are the
 * per-game capacity envelope Cloudflare Analytics Engine / D1 must stay under);
 * only the kill-switch env-var names are de-FTD'd to the game-agnostic
 * `ANALYTICS_*` prefix. A multi-game deployment sizes to the busiest single
 * game, so the DAU/session/event assumptions carry unchanged.
 */

export interface AnalyticsWorkerVolumeBudget {
  readonly dailyActiveUsers: number;
  readonly sessionsPerUserPerDay: number;
  readonly eventsPerSession: number;
  readonly retryMultiplier: number;
  readonly datapointsPerDay: number;
  readonly peakQueryRequestsPerDay: number;
  readonly analyticsEngineSampleRate: number;
  readonly minCohortRowsBeforeDisplay: number;
  readonly killSwitches: readonly string[];
}

export const analyticsWorkerVolumeBudget = {
  dailyActiveUsers: 50_000,
  sessionsPerUserPerDay: 2.2,
  eventsPerSession: 24,
  retryMultiplier: 1.15,
  peakQueryRequestsPerDay: 25_000,
  analyticsEngineSampleRate: 1,
  minCohortRowsBeforeDisplay: 25,
  killSwitches: [
    'ANALYTICS_INGEST_ENABLED=false',
    'ANALYTICS_KILL_SWITCH=true',
    'ANALYTICS_STORAGE_MODE=d1',
    'ANALYTICS_AE_SAMPLE_RATE=<0..1>',
  ],
} as const satisfies Omit<AnalyticsWorkerVolumeBudget, 'datapointsPerDay'> & { readonly datapointsPerDay?: never };

export const analyticsWorkerComputedVolumeBudget: AnalyticsWorkerVolumeBudget = {
  ...analyticsWorkerVolumeBudget,
  datapointsPerDay: Math.round(
    analyticsWorkerVolumeBudget.dailyActiveUsers
    * analyticsWorkerVolumeBudget.sessionsPerUserPerDay
    * analyticsWorkerVolumeBudget.eventsPerSession
    * analyticsWorkerVolumeBudget.retryMultiplier,
  ),
};

export interface AnalyticsWorkerD1Budget {
  readonly maxRowsReadPerBatch: number;
  readonly maxRowsWrittenPerBatch: number;
  readonly maxQueriesPerBatch: number;
  readonly maxQueryDurationMsPerBatch: number;
  readonly maxStoredEventBytes: number;
}

export const analyticsWorkerD1Budget = {
  maxRowsReadPerBatch: 1,
  maxRowsWrittenPerBatch: 101,
  maxQueriesPerBatch: 102,
  maxQueryDurationMsPerBatch: 250,
  maxStoredEventBytes: 4_096,
} as const satisfies AnalyticsWorkerD1Budget;

export interface AnalyticsWorkerSamplingContract {
  readonly estimatedCountFormula: string;
  readonly suppressionRule: string;
}

export const analyticsWorkerSamplingContract = {
  estimatedCountFormula: 'estimated_count = observed_count / ANALYTICS_AE_SAMPLE_RATE',
  suppressionRule: 'Suppress cohorts with observed rows < minCohortRowsBeforeDisplay before applying sampling expansion.',
} as const satisfies AnalyticsWorkerSamplingContract;
