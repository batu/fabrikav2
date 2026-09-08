import type { GameMode } from '../core/GameState';
import { COHORT_KEY_PREFIX, type CohortResolver } from '../v1core/assets';

export const REVEAL_PICKUP_EXPERIMENT_ID = 'ftd_ios_reveal_pickup_v1';
export const REVEAL_PICKUP_RECORD_KEY = 'ftd_reveal_pickup_v1';
export const REVEAL_PICKUP_DIMENSIONS = ['rp_v1_reveal', 'rp_v1_pickup', 'rp_v1_not_enrolled', 'rp_v1_qa_reveal', 'rp_v1_qa_pickup'] as const;
type Variant = 'reveal' | 'pickup';
export interface RevealPickupAssignment {
  readonly experimentId: typeof REVEAL_PICKUP_EXPERIMENT_ID;
  readonly variant: Variant;
  readonly bucket: number;
  readonly enrolledDay: string;
  readonly population: 'production' | 'qa';
}
interface InitializeOptions {
  enabled: boolean;
  killed?: boolean;
  platform: string;
  durable: boolean;
  hadExistingState: boolean;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  resolver: Pick<CohortResolver, 'initialize'>;
  initializeHints: () => boolean;
}

export function createRevealPickupExperiment() {
  let assignment: RevealPickupAssignment | null = null;
  let initialization: Promise<RevealPickupAssignment | null> | null = null;
  let exposed = false;
  function params(): Record<string, string | number | boolean> {
    return assignment === null ? {} : {
      experiment_id: assignment.experimentId, variant: assignment.variant,
      experiment_population: assignment.population,
      enrollment_day: assignment.enrolledDay, starting_hints: 10,
      experiment_exposed: exposed,
    };
  }

  async function initializeOnce(options: InitializeOptions): Promise<RevealPickupAssignment | null> {
    if (options.platform !== 'ios' || !options.durable) return null;
    const { storage } = options;
    if (options.killed === true) {
      storage.setItem(REVEAL_PICKUP_RECORD_KEY, 'killed');
      return null;
    }
    const raw = storage.getItem(REVEAL_PICKUP_RECORD_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (!validAssignment(parsed) || !validHints(storage.getItem('ftd_hints'))) return null;
      assignment = Object.freeze(parsed);
      return assignment;
    }
    if (!options.enabled || options.hadExistingState) return null;
    const cohortKey = COHORT_KEY_PREFIX + REVEAL_PICKUP_EXPERIMENT_ID;
    // A bucket without an enrollment is a torn/unknown install, not a new one.
    if (storage.getItem(cohortKey) !== null) return null;
    storage.setItem(REVEAL_PICKUP_RECORD_KEY, 'pending');
    if (storage.getItem(REVEAL_PICKUP_RECORD_KEY) !== 'pending') return null;
    const bucket = await options.resolver.initialize(REVEAL_PICKUP_EXPERIMENT_ID);
    if (!validBucket(bucket)) return null;
    const persisted = JSON.parse(storage.getItem(cohortKey) ?? 'null') as { experimentId?: unknown; bucket?: unknown } | null;
    if (persisted?.experimentId !== REVEAL_PICKUP_EXPERIMENT_ID || persisted.bucket !== bucket) return null;
    const candidate: RevealPickupAssignment = {
      experimentId: REVEAL_PICKUP_EXPERIMENT_ID,
      bucket, variant: bucket < 50 ? 'reveal' : 'pickup',
      enrolledDay: new Date().toISOString().slice(0, 10),
      population: storage.getItem('ftd_reveal_pickup_qa') === '1' ? 'qa' : 'production',
    };
    // Wallet is initialized before enrollment is committed. A torn write can
    // exclude this install, never replay a starting grant over a spent balance.
    if (!options.initializeHints()) return null;
    const serialized = JSON.stringify(candidate);
    storage.setItem(REVEAL_PICKUP_RECORD_KEY, serialized);
    if (storage.getItem(REVEAL_PICKUP_RECORD_KEY) !== serialized) return null;
    assignment = Object.freeze(candidate);
    return assignment;
  }

  return {
    initialize(options: InitializeOptions): Promise<RevealPickupAssignment | null> {
      initialization ??= initializeOnce(options).catch(() => null);
      return initialization;
    },
    assignment: () => assignment,
    params,
    exposure(actualMode: GameMode): Record<string, string | number | boolean> | null {
      if (assignment === null || exposed
        || actualMode !== (assignment.variant === 'pickup' ? 'restoration' : 'classic')) return null;
      exposed = true;
      return { ...params(), bucket: assignment.bucket, actual_mode: actualMode };
    },
    mode(fallback: GameMode): GameMode {
      return assignment === null ? fallback : assignment.variant === 'reveal' ? 'classic' : 'restoration';
    },
  };
}

function validBucket(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 100;
}
function validHints(value: string | null): boolean {
  return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
}
function validAssignment(value: unknown): value is RevealPickupAssignment {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Partial<RevealPickupAssignment>;
  return record.experimentId === REVEAL_PICKUP_EXPERIMENT_ID
    && (record.population === 'production' || record.population === 'qa')
    && validBucket(record.bucket)
    && record.variant === (record.bucket < 50 ? 'reveal' : 'pickup')
    && typeof record.enrolledDay === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(record.enrolledDay)
    && Number.isFinite(Date.parse(record.enrolledDay));
}

export const revealPickupExperiment = createRevealPickupExperiment();
