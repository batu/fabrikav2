/**
 * Singleton CohortResolver for find_the_dog.
 *
 * Exposes `initializeCohort()` — awaited once during boot before
 * `analytics.appOpen()` so every event carries the resolved
 * `cohort_bucket` user property. Subsequent sessions read the sticky
 * record synchronously; only the true first launch pays the
 * SubtleCrypto cost.
 */

import { createCohortResolver, type CohortResolver } from '../v1core/assets';

import { COHORT_BUCKET_COUNT, EXPERIMENT_ID } from '../config/cdn';

const resolver: CohortResolver = createCohortResolver({ numBuckets: COHORT_BUCKET_COUNT });

let initialized = false;
let cachedBucket: number | null = null;

/** Initializes the cohort resolver and returns the resolved bucket. */
export async function initializeCohort(): Promise<number> {
  if (initialized && cachedBucket !== null) return cachedBucket;
  const bucket = await resolver.initialize(EXPERIMENT_ID);
  cachedBucket = bucket;
  initialized = true;
  return bucket;
}

/**
 * Synchronous cohort bucket accessor. Returns null before
 * `initializeCohort()` has resolved — callers should treat that as
 * "don't tag yet" rather than guessing a bucket.
 */
export function cohortBucket(): number | null {
  return cachedBucket;
}

/** For tests — resets memoized state. */
export function _resetCohortContext(): void {
  initialized = false;
  cachedBucket = null;
  resolver._reset();
}
