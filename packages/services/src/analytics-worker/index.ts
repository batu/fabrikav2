/**
 * `@fabrikav2/services/analytics-worker` — the multi-game owned-analytics
 * ingest boundary. Deploy ONE worker; games are partitioned by the `game_id`
 * on every batch and environment is partitioned by `env`. Wire this default
 * export to a Cloudflare Worker (see `wrangler.template.toml`). Code + tests
 * only in v2 — the real deploy (account ids, bindings, secrets) is Batu's.
 */
import { OwnedAnalyticsIngestWorker, SlidingWindowRateLimiter, TtlSet } from './ingest.ts';
import type { AnalyticsWorkerEnv } from './contracts.ts';

export { analyticsEngineLayout, AnalyticsEngineStore, D1AnalyticsEventStore, buildSourceHealthRow, shouldWriteAnalyticsEngineSample, toAnalyticsEnginePoint } from './storage.ts';
export { analyticsWorkerComputedVolumeBudget, analyticsWorkerVolumeBudget, analyticsWorkerD1Budget, analyticsWorkerSamplingContract } from './budget.ts';
export { OwnedAnalyticsIngestWorker, readAnalyticsWorkerConfig, parseOwnedAnalyticsBatch, SlidingWindowRateLimiter, TtlSet } from './ingest.ts';
export { OwnedAnalyticsQueryApi, readAnalyticsQueryConfig } from './query.ts';
export {
  ownedAnalyticsWorkerSchema,
  ANALYTICS_ENVIRONMENTS,
  type AnalyticsEngineDataPoint,
  type AnalyticsEngineDataset,
  type AnalyticsEnvironment,
  type AnalyticsWorkerEnv,
  type AnalyticsWorkerRequestContext,
  type AnalyticsWorkerStorageMode,
  type AnalyticsWorkerStore,
  type AnalyticsWorkerWriteResult,
  type D1Database,
  type OwnedAnalyticsWorkerBatch,
  type OwnedAnalyticsWorkerEvent,
  type SourceHealthRow,
} from './contracts.ts';
export type {
  AnalyticsFunnelResponse,
  AnalyticsFunnelRow,
  AnalyticsQueryWindow,
} from './query.ts';

const replayStore = new TtlSet();
const rateLimiter = new SlidingWindowRateLimiter();

export default {
  async fetch(request: Request, env: AnalyticsWorkerEnv): Promise<Response> {
    return new OwnedAnalyticsIngestWorker(env, { replayStore, rateLimiter }).fetch(request);
  },
};
